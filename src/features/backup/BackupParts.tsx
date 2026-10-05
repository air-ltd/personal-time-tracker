import type { BackupState } from './useBackup'

/**
 * The pieces both backup surfaces share (item 26).
 *
 * Split out of `useBackup` so that file exports only the hook: a module exporting both
 * components and a hook defeats React Fast Refresh, so editing the hook would invalidate
 * the components' module boundary too.
 */

/**
 * The hidden file input both surfaces share.
 *
 * Kept out of the tab order and hidden: a visible file input invites choosing a file with
 * no idea what will happen to the data, whereas the button that opens it can explain first.
 */
export function BackupFileInput({
  input,
  onChange,
}: {
  input: React.RefObject<HTMLInputElement | null>
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <input
      ref={input}
      type="file"
      accept="application/json,.json"
      className="visually-hidden"
      data-testid="backup-file"
      aria-hidden="true"
      tabIndex={-1}
      onChange={onChange}
    />
  )
}

/** What the backup is and is not, for the place that has room to say it. */
export function BackupStatus({ state }: { state: BackupState }) {
  if (state.kind === 'done') {
    return (
      <p className="alert alert-success" role="status" data-testid="backup-status">
        {state.message}
      </p>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="alert alert-error" role="alert" data-testid="backup-status">
        <p>{state.message}</p>
        {state.issues.length > 0 && (
          <ul className="backup-issues">
            {/* Indexed, not keyed by the text: two problems with the same wording are
                legitimately both listed — an entry can be too long and start in the future
                is a different message, but "end must be after start" can appear once per
                entry — and a duplicate key makes React drop one of them silently. */}
            {state.issues.map((issue, index) => (
              <li key={`${index}-${issue}`}>{issue}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }
  return null
}
