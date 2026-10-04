import { useCallback, useEffect, useRef, useState } from 'react'
import { SyncScheduler, type SyncStatus } from '../../sync/scheduler'
import {
  indexedDbDropboxProvider,
  resetProvider,
  REMOTE_PATH,
} from '../../sync/providerFactory'
import { describeKeySource, readAppKey } from '../../sync/appKey'
import { beginAuthCallback, takeAuthError } from '../../sync/oauthCallback'
import { SyncContext, type Connection } from './syncContext'

/**
 * Shared sync state (item 10 of `SPECS/todo.md`).
 *
 * The header shows whether sync is connected, and the settings page shows the detail.
 * Both read one instance of this, because the alternative is worse than duplication: two
 * owners of the connection would mean two schedulers, and the provider caches a single
 * PKCE verifier, so an authorisation begun from one could not be completed by the other
 * (0012 AU8).
 *
 * So the state lives here, mounted once at the app root, and the two places present it
 * differently rather than owning it separately.
 *
 * A sync that fails silently is worse than no sync, because the user assumes the other
 * device is current. So the state always distinguishes connected, checking and
 * disconnected, and never reports "fine" when it has not asked.
 */

/**
 * Owns the connection, the scheduler and the last sync status, once, for the whole app.
 *
 * Mounted at the app root so the header indicator and the settings panel read the same
 * state. See `syncContext.ts` for why that has to be shared rather than duplicated.
 */
export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [connection, setConnection] = useState<Connection>('checking')
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [busy, setBusy] = useState(false)
  // Read at runtime rather than from a module constant: the app key can be entered in
  // the browser, which is the point of item 6 in SPECS/todo.md.
  const [hasKey, setHasKey] = useState(() => readAppKey() !== '')
  const keyInfo = describeKeySource()
  // Read once at mount: a one-shot value left behind by the redirect, consumed during
  // initialisation rather than in an effect so it does not cause a cascading render.
  const [authError] = useState<string | null>(() => takeAuthError())
  const schedulerRef = useRef<SyncScheduler | null>(null)

  const provider = indexedDbDropboxProvider()

  useEffect(() => {
    let cancelled = false
    // Wait for any redirect callback to finish before asking whether we are connected.
    // Otherwise the check races the token write and reports "not connected" for an
    // authorisation that in fact worked.
    void beginAuthCallback()
      .then(() => provider.status())
      .then((result) => {
        if (!cancelled) setConnection(result.authenticated ? 'connected' : 'disconnected')
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

  const connect = useCallback(() => {
    setBusy(true)
    void provider
      .beginAuth(crypto.randomUUID())
      .then(({ url }) => {
        // Intentionally not awaited afterwards: this navigates away from the document,
        // and anything queued here would never run.
        window.location.assign(url)
      })
      .catch(() => {
        setBusy(false)
        setConnection('disconnected')
      })
  }, [provider])

  const disconnect = useCallback(() => {
    setBusy(true)
    void provider.signOut().then(() => {
      setBusy(false)
      setConnection('disconnected')
    })
  }, [provider])

  const syncNow = useCallback(() => {
    setBusy(true)
    void Promise.resolve(schedulerRef.current?.syncNow()).finally(() => setBusy(false))
  }, [])

  const recheckKey = useCallback(() => {
    // The cached provider holds the previous key, so rebuild it or OAuth would fail
    // confusingly against a stale client id.
    resetProvider()
    setHasKey(readAppKey() !== '')
  }, [])

  return (
    <SyncContext.Provider
      value={{
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
      }}
    >
      {children}
    </SyncContext.Provider>
  )
}
