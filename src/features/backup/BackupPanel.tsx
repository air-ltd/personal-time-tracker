import { DownloadIcon, RestoreIcon } from '../../app/Icons'
import { BackupFileInput, BackupStatus } from '../backup/BackupParts'
import { useBackup } from './useBackup'
import type { BackupDeps } from '../../export/backup'

/**
 * Backup controls, with room to explain them (0008 J1–J12).
 *
 * The panel form lives on the settings page. The header menu reduced to three buttons in
 * item 26, which is the right shape for a menu — but a menu has nowhere to say what a
 * backup is or that restoring merges rather than replaces, and those sentences are the
 * reason the buttons are safe to press. The logic is shared with the menu via `useBackup`,
 * so there is one definition of what "restore" does.
 */

export function BackupPanel({ deps }: { deps?: BackupDeps | undefined } = {}) {
  // `deps` is a seam for tests: the storage wiring is injected rather than reached for, so
  // the panel can be exercised without IndexedDB.
  const backup = useBackup({ deps })
  const working = backup.state.kind === 'working'

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
          onClick={backup.export}
          disabled={working}
        >
          {/* Icons beside the words rather than instead of them: these are two of the least
              reversible actions in the app, so they should not be inferred from a glyph. */}
          <DownloadIcon />
          {working ? 'Working…' : 'Download backup'}
        </button>

        <button type="button" className="button" onClick={backup.chooseFile} disabled={working}>
          <RestoreIcon />
          Restore from file
        </button>

        <BackupFileInput input={backup.fileInput} onChange={backup.onFileChange} />
      </div>

      <BackupStatus state={backup.state} />

      <p className="hint">
        Restoring adds a backup's entries to this device. Anything already here that the backup
        does not mention is kept, and where both have the same entry the more recent one wins.
      </p>
    </section>
  )
}
