import { describe, expect, it } from 'vitest'
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
