import { useSync, type SyncState } from './syncContext'

/**
 * Sync state in the header (item 10 of `SPECS/todo.md`).
 *
 * "Dropbox connection status should be indicated in the header row, and details moved to
 * settings page. If disconnected the header row indicator should be a button that allows
 * connection to be triggered."
 *
 * So the indicator changes shape with the state, rather than being one control that means
 * different things: while disconnected it is the button that connects, because that is
 * the moment the user wants to act. Once connected there is nothing to press, so it
 * becomes a link to the settings page, where the detail lives.
 *
 * Connecting leaves the page for Dropbox's consent screen. That is why it is a button
 * with the outcome in its label rather than a status light that navigates on click — the
 * user should know they are about to hand over the page.
 */
export function SyncIndicator() {
  const sync = useSync()
  return <SyncIndicatorView {...sync} />
}

/**
 * The indicator as a pure function of the connection state.
 *
 * Split out because the state lives in the provider and a real one cannot be produced in
 * a test: it depends on an OAuth round trip with Dropbox, which does not resolve in a
 * test environment. Given the state, every branch is testable — and the disconnected case
 * is the one worth testing, since that is when the control has to offer an action.
 */
export function SyncIndicatorView({
  connection,
  status,
  hasKey,
  busy,
  connect,
}: Pick<SyncState, 'connection' | 'status' | 'hasKey' | 'busy' | 'connect'>) {
  if (!hasKey) {
    return (
      <a
        className="button sync-indicator sync-indicator-idle"
        href="#/settings"
        data-testid="sync-indicator"
        title="Dropbox is not configured. Open settings to add an app key."
      >
        <span className="sync-indicator-dot" aria-hidden="true" />
        Sync not set up
      </a>
    )
  }

  if (connection === 'disconnected') {
    return (
      <button
        type="button"
        className="button sync-indicator sync-indicator-warn"
        data-testid="sync-indicator"
        onClick={connect}
        disabled={busy}
        title="Entries are saved in this browser only. Connect Dropbox to use them on another device."
      >
        <span className="sync-indicator-dot" aria-hidden="true" />
        Connect Dropbox
      </button>
    )
  }

  if (connection === 'checking') {
    return (
      <a
        className="button sync-indicator sync-indicator-idle"
        href="#/settings"
        data-testid="sync-indicator"
        title="Asking Dropbox whether this device is connected."
      >
        <span className="sync-indicator-dot" aria-hidden="true" />
        Checking sync…
      </a>
    )
  }

  // Connected. An error here is the one worth colouring: the user would otherwise assume
  // the other device is current, which is the failure silent sync causes (0012 AU8).
  const failed = status?.state === 'error'

  return (
    <a
      className={`button sync-indicator sync-indicator-${failed ? 'error' : 'ok'}`}
      href="#/settings"
      data-testid="sync-indicator"
      title={
        failed
          ? (status?.message ?? 'The last sync failed. Open settings for the detail.')
          : status?.lastSyncAt
            ? `Last synced ${new Date(status.lastSyncAt).toLocaleString()}.`
            : 'Connected. Waiting for the first sync.'
      }
    >
      <span className="sync-indicator-dot" aria-hidden="true" />
      {failed ? 'Sync failed' : 'Synced'}
    </a>
  )
}
