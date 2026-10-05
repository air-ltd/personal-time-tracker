import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncScheduler, type SyncStatus } from './scheduler'
import { SyncError, type ProviderStatus, type RemoteFile, type SyncProvider } from './provider'
import type { Snapshot } from '../domain/merge'
import { bumpRevision, resetRevisionForTests } from '../storage/events'

/**
 * Token recovery.
 *
 * Cites 0012 AU7 (sign-out clears tokens and sync metadata but not local data) and
 * SY8 (provider errors are normalised into a small shared set). The recovery rule itself
 * is this project's: a token the provider has rejected is provably unusable — expired, or
 * granted before the app had the permissions it needs — so discarding it turns a dead end
 * into a single reconnect rather than a message explaining that disconnecting is the fix.
 *
 * There was no `AU11`; an earlier version of this comment cited one, and a citation that
 * resolves to nothing is the one comment a reader cannot check.
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

  it('reports an unusable token rather than recovering silently', async () => {
    const { scheduler, statuses } = build(new SyncError('auth', 'token expired'))

    await scheduler.syncNow()

    const last = statuses.at(-1)
    expect(last?.state).toBe('error')
    expect(last?.message).toMatch(/expired|no longer valid/i)
    expect(last?.message).toMatch(/safe in this browser/i)
    scheduler.stop()
  })

  it('says the same thing for a missing scope, which is not fixable by reauthorising', async () => {
    /*
     * Previously this branched: a `scope-missing` failure got a message naming the Dropbox
     * App Console and the redirect URI, and `auth` got the provider's own words.
     *
     * The branch was the problem as much as the wording. The scheduler cannot tell an
     * expired token from a revoked one from a permissions change — all three arrive as
     * "this token will not work" — so choosing between two confident explanations is a
     * guess, and a guess that sends the user to the App Console when their real problem is
     * an expired token costs them an afternoon. One honest message, and the connection
     * state that tells them reconnecting is what to do.
     */
    const { scheduler, statuses } = build(new SyncError('scope-missing', 'no file permissions'))

    await scheduler.syncNow()

    const last = statuses.at(-1)
    expect(last?.state).toBe('error')
    expect(last?.message).toMatch(/expired|no longer valid/i)
    scheduler.stop()
  })

  it('tells the connection owner, so the Connect button can come back', async () => {
    /*
     * The bug this covers: `signOut()` clears the token store and tells nobody, and
     * `connection` is otherwise read once at mount. The scheduler could discard a token
     * and the app would go on rendering a connected state — the Connect button that would
     * fix it never appeared, so the user had no way back.
     */
    let told = 0
    const built = build(new SyncError('auth', 'expired'))
    const scheduler = new (built.scheduler.constructor as typeof SyncScheduler)({
      provider: built.provider,
      path: 'data.json',
      now: () => new Date('2026-10-13T09:00:00.000Z'),
      onStatus: () => undefined,
      onAuthLost: () => {
        told += 1
      },
      readLocal: () => Promise.resolve({ schemaVersion: 1, entities: { entries: [] } }),
      writeLocal: () => Promise.resolve(),
      readLastRev: () => Promise.resolve(null),
      writeLastRev: () => Promise.resolve(),
      writeLastSyncAt: () => Promise.resolve(),
      readLastSyncAt: () => Promise.resolve(null),
    })

    await scheduler.syncNow()

    expect(told).toBe(1)
    expect(built.provider.signedOut).toBe(true)
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
/**
 * An expired token (0012 AU8).
 *
 * The chain this covers produced a green "Synced" indefinitely: the provider's
 * `hasUsableToken()` is false for an expired token, `ensureAuth` throws, the engine's
 * pre-flight catches it and returns `skipped` / `not-authenticated` rather than `failed`,
 * and the scheduler mapped `skipped` to a `disabled` state that no view rendered — so the
 * indicator's `failed` test (`state === 'error'`) was false and it showed success. The
 * Connect button never reappeared either, because `connection` was read once at mount and
 * `signOut()` tells nobody.
 *
 * Every one of those is a separate decision, so each is asserted here rather than inferred
 * from the message.
 */
describe('a token that has expired', () => {
  it('is reported as an error, not as success or as "disabled"', async () => {
    const { scheduler, statuses, provider } = build(null)
    // A provider that is connected but whose token will not work: the state the app is in
    // after the stored token expires, and the only state in which the scheduler runs.
    provider.ensureAuth = () => Promise.reject(new SyncError('auth', 'Not connected.'))

    await scheduler.syncNow()

    const last = statuses.at(-1)
    expect(last?.state).toBe('error')
    expect(last?.lastOutcome).toMatchObject({ status: 'skipped' })
    scheduler.stop()
  })

  it('discards the token and says the connection was lost', async () => {
    const { scheduler, provider } = build(null)
    provider.ensureAuth = () => Promise.reject(new SyncError('auth', 'Not connected.'))
    let authLost = 0
    const schedulerWithHook = new (scheduler.constructor as typeof SyncScheduler)({
      provider,
      path: 'data.json',
      onStatus: () => undefined,
      onAuthLost: () => {
        authLost += 1
      },
      readLocal: () => Promise.resolve({ schemaVersion: 1, entities: { entries: [] } }),
      writeLocal: () => Promise.resolve(),
      readLastRev: () => Promise.resolve(null),
      writeLastRev: () => Promise.resolve(),
      writeLastSyncAt: () => Promise.resolve(),
      readLastSyncAt: () => Promise.resolve(null),
    })

    await schedulerWithHook.syncNow()

    expect(provider.signedOut).toBe(true)
    expect(authLost).toBe(1)
    schedulerWithHook.stop()
  })

  it('never reports "up to date" for a cycle that did not run', async () => {
    // The claim the green dot was making. A skipped cycle published nothing, so saying
    // it was up to date is a statement about work the app never checked.
    const { scheduler } = build(null)
    const provider = scheduler['provider'] as unknown as { ensureAuth: () => Promise<void> }
    provider.ensureAuth = () => Promise.reject(new SyncError('auth', 'Not connected.'))

    const outcome = await scheduler.syncNow()

    expect(outcome).toMatchObject({ status: 'skipped', reason: 'not-authenticated' })
    scheduler.stop()
  })
})

describe('triggers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // The revision counter is module-level, so a scheduler left subscribed by an earlier
    // test would still be listening and would make these counts depend on test order.
    resetRevisionForTests()
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
    return {
      scheduler: built.scheduler,
      provider: built.provider,
      statuses: built.statuses,
      pulls: () => pulls,
    }
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

  it('syncs after a local write, without anything asking it to (C1, C2)', async () => {
    // The trigger that was missing. `schedule()` was implemented, debounced and tested,
    // and nothing in the app ever called it — so 0012 C1's "a local write" was the one
    // trigger of five that did not fire, and it did so silently: no error, no status
    // change, just two devices open side by side that never saw each other's work.
    const { scheduler, pulls } = counting()
    await scheduler.start()
    const afterOpen = pulls()

    // Exactly what every write path already does.
    bumpRevision()

    expect(pulls()).toBe(afterOpen)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(pulls()).toBe(afterOpen + 1)
    scheduler.stop()
  })

  it('does not schedule a cycle for the write its own merge made', async () => {
    // Without this the scheduler would publish what it had just written: a pull that
    // brings remote data writes locally, bumps the revision, and triggers a second
    // round trip that finds nothing to do. Every pull would cost two cycles.
    let writes = 0
    const provider = new StubProvider()
    const statuses: SyncStatus[] = []
    const scheduler = new SyncScheduler({
      provider,
      path: 'data.json',
      now: () => new Date('2026-10-13T09:00:00.000Z'),
      onStatus: (status) => statuses.push(status),
      readLocal: () => Promise.resolve({ schemaVersion: 1, entities: { entries: [] } }),
      // Stands in for a merge: a write that bumps the revision, as `writeSnapshot` does.
      writeLocal: () => {
        writes += 1
        bumpRevision()
        return Promise.resolve()
      },
      readLastRev: () => Promise.resolve(null),
      writeLastRev: () => Promise.resolve(),
      writeLastSyncAt: () => Promise.resolve(),
      readLastSyncAt: () => Promise.resolve(null),
    })

    // Remote has an entry this device does not, so the engine merges and writes locally.
    provider.pull = () =>
      Promise.resolve({
        rev: 'r9',
        body: JSON.stringify({
          format: 'personal-time-tracker-backup',
          formatVersion: 1,
          schemaVersion: 1,
          exportedAt: '2026-10-13T09:00:00.000Z',
          counts: { entries: 1 },
          data: {
            entries: [
              {
                id: 'from-elsewhere',
                projectId: null,
                tagIds: [],
                start: '2026-10-13T08:00:00.000Z',
                end: '2026-10-13T09:00:00.000Z',
                note: '',
                billable: false,
                rateOverrideMinor: null,
                source: 'manual',
                createdAt: '2026-10-13T08:00:00.000Z',
                updatedAt: '2026-10-13T08:00:00.000Z',
                deletedAt: null,
              },
            ],
            projects: [],
            clients: [],
            tags: [],
            contractPeriods: [],
            nonWorkingDays: [],
          },
        }),
      })

    await scheduler.start()
    expect(writes).toBe(1)

    // The scheduler's own write must not arm the debounce.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(writes).toBe(1)
    expect(scheduler.getStatus().pending).toBe(false)
    scheduler.stop()
  })

  it('stops responding to writes once stopped', async () => {
    const { scheduler, pulls } = counting()
    await scheduler.start()
    scheduler.stop()
    const afterStop = pulls()

    bumpRevision()
    await vi.advanceTimersByTimeAsync(10_000)

    // The subscription has to be detached in `stop()`, not just the timer cleared, or a
    // torn-down scheduler keeps syncing.
    expect(pulls()).toBe(afterStop)
  })

  it('reports a pending change while one is waiting to go out (C8)', async () => {
    // 0012 C8 requires pending changes to be visible. `lastSyncAt` is about the past and
    // `state` is about the current cycle, so neither can answer "is my work on the other
    // device yet?" — which is the question the indicator exists for.
    const { scheduler, statuses } = counting()
    await scheduler.start()

    bumpRevision()
    expect(scheduler.getStatus().pending).toBe(true)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(scheduler.getStatus().pending).toBe(false)
    expect(statuses.at(-1)?.pending).toBe(false)
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
