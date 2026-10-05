import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AppDb, setDbForTests } from '../../storage/db'
import { bumpRevision, resetRevisionForTests } from '../../storage/events'
import * as entriesRepo from '../../storage/entriesRepo'
import { createManualEntry, putEntry } from '../../storage/entriesRepo'
import { useEntries } from './useEntries'
import { entry, T0 } from '../../test/factories'

/**
 * List re-read behaviour (0002 S2).
 *
 * The entries on screen come from IndexedDB, so a re-read must not blank the list. It
 * previously reported `loading` whenever a read was in flight, which made every save
 * flash "Loading…" — the entries were still correct, they were just hidden while the
 * next read came back.
 */

let db: AppDb
let counter = 0

beforeEach(async () => {
  db = new AppDb(`use-entries-${(counter += 1)}`)
  setDbForTests(db)
  // Await the open so the schema upgrade has committed; see useTimer.test.tsx.
  await db.open()
  resetRevisionForTests()
})

/** Let the pending read settle. Dexie commits on a macrotask. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
  })
}

describe('useEntries', () => {
  it('reports loading only before the first read', async () => {
    const { result } = renderHook(() => useEntries())

    expect(result.current.loading).toBe(true)
    await settle()
    expect(result.current.loading).toBe(false)
  })

  it('never reports loading again once the first read has landed', async () => {
    await createManualEntry({
      start: new Date('2026-10-13T08:00:00.000Z'),
      end: new Date('2026-10-13T09:00:00.000Z'),
      note: 'first',
      now: T0,
    })

    // Every value `loading` took, across every render.
    const seen: boolean[] = []
    const { result } = renderHook(() => {
      const state = useEntries()
      seen.push(state.loading)
      return state
    })
    await settle()
    expect(result.current.entries).toHaveLength(1)

    // Three writes, so the re-read runs three more times.
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await createManualEntry({
          start: new Date(`2026-10-13T1${i}:00:00.000Z`),
          end: new Date(`2026-10-13T1${i}:30:00.000Z`),
          note: `entry ${i}`,
          now: T0,
        })
        bumpRevision()
      })
    }
    await settle()

    expect(result.current.entries).toHaveLength(4)
    // The flash the old derivation caused: `loading` went true on every write and stayed
    // true for as long as IndexedDB took to answer, hiding a correct list behind
    // "Loading…".
    expect(seen.slice(seen.indexOf(false))).not.toContain(true)
  })

  it('picks up a deleted entry', async () => {
    const entry = await createManualEntry({
      start: new Date('2026-10-13T08:00:00.000Z'),
      end: new Date('2026-10-13T09:00:00.000Z'),
      note: 'only',
      now: T0,
    })
    const { result } = renderHook(() => useEntries())
    await settle()
    expect(result.current.entries).toHaveLength(1)

    await act(async () => {
      const { softDeleteEntry } = await import('../../storage/entriesRepo')
      await softDeleteEntry(entry.id, T0)
      bumpRevision()
    })
    await settle()

    expect(result.current.entries).toHaveLength(0)
  })
})

describe('a read that fails', () => {
  beforeEach(async () => {
    db = new AppDb(`use-entries-error-${(counter += 1)}`)
    setDbForTests(db)
    await db.open()
    resetRevisionForTests()
  })

  /*
   * The sibling hook documents this exact failure as the reason it carries an `error`
   * field, and this one had the bug its sibling was written to avoid: no `.catch`, so a
   * rejected read left `loadedOnce` false forever — the view rendered "Loading…" for good,
   * suppressed the empty state, and the rejection was unhandled, which fails a whole test
   * file on an error nothing displays.
   */
  it('reports the failure instead of loading for ever', async () => {
    const list = vi.spyOn(entriesRepo, 'listEntries').mockRejectedValue(new Error('blocked'))

    const { result } = renderHook(() => useEntries())
    await waitFor(() => {
      expect(result.current.error).toMatch(/blocked/)
    })

    // The distinction that matters: a broken read is not a slow one.
    expect(result.current.loading).toBe(false)
    expect(result.current.entries).toEqual([])
    list.mockRestore()
  })

  it('clears the error once a read succeeds', async () => {
    await putEntry(entry({}))
    const list = vi
      .spyOn(entriesRepo, 'listEntries')
      .mockRejectedValueOnce(new Error('blocked'))
      .mockImplementation(() => Promise.resolve([entry({})]))

    const { result, rerender } = renderHook(() => useEntries())
    await waitFor(() => {
      expect(result.current.error).toMatch(/blocked/)
    })

    // The taxonomy hook already asserts this; a stale error beside fresh data is the same
    // class of problem as a stale success beside a broken read.
    bumpRevision()
    rerender()
    await waitFor(() => {
      expect(result.current.error).toBeNull()
    })
    expect(result.current.entries.length).toBeGreaterThan(0)
    list.mockRestore()
  })
})
