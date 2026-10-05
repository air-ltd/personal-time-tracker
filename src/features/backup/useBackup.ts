import { useCallback, useRef, useState } from 'react'
import { createBackup, restoreBackup, type BackupDeps } from '../../export/backup'
import { readSnapshot, writeSnapshot } from '../../storage/snapshotRepo'
import { SCHEMA_VERSION } from '../../storage/db'

/**
 * Backup and restore, as state rather than as a panel (0008 J1–J12).
 *
 * Deliberately present whether or not Dropbox is connected. A backup is the way out when
 * sync is unavailable — no account, a rejected token, an offline device — and it is the
 * only copy of the data that does not depend on a third party.
 *
 * Extracted from `BackupPanel` because item 26 reduced the header menu to three buttons
 * while item 18 had put the whole panel there, and the settings page now carries the
 * explanation. Two places perform these actions, so the logic cannot live in either of
 * them: a copy would let the two disagree about what "restore" means.
 */

export type BackupState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string; issues: string[] }

export interface Backup {
  state: BackupState
  /**
   * The input `chooseFile` opens, to be rendered as a `BackupFileInput`.
   *
   * Owned by this hook rather than by each caller because `chooseFile` dereferences *this*
   * ref. It used to be returned as nothing at all, so both callers created their own ref,
   * passed that one to the input, and left this one `null` — which made `chooseFile`
   * `null?.click()`, and both restore buttons dead. The type could not see it: the
   * interface never mentioned the ref, so the split ownership of one piece of state across
   * two components type-checked perfectly.
   *
   * Two surfaces render a backup control (the settings panel and the header menu), so
   * there really are two call sites, and returning the ref is what keeps them agreeing.
   */
  fileInput: React.RefObject<HTMLInputElement | null>
  /** Writes a backup file and reports what it contained. */
  export: () => void
  /** Opens the file picker. Renders `fileInput` as a hidden input to receive the choice. */
  chooseFile: () => void
  restore: (file: File) => void
  /** Bind to the input's `onChange`. Resets it first, so the same file fires twice. */
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}

export function useBackup({
  deps = defaultDeps,
}: { deps?: BackupDeps | undefined } = {}): Backup {
  const [state, setState] = useState<BackupState>({ kind: 'idle' })
  const fileInput = useRef<HTMLInputElement>(null)

  const exportBackup = useCallback(() => {
    setState({ kind: 'working' })
    void createBackup(deps)
      .then((backup) => {
        downloadBackup(backup.filename, backup.body)
        const count = backup.counts['entries'] ?? 0
        setState({
          kind: 'done',
          message: `Saved ${count} ${count === 1 ? 'entry' : 'entries'} to ${backup.filename}.`,
        })
      })
      .catch((error: unknown) => {
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not create a backup.',
          issues: [],
        })
      })
  }, [deps])

  const restore = useCallback(
    (file: File) => {
      setState({ kind: 'working' })
      /*
       * Two catches, not one.
       *
       * Reading the file and applying it are different failures with different remedies, and
       * a single trailing `.catch` reported both as "Could not read that file." — so a
       * *write* that failed told the user their file was unreadable, sending them off to
       * re-select a perfectly good backup. The export path has its own catch with correct
       * wording; these are the same mistake in the other file, so the wording now matches.
       */
      /*
       * Size checked before reading, not after.
       *
       * `file.text()` materialises the whole file as one string, so a 2 GB file is fully in
       * memory before the parser ever sees it and the tab dies without a word to the user.
       * `file.size` is known from the `File` handle alone, so the cap costs nothing and
       * refuses politely instead. The download path reasons about the same trade-off.
       */
      if (file.size > MAX_BACKUP_BYTES) {
        setState({
          kind: 'error',
          message: `That file is ${MB(file.size)} MB. A backup this app wrote is a fraction of that, so this is probably not one.`,
          issues: [],
        })
        return
      }
      void file
        .text()
        .catch((error: unknown) => {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Could not read that file.',
            issues: [],
          })
          // Nothing to apply, and letting the chain continue would run the restore with
          // `undefined` and overwrite this with a second, less accurate message.
          throw error
        })
        .then((text) => restoreBackup(deps, text))
        .then((result) => {
          if (result.status === 'rejected') {
            setState({
              kind: 'error',
              message: `Nothing was imported. ${result.message}`,
              issues: result.issues,
            })
            return
          }
          const count = result.counts['entries'] ?? 0
          const when = result.exportedAt
            ? ` It was taken ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(result.exportedAt))}.`
            : ''
          setState({
            kind: 'done',
            message: `Restored. This device now holds ${count} ${count === 1 ? 'entry' : 'entries'}.${when}`,
          })
        })
        .catch((error: unknown) => {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Could not apply that backup.',
            issues: [],
          })
        })
    },
    [deps],
  )

  const chooseFile = useCallback(() => fileInput.current?.click(), [])

  const onFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      // Reset immediately so choosing the same file twice fires again.
      event.target.value = ''
      if (file) restore(file)
    },
    [restore],
  )

  return { state, fileInput, export: exportBackup, chooseFile, restore, onFileChange }
}

/**
 * Hand the file to the browser.
 *
 * An object URL rather than a data URL: a backup can grow, and a data URL has to be held
 * in memory twice. Revoked afterwards, since a leaked URL pins the blob for the life of
 * the document.
 */
/**
 * A ceiling on a restored file, chosen to sit well above any backup this app could write.
 *
 * Generous enough not to refuse a real backup of a long history, low enough that a
 * mistakenly selected video cannot take the tab down with it.
 */
const MAX_BACKUP_BYTES = 64 * 1024 * 1024

/** Whole megabytes, for the message. Rounded up so 0.1 MB does not read as "0 MB". */
function MB(bytes: number): string {
  return String(Math.ceil(bytes / (1024 * 1024)))
}

function downloadBackup(filename: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  /*
   * Revoked on the next task, not synchronously after the click.
   *
   * Revoking in the same task aborts the download in some Firefox and Safari versions: the
   * click has been dispatched but the navigation has not been read yet, so the blob is gone
   * by the time it is fetched. `setTimeout(…, 0)` is the conventional fix and costs
   * nothing. The element is removed immediately either way — it is never in the document
   * while the browser resolves the link.
   */
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

/**
 * Wired to the live database. Overridable so this can be tested without IndexedDB, and so
 * the storage seam lives in one place rather than in a component.
 *
 * `SCHEMA_VERSION` is imported rather than written as a literal: a backup is only
 * restorable by a build that understands its schema, and a literal here would drift from
 * the database the moment the schema moved.
 */
const defaultDeps: BackupDeps = {
  readLocal: readSnapshot,
  writeLocal: writeSnapshot,
  supportedSchemaVersion: SCHEMA_VERSION,
  now: () => new Date(),
}
