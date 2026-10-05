import { useCallback, useEffect, useState } from 'react'
import {
  discardTimer,
  findRunningEntry,
  startTimer,
  stopTimer,
} from '../../storage/entriesRepo'
import { entryDurationMs } from '../../domain/time/duration'
import type { TimeEntry } from '../../domain/entries/types'
import { useRevision } from '../../storage/useRevision'

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
  /** Why the last start or discard failed, if one did. */
  error: string | null
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
  const revision = useRevision()
  const [running, setRunning] = useState<TimeEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let cancelled = false
    void findRunningEntry()
      .then((entry) => {
        if (!cancelled) setRunning(entry ?? null)
      })
      // Swallowed, and null is the right answer: with no readable database there is no
      // running timer to show, and an unhandled rejection here fails a whole test file on
      // an error nothing displays. `TimerPanel` renders the idle state, which is honest —
      // the app cannot claim a timer is running when it cannot read one.
      .catch(() => {
        if (!cancelled) setRunning(null)
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
    // Caught rather than left unhandled: a refused write would otherwise leave the button
    // appearing to do nothing, and would fail a whole test file on an error nothing shows.
    void startTimer(new Date(), projectId).catch((problem: unknown) => {
      setError(problem instanceof Error ? problem.message : String(problem))
    })
  }, [])

  const stop = useCallback(async () => {
    if (!running) return
    await stopTimer(running.id, new Date())
  }, [running])

  const discard = useCallback(() => {
    if (!running) return
    void discardTimer(running.id, new Date()).catch((problem: unknown) => {
      setError(problem instanceof Error ? problem.message : String(problem))
    })
  }, [running])

  return {
    running,
    elapsedMs: running ? entryDurationMs(running, now) : null,
    /**
     * A start or discard that failed.
     *
     * Carried rather than swallowed so the panel can say so. A refused write that reports
     * nothing leaves the button looking inert, which is the silent-failure shape this
     * codebase keeps arguing against — the read failure above is different: there, "no
     * timer" is the honest answer, and there is nothing the user pressed that did not work.
     */
    error,
    start,
    stop,
    discard,
  }
}
