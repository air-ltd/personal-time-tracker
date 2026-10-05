import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BackupPanel } from './BackupPanel'
import type { BackupDeps } from '../../export/backup'
import { serialiseEnvelope, toEnvelope } from '../../export/envelope'
import type { Snapshot } from '../../domain/merge'
import type { TimeEntry } from '../../domain/entries/types'

/**
 * Backup panel behaviour (0008 J1–J12).
 *
 * The assertions here are about what the user is told, not just what happened: a
 * restore that silently did the wrong thing would be worse than one that failed.
 */

const SCHEMA = 2
const T0 = new Date('2026-10-13T09:00:00.000Z')

function entry(id: string): TimeEntry {
  return {
    id,
    projectId: null,
    tagIds: [],
    start: '2026-10-13T08:00:00.000Z',
    end: '2026-10-13T09:00:00.000Z',
    note: '',
    billable: false,
    rateOverrideMinor: null,
    source: 'manual',
    createdAt: '2026-10-13T08:00:00.000Z',
    updatedAt: '2026-10-13T09:00:00.000Z',
    deletedAt: null,
  }
}

function snapshotOf(ids: string[]): Snapshot {
  return { schemaVersion: SCHEMA, entities: { entries: ids.map(entry) } }
}

function backupText(ids: string[]): string {
  return serialiseEnvelope(toEnvelope(snapshotOf(ids), T0))
}

let container: HTMLDivElement
let root: Root
let createObjectURL: ReturnType<typeof vi.spyOn>
let revokeObjectURL: ReturnType<typeof vi.spyOn>
let state: { local: Snapshot }
let deps: BackupDeps

/** The panel reads a File; jsdom has no File.text, so provide one. */
function fakeFile(name: string, text: string): File {
  const read = (): Promise<string> => Promise.resolve(text)
  return { name, text: read } as unknown as File
}

function status(): HTMLElement | null {
  return container.querySelector('[data-testid="backup-status"]')
}

/** Find a button by its visible label, the way a user picks it. */
function button(label: RegExp): Element | null {
  const buttons = Array.from(container.querySelectorAll('button'))
  return buttons.find((candidate) => label.test(candidate.textContent ?? '')) ?? null
}

/** Let the pending promise chain in the panel settle and re-render. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function click(el: Element | null): void {
  if (!el) throw new Error('element not found')
  act(() => {
    ;(el as HTMLElement).click()
  })
}

beforeEach(() => {
  state = { local: snapshotOf(['a']) }
  deps = {
    readLocal: () => Promise.resolve(state.local),
    writeLocal: (snapshot) => {
      state.local = snapshot
      return Promise.resolve()
    },
    supportedSchemaVersion: SCHEMA,
    now: () => T0,
  }

  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root.render(<BackupPanel deps={deps} />)
  })

  // jsdom does not implement object URLs, so the download path needs both stubbed.
  // Spied rather than assigned, so a stray reference to the real static is caught.
  createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
  revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})

describe('BackupPanel', () => {
  it('offers a backup without requiring Dropbox', () => {
    // The point of a local backup is availability when sync is not working, so the
    // panel must not be gated on a connection.
    expect(container.querySelector('h2')?.textContent).toBe('Backup')
    expect(container.textContent).toContain('with or without')
  })

  it('says a backup never contains the Dropbox login', () => {
    // Users are being asked to keep a file they may email or move between machines.
    expect(container.textContent).toContain('never contains your Dropbox login')
  })

  it('downloads a file and reports what went into it', async () => {
    click(button(/Download/))
    await flush()

    expect(createObjectURL).toHaveBeenCalled()
    expect(status()?.textContent).toContain('Saved 1 entry')
  })

  it('releases the object URL so the blob is not pinned for the document lifetime', async () => {
    click(button(/Download/))
    await flush()

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  it('restores a backup and reports the resulting count', async () => {
    const input = container.querySelector<HTMLInputElement>('[data-testid="backup-file"]')
    if (!input) throw new Error('no file input')

    act(() => {
      Object.defineProperty(input, 'files', {
        value: [fakeFile('backup.json', backupText(['a', 'b', 'c']))],
        configurable: true,
      })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()

    expect((state.local.entities['entries'] ?? []).length).toBe(3)
    expect(status()?.textContent).toContain('Restored')
    expect(status()?.textContent).toContain('3 entries')
  })

  it('refuses an oversized file from its size, without reading it (8.12)', async () => {
    // `file.text()` materialises the whole thing as one string, so an oversized file
    // exhausted memory before the parser saw it and before the user was told anything.
    // `file.size` comes from the handle, so refusing costs nothing.
    const input = container.querySelector<HTMLInputElement>('[data-testid="backup-file"]')
    if (!input) throw new Error('no file input')

    const oversize = {
      name: 'huge.json',
      size: 80 * 1024 * 1024,
      text: () => {
        throw new Error('the file should never have been read')
      },
    } as unknown as File

    act(() => {
      Object.defineProperty(input, 'files', { value: [oversize], configurable: true })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()

    expect(status()?.textContent).toContain('80 MB')
    expect(status()?.textContent).toContain('probably not one')
  })

  it('reports that nothing was imported when the file is not a backup', async () => {
    const input = container.querySelector<HTMLInputElement>('[data-testid="backup-file"]')
    if (!input) throw new Error('no file input')

    act(() => {
      Object.defineProperty(input, 'files', {
        value: [fakeFile('notes.json', '{"hello":"world"}')],
        configurable: true,
      })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()

    // Leading with "Nothing was imported" so a failed restore cannot be mistaken for
    // a successful one.
    expect(status()?.textContent).toContain('Nothing was imported')
    expect((state.local.entities['entries'] ?? []).length).toBe(1)
  })

  it('lists validation problems rather than a bare rejection', async () => {
    const input = container.querySelector<HTMLInputElement>('[data-testid="backup-file"]')
    if (!input) throw new Error('no file input')

    act(() => {
      Object.defineProperty(input, 'files', {
        value: [
          fakeFile(
            'broken.json',
            JSON.stringify({
              format: 'personal-time-tracker-backup',
              formatVersion: 1,
              schemaVersion: SCHEMA,
              exportedAt: T0.toISOString(),
              counts: { entries: 1 },
              data: { entries: 'not-an-array' },
            }),
          ),
        ],
        configurable: true,
      })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()

    expect(container.querySelectorAll('.backup-issues li').length).toBeGreaterThan(0)
  })

  it('explains that restoring keeps local data, so it is not a destructive act', () => {
    expect(container.textContent).toContain(
      'Anything already here that the backup does not mention is kept',
    )
  })

  it('hides the file input but keeps it reachable from the button', () => {
    const input = container.querySelector<HTMLInputElement>('[data-testid="backup-file"]')
    // A visible file input lets someone pick a file with no idea what follows.
    expect(input?.getAttribute('aria-hidden')).toBe('true')
    expect(input?.tabIndex).toBe(-1)
    expect(container.querySelector('input[type="file"]')?.className).toContain(
      'visually-hidden',
    )
  })

  it('actually opens the file picker when the button is pressed', async () => {
    /*
     * The test the previous version of this file claimed to have and did not.
     *
     * Every other restore test here reaches past the button and fires `change` on the
     * input directly, so the button could be wired to nothing at all and the suite would
     * stay green. It was: `useBackup` created the ref, dereferenced it in `chooseFile`,
     * and returned neither — so both call sites attached their *own* ref, `chooseFile`
     * ran `null?.click()`, and both restore buttons were dead. The entire import half of
     * 0008 was unreachable, with no error and no state change.
     *
     * The type system could not have caught it: `Backup` never mentioned the ref, so two
     * components each holding one looked like two independent pieces of state. This test
     * asserts the wiring instead — the button, and the ref the button clicks.
     */
    const input = container.querySelector<HTMLInputElement>('[data-testid="backup-file"]')
    if (!input) throw new Error('no file input')
    const clicked = vi.fn()
    input.click = clicked

    click(button(/Restore/))
    await flush()

    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('clears the input so choosing the same file twice runs again', async () => {
    const input = container.querySelector<HTMLInputElement>('[data-testid="backup-file"]')
    if (!input) throw new Error('no file input')

    act(() => {
      Object.defineProperty(input, 'files', {
        value: [fakeFile('backup.json', backupText(['a', 'b']))],
        configurable: true,
      })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()

    // Without the reset the browser reports no change the second time and the second
    // restore silently does nothing.
    expect(input.value).toBe('')
  })
})
