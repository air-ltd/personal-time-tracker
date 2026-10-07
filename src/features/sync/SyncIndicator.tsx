import { useSync, type SyncState } from './syncContext'
import { CloudStateIcon } from '../../app/Icons'

/**
 * Sync state in the header (item 10 of `SPECS/todo.md`).
 *
 * "Dropbox connection status should be indicated in the header row, and details moved to
 * settings page. If disconnected the header row indicator should be a button that allows
 * connection to be triggered."
 *
 * So the indicator changes shape with the state, rather than being one control that means
 * different things: while disconnected it is the button that connects, because that is
 * the moment the user wants to act.
 *
 * It never navigates to the settings page (item 62). It used to, in three of its four
 * states, on the reasoning that the detail lives there — so a user who tapped the
 * indicator to read the sync state was taken off the page they were on. The detail is
 * still on settings, reachable from the menu, which is where someone who wants it will
 * look. What the header control does instead is the thing its own state calls for:
 * connect when disconnected, sync when connected, and nothing at all when there is
 * nothing it can do.
 *
 * The words are gone from the card itself (item 65): the mark is now the state, one cloud
 * carrying a tick, a bang, a clock or arrows. What 0012 C8 asks for — that the status be
 * visible — is met by the mark, its colour, the tooltip and the accessible name rather
 * than by a word that made the header the widest thing on every screen. The full sentence
 * ("Last synced 14:02:11, press to sync now") is in the tooltip, and the Sync panel on
 * settings spells the state out in text for anyone who wants to read it.
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
  syncNow,
}: Pick<SyncState, 'connection' | 'status' | 'hasKey' | 'busy' | 'connect' | 'syncNow'>) {
  if (!hasKey) {
    /*
     * Inert, and disabled rather than a link: there is no key, so there is nothing to
     * connect and nothing to sync. It used to link to settings on the grounds that a key
     * is added there — which made the one state with no action the one that navigated.
     */
    return (
      <button
        type="button"
        className="button sync-indicator sync-indicator-icon sync-indicator-idle"
        data-testid="sync-indicator"
        disabled
        aria-label="Sync not set up"
        title="Dropbox is not configured. Add an app key under Settings."
      >
        <CloudStateIcon state="setup" size={24} weight={2.6} />
      </button>
    )
  }

  if (connection === 'disconnected') {
    return (
      <button
        type="button"
        className="button sync-indicator sync-indicator-icon sync-indicator-warn"
        data-testid="sync-indicator"
        onClick={connect}
        disabled={busy}
        aria-label="Connect Dropbox"
        title="Entries are saved in this browser only. Connect Dropbox to use them on another device."
      >
        <CloudStateIcon state="offline" size={24} weight={2.6} />
      </button>
    )
  }

  if (connection === 'checking') {
    // A check is already in flight, so there is nothing to press and nowhere to go.
    return (
      <button
        type="button"
        className="button sync-indicator sync-indicator-icon sync-indicator-idle"
        data-testid="sync-indicator"
        disabled
        aria-label="Checking sync"
        title="Asking Dropbox whether this device is connected."
      >
        <CloudStateIcon state="syncing" size={24} weight={2.6} />
      </button>
    )
  }

  /*
   * Ordered by how much the user can act on it, and every branch is a distinct answer.
   *
   * The rule: "Synced" is only ever printed when a cycle has actually completed
   * successfully. Anything else — running, failed, or work still waiting — says so, because
   * a green dot labelled "Synced" next to a stale timestamp is a claim about the other
   * device, and the whole reason this indicator exists is that silent sync must never let
   * the user believe their work is elsewhere when it is not (0012 AU8).
   *
   * `syncing` used to fall through to the success branch and print "Synced" while the
   * round trip was still in flight — the same mistake as the `disabled` state, one size
   * down.
   */
  const failed = status?.state === 'error'
  const running = !failed && status?.state === 'syncing'
  const pending = !failed && !running && status?.pending === true
  const tone = failed ? 'error' : running ? 'idle' : pending ? 'warn' : 'ok'
  /*
   * Two strings, not one (item 65).
   *
   * `label` is the bare state, which is what a screen reader is told and what the tests read
   * — "Synced" or "Sync failed" and nothing else, because a status readout is not a place
   * for a timestamp or an instruction. `detail` is the sentence for the tooltip, where
   * there is room for when it last ran and what pressing will do.
   *
   * They were one string before, which meant every hover tooltip read "Last synced
   * 14:02:11." and no tooltip said the state at all — the state being the thing the icon is
   * now for.
   */
  const label = failed
    ? 'Sync failed'
    : running
      ? 'Syncing'
      : pending
        ? 'Not synced yet'
        : 'Synced'
  const detail = failed
    ? (status?.message ?? 'The last sync failed. Press to try again.')
    : running
      ? 'Checking with Dropbox.'
      : pending
        ? 'Changes are waiting to sync. Press to send them now.'
        : status?.lastSyncAt
          ? `Synced. Last synced ${new Date(status.lastSyncAt).toLocaleString()}.`
          : 'Connected. Waiting for the first sync.'

  /*
   * A button that syncs now, rather than a link to the settings page.
   *
   * The label stays the status, because that is what a glance reads and what the tests
   * assert; the action is the one thing a sync control can usefully offer. Disabled while
   * a cycle is in flight, so a second press cannot queue on top of the first.
   */
  return (
    <button
      type="button"
      className={`button sync-indicator sync-indicator-icon sync-indicator-${tone}`}
      data-testid="sync-indicator"
      onClick={syncNow}
      disabled={busy}
      aria-label={label}
      title={detail}
    >
      <CloudStateIcon
        state={failed ? 'failed' : running ? 'syncing' : pending ? 'pending' : 'synced'}
      />
    </button>
  )
}
