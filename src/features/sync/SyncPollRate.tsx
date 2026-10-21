import { useEffect, useState } from 'react'
import {
  DEFAULT_SYNC_POLL_INTERVAL_SECONDS,
  readSyncPollIntervalSeconds,
  writeSyncPollIntervalSeconds,
} from '../../storage/settingsRepo'

/**
 * How often to check Dropbox for another device's work (item 75).
 *
 * The rates offered are the ones that make sense as intervals, rather than a free
 * number box: the difference between five and ten seconds is a real cost, and the
 * difference between ten and eleven is not.
 *
 * "Off" is offered because a check costs something, and the right cost depends on how
 * the app is being used — a phone on a metered connection and a desktop with two
 * monitors are not the same question. Turning it off does not stop the app syncing:
 * it still syncs when the tab is opened, when it comes back into view, and after a
 * change made here.
 */
const RATE_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 5, label: 'Every 5 seconds' },
  { value: 10, label: 'Every 10 seconds' },
  { value: 30, label: 'Every 30 seconds' },
  { value: 60, label: 'Every minute' },
]

export function SyncPollRate() {
  const [seconds, setSeconds] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void readSyncPollIntervalSeconds()
      .then((value) => {
        if (!cancelled) setSeconds(value)
      })
      .catch(() => {
        if (!cancelled) setSeconds(DEFAULT_SYNC_POLL_INTERVAL_SECONDS)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (seconds === null) return null

  return (
    <div className="field">
      <label htmlFor="sync-poll-rate">Check for other devices</label>
      <select
        id="sync-poll-rate"
        value={String(seconds)}
        onChange={(event) => {
          const next = Number(event.target.value)
          setSeconds(next)
          void writeSyncPollIntervalSeconds(next)
        }}
      >
        {RATE_OPTIONS.map((option) => (
          <option key={option.value} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="hint">
        How often this app asks Dropbox whether another device has recorded something. Each
        check asks for the file&apos;s revision rather than downloading it, and a check only
        downloads the file when it has actually changed.
      </p>
    </div>
  )
}
