import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { AppDb, setDbForTests } from '../../storage/db'
import { resetRevisionForTests } from '../../storage/events'
import { findRunningEntry, listEntries, startTimer } from '../../storage/entriesRepo'
import { entryDurationMs } from '../../domain/time/duration'
import { useTimer } from './useTimer'
import { T0 } from '../../test/factories'
import type { TimeEntry } from '../../domain/entries/types'

/**
 * Timer hook behaviour (0004 T1–T6, D1).
 *
 * The repository layer is already covered. What this adds is the behaviour that only
 * exists in the hook: elapsed time derived from timestamps rather than accumulated, a
 * timer read back from storage on mount, and a stop that uses one instant for both the
 * stored end and the displayed duration.
 *
 * Fake timers throughout, and the system clock is set rather than merely advancing
 * time: a test that only advances timers can still pass if the duration were being
 * accumulated, because an accumulated counter and a recomputed one agree while ticking
 * regularly.
 */

let db: AppDb
let counter = 0

beforeEach(() => {
  db = new AppDb(`timer-${(counter += 1)}`)
  setDbForTests(db)
  resetRevisionForTests()
  // Only the clock and the UI interval are faked. Dexie schedules its transactions
  // with setImmediate, and faking that stalls every read and write until a timer is
  // advanced — which showed up as five-second timeouts rather than as a real failure.
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  })
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Run a state change inside `act` and let the resulting storage reads settle.
 *
 * The awaits matter: every one of these calls writes to IndexedDB and the hook then
 * re-reads, so returning before the promise chain drains would assert against the
 * previous state.
 */
async function run(action: () => void): Promise<void> {
  await act(async () => {
    action()
    await Promise.resolve()
  })
  await settle()
}

/** Let the hook's storage reads settle. */
async function settle(): Promise<void> {
  // Several turns: the write, the revision bump, the effect's re-read, then the
  // interval's first tick.
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

describe('useTimer', () => {
  it('starts idle', async () => {
    const { result } = renderHook(() => useTimer())
    await settle()

    expect(result.current.running).toBeNull()
    expect(result.current.elapsedMs).toBeNull()
  })

  it('reports a running entry started through the hook', async () => {
    const { result } = renderHook(() => useTimer())
    await settle()

    await run(() => result.current.start())

    expect(result.current.running).not.toBeNull()
    expect(result.current.running?.end).toBeNull()
  })

  it('derives elapsed from the clock rather than counting ticks', async () => {
    const { result } = renderHook(() => useTimer())
    await settle()
    await run(() => result.current.start())

    // Jump an hour without ticking. An accumulating implementation would report about
    // a second here, which is the bug (0004 D1).
    await run(() => {
      vi.setSystemTime(new Date(T0.getTime() + 60 * 60 * 1000))
      vi.advanceTimersByTime(1000)
    })

    // Asserted against the clock rather than a literal, so the extra second the forced
    // tick contributes does not have to be accounted for by hand.
    const running = result.current.running as TimeEntry
    expect(result.current.elapsedMs).toBe(Date.now() - Date.parse(running.start))
    // The point of the test: roughly an hour, not roughly the one tick that just fired.
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(60 * 60 * 1000)
  })

  it('survives a reload, reading the running entry back from storage', async () => {
    // Started, then the page "reloads": the in-memory state is gone but the record is
    // not, which is the whole point of a wall-clock timer.
    await startTimer(new Date(T0.getTime() - 45 * 60 * 1000))

    const { result } = renderHook(() => useTimer())
    await settle()

    expect(result.current.running).not.toBeNull()
    // Duration recomputed from `start` and now, not restored from a stored counter.
    expect(result.current.elapsedMs).toBe(45 * 60 * 1000)
  })

  it('does not create a second entry when start is called twice', async () => {
    const { result } = renderHook(() => useTimer())
    await settle()

    // Two starts in one tick, as a double-click produces.
    await run(() => {
      result.current.start()
      result.current.start()
    })

    const entries = await listEntries()
    expect(entries).toHaveLength(1)
    expect(await findRunningEntry()).toBeDefined()
  })

  it('uses one instant for both the stored end and the updatedAt', async () => {
    // 0004 T3. Two separate `new Date()` calls can straddle a tick boundary and record
    // an end a second later than the duration shown, so the entry would not add up.
    const { result } = renderHook(() => useTimer())
    await settle()
    await run(() => result.current.start())

    vi.setSystemTime(new Date(T0.getTime() + 90 * 60 * 1000))
    await run(() => result.current.stop())

    const [stopped] = await listEntries()
    expect(stopped?.end).toBe(new Date(T0.getTime() + 90 * 60 * 1000).toISOString())
    expect(stopped?.updatedAt).toBe(stopped?.end)

    // And the duration a user sees equals the duration the record holds.
    expect(entryDurationMs(stopped as TimeEntry, new Date())).toBe(90 * 60 * 1000)
  })

  it('returns to idle after stopping', async () => {
    const { result } = renderHook(() => useTimer())
    await settle()
    await run(() => result.current.start())

    await run(() => result.current.stop())

    expect(result.current.running).toBeNull()
    expect(result.current.elapsedMs).toBeNull()
  })

  it('stopping twice keeps the first end rather than moving it', async () => {
    const { result } = renderHook(() => useTimer())
    await settle()
    await run(() => result.current.start())

    await run(() => result.current.stop())
    const first = (await listEntries())[0]?.end

    vi.setSystemTime(new Date(T0.getTime() + 10 * 60 * 1000))
    await run(() => result.current.stop())

    // Time passing after the stop must not extend the entry.
    expect((await listEntries())[0]?.end).toBe(first)
  })

  it('discarding leaves no zero-length active entry', async () => {
    const { result } = renderHook(() => useTimer())
    await settle()
    await run(() => result.current.start())

    await run(() => result.current.discard())

    expect(result.current.running).toBeNull()
    // 0004 T6: a mis-click must not leave an empty record in the list.
    expect(await listEntries()).toHaveLength(0)
  })

  it('does not tick while idle, so the tab is not kept awake', async () => {
    const setInterval = vi.spyOn(window, 'setInterval')

    renderHook(() => useTimer())
    await settle()

    // No running entry, so there is nothing to update and no interval to justify it.
    expect(setInterval).not.toHaveBeenCalled()
  })
})
