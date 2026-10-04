import { useSync, type Connection } from './syncContext'
import { DropboxSetup } from './DropboxSetup'

/**
 * Sync detail (0012 C8, AU8; item 10 of `SPECS/todo.md`).
 *
 * Moved to the settings page: the header carries the indicator, and this carries what
 * you do about it. A sync that fails silently is worse than no sync, because the user
 * assumes the other device is current, so the state is always spelled out — last synced,
 * in progress, or the error.
 *
 * The state itself belongs to `<SyncProvider>`, because the header indicator reads the
 * same connection and the provider caches one PKCE verifier (0012 AU8).
 */

export function SyncPanel() {
  const {
    connection,
    status,
    busy,
    hasKey,
    keyInfo,
    authError,
    connect,
    disconnect,
    syncNow,
    recheckKey,
  } = useSync()

  if (!hasKey) {
    return (
      <section className="panel" aria-labelledby="sync-heading">
        <h2 id="sync-heading">Sync</h2>
        <p className="hint">
          Connect a Dropbox account to use your entries on more than one device. Everything
          works without it — your data stays in this browser.
        </p>
        <DropboxSetup onConfigured={recheckKey} />
      </section>
    )
  }

  return (
    <section className="panel" aria-labelledby="sync-heading">
      <h2 id="sync-heading">
        Sync{' '}
        <span
          className={`badge badge-${keyInfo.environment}`}
          data-testid="sync-environment"
          title={
            keyInfo.source === 'environment'
              ? 'Using the key from the build configuration'
              : `Using the key built in for the ${keyInfo.environment} environment`
          }
        >
          {keyInfo.environment === 'production' ? 'production' : 'non-production'}
        </span>
      </h2>

      <div className="button-row">
        {connection === 'connected' ? (
          <>
            <button
              type="button"
              className="button button-primary"
              onClick={syncNow}
              disabled={busy}
            >
              Sync now
            </button>
            <button type="button" className="button" onClick={disconnect} disabled={busy}>
              Disconnect
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button-primary"
            onClick={connect}
            disabled={busy}
          >
            Connect Dropbox
          </button>
        )}
      </div>

      {authError && (
        <p className="alert alert-error" role="alert" data-testid="auth-error">
          Dropbox authorisation failed: {authError}
        </p>
      )}

      <SyncStatusLine status={status} connection={connection} authError={authError} />

      <p className="hint">
        Your data stays in this browser. Syncing copies one file to the Dropbox account you
        connect, and disconnecting leaves your data here untouched.
      </p>
    </section>
  )
}

function SyncStatusLine({
  status,
  connection,
  authError,
}: {
  status: ReturnType<typeof useSync>['status']
  connection: Connection
  authError: string | null
}) {
  if (connection === 'disconnected') {
    return (
      <p className="hint" data-testid="sync-status">
        Not connected. Entries are saved here only.
        {authError ? ' The last attempt failed — see the message above.' : ''}
      </p>
    )
  }
  if (!status) return null

  if (status.state === 'syncing') {
    return (
      <p className="hint" data-testid="sync-status">
        Syncing…
      </p>
    )
  }
  if (status.state === 'error') {
    return (
      <p className="alert alert-error" role="status" data-testid="sync-status">
        {status.message ?? 'Sync failed.'} Your data is safe in this browser.
      </p>
    )
  }
  return (
    <p className="hint" data-testid="sync-status">
      {status.lastSyncAt
        ? `Last synced ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(status.lastSyncAt))}.`
        : 'Connected. Waiting for the first sync.'}
    </p>
  )
}
