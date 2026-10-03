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
  start: () => void
  stop: () => void
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

  const start = useCallback(() => {
    void startTimer(new Date())
  }, [])

  const stop = useCallback(() => {
    if (!running) return
    void stopTimer(running.id, new Date())
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
