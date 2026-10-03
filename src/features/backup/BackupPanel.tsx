import { useCallback, useRef, useState } from 'react'
import { createBackup, restoreBackup, type BackupDeps } from '../../export/backup'
import { readSnapshot, writeSnapshot } from '../../storage/snapshotRepo'
import { SCHEMA_VERSION } from '../../storage/db'

/**
 * Backup controls (0008 J1–J12).
 *
 * Deliberately present whether or not Dropbox is connected. A backup is the way out
 * when sync is unavailable — no account, a rejected token, an offline device — and it
 * is the only copy of the data that does not depend on a third party.
 */

type State =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string; issues: string[] }

export function BackupPanel({ deps = defaultDeps }: { deps?: BackupDeps }) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const fileInput = useRef<HTMLInputElement>(null)

  const onExport = useCallback(() => {
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

  const onImport = useCallback(
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

  return (
    <section className="panel backup-panel">
      <div className="panel-header">
        <h2>Backup</h2>
      </div>

      <p className="hint">
        A backup is a single JSON file holding everything in this browser. Use it to move to
        another device, or to keep a copy you control — it works with or without Dropbox. It
        never contains your Dropbox login.
      </p>

      <div className="button-row">
        <button
          type="button"
          className="button button-primary"
          onClick={onExport}
          disabled={state.kind === 'working'}
        >
          {state.kind === 'working' ? 'Working…' : 'Download backup'}
        </button>

        <button
          type="button"
          className="button"
          onClick={() => fileInput.current?.click()}
          disabled={state.kind === 'working'}
        >
          Restore from file
        </button>

        {/*
          Kept out of the tab order and hidden: a visible file input invites choosing a
          file with no idea what will happen to the data, whereas the button above can
          explain first.
        */}
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          data-testid="backup-file"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Reset immediately so choosing the same file twice fires again.
            event.target.value = ''
            if (file) onImport(file)
          }}
        />
      </div>

      {state.kind === 'done' && (
        <p className="alert alert-success" role="status" data-testid="backup-status">
          {state.message}
        </p>
      )}

      {state.kind === 'error' && (
        <div className="alert alert-error" role="alert" data-testid="backup-status">
          <p>{state.message}</p>
          {state.issues.length > 0 && (
            <ul className="backup-issues">
              {state.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="hint">
        Restoring adds a backup's entries to this device. Anything already here that the backup
        does not mention is kept, and where both have the same entry the more recent one wins.
      </p>
    </section>
  )
}

/**
 * Hand the file to the browser.
 *
 * An object URL rather than a data URL: a backup can grow, and a data URL has to be
 * held in memory twice. Revoked afterwards, since a leaked URL pins the blob for the
 * life of the document.
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
 * Wired to the live database. Overridable so the panel can be tested without
 * IndexedDB, and so the storage seam lives in one place rather than in the component.
 *
 * `SCHEMA_VERSION` is imported rather than written as a literal: a backup is only
 * restorable by a build that understands its schema, and a literal here would drift
 * from the database the moment the schema moved.
 */
const defaultDeps: BackupDeps = {
  readLocal: readSnapshot,
  writeLocal: writeSnapshot,
  supportedSchemaVersion: SCHEMA_VERSION,
  now: () => new Date(),
}
