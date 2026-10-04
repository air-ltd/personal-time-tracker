import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  discardTimer,
  findRunningEntry,
  startTimer,
  stopTimer,
} from '../../storage/entriesRepo'
import { getRevision, subscribe } from '../../storage/events'
import { entryDurationMs } from '../../domain/time/duration'
import type { TimeEntry } from '../../domain/entries/types'

export interface TimerState {
  running: TimeEntry | null
  /** Elapsed ms for the running entry, ticking once a second. Null when idle. */
  elapsedMs: number | null
  /**
   * Start a timer, optionally against a project.
   *
   * Takes the project because the timer panel offers a button per client (item 12), and
   * that client's default project is the obvious place for the time to land — the user
   * chose the client by pressing its button, so choosing the project too is not an extra
   * decision, it is the one already made.
   */
  start: (projectId?: string | null) => void
  /**
   * Resolves once the entry is written.
   *
   * Awaitable because callers navigate on the strength of it. Stopping navigates to the
   * entry, and that route reads the entry straight back; a fire-and-forget stop races
   * that read and the user is told the entry does not exist.
   */
  stop: () => Promise<void>
  discard: () => void
}

const TICK_MS = 1000

/**
 * Timer state machine (0004 T1–T6).
 *
 * The elapsed value is derived from timestamps on every tick, never accumulated
 * (0004 D1). That is what lets a timer survive a reload: on mount the running
 * entry is read back from storage and its duration recomputed from `now`.
 */
export function useTimer(): TimerState {
  const revision = useSyncExternalStore(subscribe, getRevision, getRevision)
  const [running, setRunning] = useState<TimeEntry | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let cancelled = false
    void findRunningEntry().then((entry) => {
      if (!cancelled) setRunning(entry ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [revision])

  const runningId = running?.id ?? null

  // Tick only while running. An idle timer has nothing to update, and a permanent
  // interval would keep the tab awake for no reason.
  useEffect(() => {
    if (!runningId) return
    // Refresh on the next task rather than synchronously in the effect body: if the
    // app sat idle before the timer started, `now` would otherwise still be the
    // mount time and the first frame could render a stale or negative elapsed.
    const immediate = window.setTimeout(() => setNow(new Date()), 0)
    const id = window.setInterval(() => setNow(new Date()), TICK_MS)
    return () => {
      window.clearTimeout(immediate)
      window.clearInterval(id)
    }
  }, [runningId])

  const start = useCallback((projectId: string | null = null) => {
    void startTimer(new Date(), projectId)
  }, [])

  const stop = useCallback(async () => {
    if (!running) return
    await stopTimer(running.id, new Date())
  }, [running])

  const discard = useCallback(() => {
    if (!running) return
    void discardTimer(running.id, new Date())
  }, [running])

  return {
    running,
    elapsedMs: running ? entryDurationMs(running, now) : null,
    start,
    stop,
    discard,
  }
}
