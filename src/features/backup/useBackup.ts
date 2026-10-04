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
  /** Writes a backup file and reports what it contained. */
  export: () => void
  /** Opens the file picker. Pass the chosen file to `restore`. */
  chooseFile: () => void
  restore: (file: File) => void
  /** Bind to a file input's `onChange`. Resets it first, so the same file fires twice. */
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
      void file
        .text()
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
            message: error instanceof Error ? error.message : 'Could not read that file.',
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

  return { state, export: exportBackup, chooseFile, restore, onFileChange }
}

/**
 * Hand the file to the browser.
 *
 * An object URL rather than a data URL: a backup can grow, and a data URL has to be held
 * in memory twice. Revoked afterwards, since a leaked URL pins the blob for the life of
 * the document.
 */
function downloadBackup(filename: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
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
