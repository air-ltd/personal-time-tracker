import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncScheduler, type SyncStatus } from './scheduler'
import { SyncError, type ProviderStatus, type RemoteFile, type SyncProvider } from './provider'
import type { Snapshot } from '../domain/merge'

/**
 * Token recovery (0012 AU11).
 *
 * A token the provider has rejected is provably unusable — expired, or granted before
 * the app had the permissions it needs. Discarding it turns a dead end into a single
 * reconnect rather than a message explaining that disconnecting is the fix.
 */

class StubProvider implements SyncProvider {
  readonly id = 'stub'
  signedOut = false
  failure: SyncError | null = null

  ensureAuth(): Promise<void> {
    return Promise.resolve()
  }
  signOut(): Promise<void> {
    this.signedOut = true
    return Promise.resolve()
  }
  status(): Promise<ProviderStatus> {
    return Promise.resolve({ authenticated: !this.signedOut, account: null })
  }
  pull(): Promise<RemoteFile | null> {
    return this.failure ? Promise.reject(this.failure) : Promise.resolve(null)
  }
  push(): Promise<{ rev: string }> {
    return this.failure ? Promise.reject(this.failure) : Promise.resolve({ rev: 'r1' })
  }
}

function build(failure: SyncError | null) {
  const provider = new StubProvider()
  provider.failure = failure
  const statuses: SyncStatus[] = []
  const logs: string[] = []
  const snapshot: Snapshot = { schemaVersion: 1, entities: { entries: [] } }

  const scheduler = new SyncScheduler({
    provider,
    path: 'data.json',
    now: () => new Date('2026-10-13T09:00:00.000Z'),
    onStatus: (status) => statuses.push(status),
    onLog: (entry) => logs.push(entry.message),
    readLocal: () => Promise.resolve(snapshot),
    writeLocal: () => Promise.resolve(),
    readLastRev: () => Promise.resolve(null),
    writeLastRev: () => Promise.resolve(),
    writeLastSyncAt: () => Promise.resolve(),
    readLastSyncAt: () => Promise.resolve(null),
  })

  return { provider, scheduler, statuses, logs }
}

describe('a rejected token', () => {
  it.each([
    ['an expired token', 'auth'],
    ['a token without file permissions', 'scope-missing'],
  ])('is discarded on %s', async (_label, kind) => {
    const { provider, scheduler } = build(
      new SyncError(kind as 'auth' | 'scope-missing', 'rejected by provider'),
    )

    const outcome = await scheduler.syncNow()

    expect(outcome).toMatchObject({ status: 'failed', kind })
    expect(provider.signedOut).toBe(true)
    scheduler.stop()
  })

  it('leaves the reason visible instead of silently recovering', async () => {
    const { scheduler, statuses } = build(new SyncError('scope-missing', 'no file permissions'))

    await scheduler.syncNow()

    const last = statuses.at(-1)
    expect(last?.state).toBe('error')
    expect(last?.message).toMatch(/no file permissions/)
    scheduler.stop()
  })

  it('does not discard a token for an unrelated failure', async () => {
    // A network blip is transient; signing out would discard a perfectly good token.
    const { provider, scheduler } = build(new SyncError('network', 'offline'))

    const outcome = await scheduler.syncNow()

    expect(outcome).toMatchObject({ status: 'failed', kind: 'network' })
    expect(provider.signedOut).toBe(false)
    scheduler.stop()
  })

  it('does not discard a token when the sync succeeds', async () => {
    const { provider, scheduler } = build(null)

    await scheduler.syncNow()

    expect(provider.signedOut).toBe(false)
    scheduler.stop()
  })
})

describe('serialising cycles', () => {
  it('does not run two cycles at once (0012 C3)', async () => {
    const { scheduler } = build(null)
    const first = scheduler.syncNow()
    const second = await scheduler.syncNow()

    // The second call is queued rather than run in parallel.
    expect(second).toBeNull()
    await first
    scheduler.stop()
  })
})

/**
 * Triggers (0012 C1–C7).
 *
 * The scheduler owns when a sync happens, and almost none of it is reached by calling
 * `syncNow` directly. These cover the paths that decide *whether* a cycle runs at all,
 * since a trigger that silently stops firing looks exactly like an app that has nothing
 * to sync: no error, no status change, just a device that quietly stops updating.
 *
 * Fake timers throughout, for the debounce window.
 */
describe('triggers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Counts cycles by wrapping the provider the scheduler actually holds. */
  function counting() {
    const built = build(null)
    let pulls = 0
    const original = built.provider.pull.bind(built.provider)
    // The scheduler captured this object in its constructor, so replacing the method
    // here is observed. Building a separate provider would not be.
    built.provider.pull = () => {
      pulls += 1
      return original()
    }
    return { scheduler: built.scheduler, provider: built.provider, pulls: () => pulls }
  }

  it('syncs once when the app opens (C1)', async () => {
    const { scheduler, pulls } = counting()
    await scheduler.start()
    expect(pulls()).toBe(1)
    scheduler.stop()
  })

  it('does not sync again when start is called twice (C1)', async () => {
    const { scheduler, pulls } = counting()
    await scheduler.start()
    await scheduler.start()
    // A second mount-time sync would push a redundant revision on every remount.
    expect(pulls()).toBe(1)
    scheduler.stop()
  })

  it('coalesces a burst of edits into one cycle (C2)', async () => {
    const { scheduler, pulls } = counting()
    await scheduler.start()
    const afterOpen = pulls()

    // Several rapid edits, as typing into a note produces.
    scheduler.schedule()
    scheduler.schedule()
    scheduler.schedule()
    expect(pulls()).toBe(afterOpen)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(pulls()).toBe(afterOpen + 1)
    scheduler.stop()
  })

  it('restarts the quiet period on each edit rather than firing on the first', async () => {
    const { scheduler, pulls } = counting()
    await scheduler.start()
    const afterOpen = pulls()

    // Each edit restarts the 5s quiet period rather than letting the first one fire.
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(4_000)
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(4_000)
    // 8s has passed, but only 4s since the latest edit.
    expect(pulls()).toBe(afterOpen)

    await vi.advanceTimersByTimeAsync(1_500)
    expect(pulls()).toBe(afterOpen + 1)
    scheduler.stop()
  })

  it('syncs when the tab comes back into view', async () => {
    const { scheduler, pulls } = counting()
    await scheduler.start()
    const afterOpen = pulls()

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)

    expect(pulls()).toBe(afterOpen + 1)
    scheduler.stop()
  })

  it('ignores a tab going hidden, which is not a reason to sync', async () => {
    const { scheduler, pulls } = counting()
    await scheduler.start()
    const afterOpen = pulls()

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)

    expect(pulls()).toBe(afterOpen)
    scheduler.stop()
  })

  it('syncs on pagehide, the last chance before the tab goes (W7, C1)', async () => {
    const { scheduler, pulls } = counting()
    await scheduler.start()
    const afterOpen = pulls()

    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)

    expect(pulls()).toBe(afterOpen + 1)
    scheduler.stop()
  })

  /**
   * C6. A background interval would produce empty cycles and keep the device awake for
   * no reason; it would also look identical to a working sync in the UI, since the
   * status line updates either way.
   */
  it('never polls on a background interval (C6)', async () => {
    const { scheduler, pulls } = counting()
    await scheduler.start()
    const afterOpen = pulls()

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

    expect(pulls()).toBe(afterOpen)
    scheduler.stop()
  })

  it('stops without syncing, so teardown is not a write', async () => {
    const { scheduler, pulls } = counting()
    await scheduler.start()
    const afterOpen = pulls()

    scheduler.stop()
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(pulls()).toBe(afterOpen)
  })

  it('defers a cycle requested while one is in flight instead of running both (C3)', async () => {
    const { scheduler, provider } = counting()
    // A gate created before the cycle starts, so `pull` is well-defined whenever the
    // engine reaches it rather than depending on when the test happens to look.
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    provider.pull = () => gate.then(() => null)

    const first = scheduler.syncNow()
    // A second cycle arriving mid-flight must not run in parallel; it is deferred.
    const second = await scheduler.syncNow()
    expect(second).toBeNull()

    release()
    await first
    scheduler.stop()
  })
})

/**
 * The recorded revision is reported, never branched on.
 *
 * An earlier version compared it against the pulled revision to skip publishing, which
 * could not tell "nothing happened anywhere" from "only this device changed" — so local
 * edits and deletions silently never synced. It is now a fact for diagnostics, read once
 * at startup rather than on every cycle.
 */
describe('the last observed revision', () => {
  it('is reported in the status', async () => {
    const statuses: SyncStatus[] = []
    const scheduler = new SyncScheduler({
      provider: new StubProvider(),
      path: 'data.json',
      now: () => new Date('2026-10-13T09:00:00.000Z'),
      onStatus: (status) => statuses.push(status),
      onLog: () => {},
      readLocal: () => Promise.resolve({ schemaVersion: 1, entities: { entries: [] } }),
      writeLocal: () => Promise.resolve(),
      // What a previous cycle would have recorded.
      readLastRev: () => Promise.resolve('rev-42'),
      writeLastRev: () => Promise.resolve(),
      writeLastSyncAt: () => Promise.resolve(),
      readLastSyncAt: () => Promise.resolve(null),
    })

    await scheduler.start()

    expect(statuses.at(-1)?.lastRev).toBe('rev-42')
    scheduler.stop()
  })

  it('is read once at startup, not on every cycle', async () => {
    let reads = 0
    const provider = new StubProvider()
    const scheduler = new SyncScheduler({
      provider,
      path: 'data.json',
      now: () => new Date('2026-10-13T09:00:00.000Z'),
      onStatus: () => {},
      onLog: () => {},
      readLocal: () => Promise.resolve({ schemaVersion: 1, entities: { entries: [] } }),
      writeLocal: () => Promise.resolve(),
      readLastRev: () => {
        reads += 1
        return Promise.resolve(null)
      },
      writeLastRev: () => Promise.resolve(),
      writeLastSyncAt: () => Promise.resolve(),
      readLastSyncAt: () => Promise.resolve(null),
    })

    await scheduler.start()
    await scheduler.syncNow()
    await scheduler.syncNow()

    // Three cycles, one read. Reading per cycle would be an IndexedDB hit to obtain a
    // value nothing consults.
    expect(reads).toBe(1)
    scheduler.stop()
  })
})
