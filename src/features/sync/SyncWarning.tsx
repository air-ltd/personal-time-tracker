import { useEffect, useState } from 'react'
import { useSync } from './syncContext'
import {
  readSyncWarningSnoozedUntil,
  writeSyncWarningSnoozedUntil,
} from '../../storage/syncWarningRepo'

export const SYNC_WARNING_SNOOZE_MS = 5 * 60 * 60 * 1000

/**
 * The prominent in-app failure notice for sync (item 86 of `SPECS/todo.md`).
 *
 * It sits outside the routed page so a failure is visible wherever the user
 * happens to be, and it offers the one action that state calls for: reconnect
 * when the token is gone, retry when a cycle failed, and hide for five hours
 * when the user cannot deal with it now. A silent failure is the specific thing
 * 0012 C8 forbids, so this is deliberately louder than the header indicator.
 */
export function SyncWarning() {
  const { connection, status, busy, hasKey, connectionLost, warningError, connect, syncNow } =
    useSync()
  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null)
  const [snoozeLoaded, setSnoozeLoaded] = useState(false)
  const [snoozeError, setSnoozeError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    void readSyncWarningSnoozedUntil()
      .then((timestamp) => {
        if (!cancelled) setSnoozedUntil(timestamp)
      })
      .catch((problem: unknown) => {
        if (!cancelled) {
          setSnoozeError(problem instanceof Error ? problem.message : String(problem))
        }
      })
      .finally(() => {
        if (!cancelled) setSnoozeLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (snoozedUntil === null) return
    const remaining = snoozedUntil - now
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setNow(Date.now()), remaining)
    return () => window.clearTimeout(timer)
  }, [now, snoozedUntil])

  const hasSyncFailure = status?.state === 'error'
  const hasConnectionProblem =
    hasKey && (hasSyncFailure || (connection === 'disconnected' && connectionLost))
  const visible =
    (hasConnectionProblem && snoozeLoaded && (snoozedUntil === null || snoozedUntil <= now)) ||
    warningError !== null ||
    snoozeError !== null

  if (!visible) return null

  const retryConnect = connection === 'disconnected'
  const message = hasSyncFailure
    ? (status.message ?? 'Dropbox could not complete the last sync.')
    : connectionLost
      ? 'The Dropbox connection was lost, so changes are no longer syncing.'
      : null

  const snooze = async () => {
    const until = Date.now() + SYNC_WARNING_SNOOZE_MS
    try {
      await writeSyncWarningSnoozedUntil(until)
      setSnoozedUntil(until)
      setNow(Date.now())
      setSnoozeError(null)
    } catch (problem) {
      setSnoozeError(problem instanceof Error ? problem.message : String(problem))
    }
  }

  return (
    <section className="alert alert-error sync-warning" role="alert" data-testid="sync-warning">
      <h2>
        {hasConnectionProblem
          ? 'Dropbox sync needs attention'
          : 'Could not check the Dropbox warning'}
      </h2>
      {message !== null && <p>{message}</p>}
      {hasConnectionProblem && (
        <p>
          Your entries are safe in this browser, but recent changes may not be available on your
          other devices.
        </p>
      )}
      {(warningError !== null || snoozeError !== null) && (
        <p>
          The warning preference could not be saved or loaded: {warningError ?? snoozeError}
        </p>
      )}
      {hasConnectionProblem && (
        <div className="button-row">
          <button
            type="button"
            className="button button-primary"
            onClick={retryConnect ? connect : syncNow}
            disabled={busy}
          >
            {retryConnect ? 'Reconnect Dropbox' : 'Try again now'}
          </button>
          <button type="button" className="button" onClick={() => void snooze()}>
            Hide for 5 hours
          </button>
        </div>
      )}
    </section>
  )
}
