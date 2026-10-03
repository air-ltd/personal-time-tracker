import { useCallback, useEffect, useRef, useState } from 'react'
import { SyncScheduler, type SyncStatus } from '../../sync/scheduler'
import {
  indexedDbDropboxProvider,
  resetProvider,
  REMOTE_PATH,
} from '../../sync/providerFactory'
import { DropboxSetup } from './DropboxSetup'
import { readAppKey } from '../../sync/appKey'

/**
 * Sync controls (0012 C8, AU8).
 *
 * A sync that fails silently is worse than no sync, because the user assumes the
 * other device is current. So the status is always visible once sync is configured:
 * last synced, an in-progress state, and any error.
 */

type Connection = 'checking' | 'connected' | 'disconnected'

export function SyncPanel() {
  const [connection, setConnection] = useState<Connection>('checking')
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [busy, setBusy] = useState(false)
  // Read at runtime rather than from a module constant: the app key can be entered
  // in the browser, which is the point of item 6 in SPECS/todo.md.
  const [hasKey, setHasKey] = useState(() => readAppKey() !== '')
  const schedulerRef = useRef<SyncScheduler | null>(null)

  const provider = indexedDbDropboxProvider()

  useEffect(() => {
    let cancelled = false
    void provider.status().then((status) => {
      if (!cancelled) setConnection(status.authenticated ? 'connected' : 'disconnected')
    })
    return () => {
      cancelled = true
    }
  }, [provider])

  // Start scheduling only once connected. Running the cycle while signed out would
  // report a failure the user cannot act on.
  useEffect(() => {
    if (connection !== 'connected') return
    const scheduler = new SyncScheduler({
      provider,
      path: REMOTE_PATH,
      onStatus: setStatus,
    })
    schedulerRef.current = scheduler
    void scheduler.start()
    return () => {
      scheduler.stop()
      schedulerRef.current = null
    }
  }, [connection, provider])

  const onConnect = useCallback(async () => {
    setBusy(true)
    try {
      const state = crypto.randomUUID()
      const { url } = await provider.beginAuth(state)
      window.location.assign(url)
    } catch {
      setBusy(false)
      setConnection('disconnected')
    }
  }, [provider])

  const onDisconnect = useCallback(async () => {
    setBusy(true)
    await provider.signOut()
    setBusy(false)
    setConnection('disconnected')
  }, [provider])

  const onSyncNow = useCallback(async () => {
    setBusy(true)
    try {
      await schedulerRef.current?.syncNow()
    } finally {
      setBusy(false)
    }
  }, [])

  if (!hasKey) {
    return (
      <section className="panel" aria-labelledby="sync-heading">
        <h2 id="sync-heading">Sync</h2>
        <p className="hint">
          Connect a Dropbox account to use your entries on more than one device. Everything
          works without it — your data stays in this browser.
        </p>
        <DropboxSetup
          onConfigured={() => {
            // The cached provider holds the previous key, so rebuild it or OAuth
            // would fail confusingly against a stale client id.
            resetProvider()
            setHasKey(readAppKey() !== '')
          }}
        />
      </section>
    )
  }

  return (
    <section className="panel" aria-labelledby="sync-heading">
      <h2 id="sync-heading">Sync</h2>

      <div className="button-row">
        {connection === 'connected' ? (
          <>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void onSyncNow()}
              disabled={busy}
            >
              Sync now
            </button>
            <button
              type="button"
              className="button"
              onClick={() => void onDisconnect()}
              disabled={busy}
            >
              Disconnect
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button-primary"
            onClick={() => void onConnect()}
            disabled={busy}
          >
            Connect Dropbox
          </button>
        )}
      </div>

      <SyncStatusLine status={status} connection={connection} />

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
}: {
  status: SyncStatus | null
  connection: Connection
}) {
  if (connection === 'disconnected') {
    return (
      <p className="hint" data-testid="sync-status">
        Not connected. Entries are saved here only.
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
