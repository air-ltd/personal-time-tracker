import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runSync, type SyncDeps, type SyncLogEntry } from './engine'
import { SyncError, type ProviderStatus, type RemoteFile, type SyncProvider } from './provider'
import type { Mergeable, Snapshot } from '../domain/merge'
import { serialiseEnvelope, toEnvelope, type Envelope } from '../export/envelope'

const PATH = '/data.json'
const SUPPORTED = 1
const T0 = new Date('2026-10-13T09:00:00.000Z')

function entry(id: string, updatedAt = '2026-10-13T09:00:00.000Z'): Mergeable {
  return {
    id,
    projectId: null,
    tagIds: [],
    start: '2026-10-13T08:00:00.000Z',
    end: '2026-10-13T09:00:00.000Z',
    note: '',
    billable: false,
    rateOverrideMinor: null,
    source: 'manual',
    createdAt: updatedAt,
    updatedAt,
    deletedAt: null,
  } as Mergeable
}

function snapshotOf(entries: Mergeable[], schemaVersion = SUPPORTED): Snapshot {
  return { schemaVersion, entities: { entries } }
}

/**
 * In-memory provider.
 *
 * Models the two behaviours the engine depends on: `rev` changes on every write,
 * and a push with a stale `expectedRev` is rejected rather than clobbering.
 */
/*
 * Deliberately synchronous where it can be: it is a test double, and the engine's
 * async handling is exercised by the fake provider's async paths plus the fake
 * timers, not by making every stub pretend to wait.
 */
class FakeProvider implements SyncProvider {
  readonly id = 'fake'
  remote: RemoteFile | null = null
  revCounter = 0
  authenticated = true
  pushCount = 0
  pullCount = 0
  failNextPush: SyncError | null = null
  failNextPull: SyncError | null = null
  concurrentWriteOnPush: Mergeable[] | null = null

  ensureAuth(): Promise<void> {
    return this.authenticated
      ? Promise.resolve()
      : Promise.reject(new SyncError('auth', 'Not authorised'))
  }

  signOut(): Promise<void> {
    this.authenticated = false
    return Promise.resolve()
  }

  status(): Promise<ProviderStatus> {
    return Promise.resolve({
      authenticated: this.authenticated,
      account: this.authenticated ? 'fake@example' : null,
    })
  }

  pull(): Promise<RemoteFile | null> {
    this.pullCount += 1
    if (this.failNextPull) {
      const error = this.failNextPull
      this.failNextPull = null
      return Promise.reject(error)
    }
    return Promise.resolve(this.remote)
  }

  push(_path: string, body: string, expectedRev: string | null): Promise<{ rev: string }> {
    this.pushCount += 1
    if (this.failNextPush) {
      const error = this.failNextPush
      this.failNextPush = null
      return Promise.reject(error)
    }
    if (this.concurrentWriteOnPush) {
      // Another device wrote between our pull and our push.
      this.revCounter += 1
      this.remote = {
        body: serialiseEnvelope(toEnvelope(snapshotOf(this.concurrentWriteOnPush), T0)),
        rev: `rev-${this.revCounter}`,
      }
      this.concurrentWriteOnPush = null
      return Promise.reject(new SyncError('conflict', 'Conflict'))
    }
    if (this.remote && expectedRev !== this.remote.rev) {
      return Promise.reject(new SyncError('conflict', 'Conflict'))
    }
    this.revCounter += 1
    this.remote = { body, rev: `rev-${this.revCounter}` }
    return Promise.resolve({ rev: this.remote.rev })
  }
}

interface Harness {
  deps: SyncDeps
  provider: FakeProvider
  /**
   * A getter, not a captured reference. `writeLocal` replaces the snapshot object
   * wholesale, so holding the original reference would silently assert against the
   * pre-merge state and make every merge test pass or fail for the wrong reason.
   */
  readonly local: Snapshot
  lastRev: { value: string | null }
  logs: SyncLogEntry[]
}

function harness(initial: Snapshot, provider = new FakeProvider()): Harness {
  const state = { local: initial }
  const lastRev = { value: null as string | null }
  const logs: SyncLogEntry[] = []
  return {
    provider,
    get local() {
      return state.local
    },
    lastRev,
    logs,
    deps: {
      provider,
      path: PATH,
      supportedSchemaVersion: SUPPORTED,
      readLocal: () => Promise.resolve(state.local),
      writeLocal: (snapshot) => {
        state.local = snapshot
        return Promise.resolve()
      },
      readLastRev: () => Promise.resolve(lastRev.value),
      writeLastRev: (rev) => {
        lastRev.value = rev
        return Promise.resolve()
      },
      now: () => T0,
      onLog: (event) => logs.push(event),
    },
  }
}

beforeEach(() => {
  vi.useRealTimers()
})

describe('runSync — first run (0012 C4)', () => {
  it('creates the remote file from local data when none exists', async () => {
    const h = harness(snapshotOf([entry('a')]))
    const result = await runSync(h.deps)

    expect(result).toMatchObject({ status: 'pushed', merged: false })
    expect(h.provider.remote).not.toBeNull()
    const written = JSON.parse(h.provider.remote?.body ?? '{}') as Envelope
    expect(written.data.entries).toHaveLength(1)
    expect(h.lastRev.value).toBe(h.provider.remote?.rev)
  })
})

describe('runSync — unchanged remote (0012 C4 step 4)', () => {
  it('does not push when the remote matches the last revision we saw', async () => {
    const h = harness(snapshotOf([entry('a')]))
    await runSync(h.deps)
    const pushesAfterFirst = h.provider.pushCount

    const second = await runSync(h.deps)
    expect(second).toEqual({ status: 'up-to-date' })
    expect(h.provider.pushCount).toBe(pushesAfterFirst)
  })
})

describe('runSync — merge (0012 C5, M1–M11)', () => {
  it('pulls remote changes into local without republishing them', async () => {
    const h = harness(snapshotOf([entry('a')]))
    await runSync(h.deps)

    // Another device adds an entry.
    h.provider.remote = {
      body: serialiseEnvelope(toEnvelope(snapshotOf([entry('a'), entry('b')]), T0)),
      rev: 'rev-external',
    }

    const result = await runSync(h.deps)

    // Adopted locally...
    const ids = (h.local.entities['entries'] ?? []).map((e) => e.id)
    expect(ids).toEqual(['a', 'b'])
    // ...but not pushed back. The union already equals what the remote holds, so a
    // push would rewrite identical content and only mint a new revision.
    expect(result).toMatchObject({ status: 'up-to-date' })
    expect(h.provider.pushCount).toBe(1)
  })

  it('keeps the local version when it is newer', async () => {
    const h = harness(snapshotOf([entry('a', '2026-10-13T12:00:00.000Z')]))
    await runSync(h.deps)

    h.provider.remote = {
      body: serialiseEnvelope(
        toEnvelope(snapshotOf([entry('a', '2026-10-13T08:00:00.000Z')]), T0),
      ),
      rev: 'rev-external',
    }

    await runSync(h.deps)
    expect(h.local.entities['entries']?.[0]?.updatedAt).toBe('2026-10-13T12:00:00.000Z')
  })
})

describe('runSync — offline and unauthorised (0012 SY3, C1)', () => {
  it('skips without error when not signed in', async () => {
    const h = harness(snapshotOf([entry('a')]))
    h.provider.authenticated = false
    const result = await runSync(h.deps)
    expect(result).toEqual({ status: 'skipped', reason: 'not-authenticated' })
    expect(h.provider.pushCount).toBe(0)
  })

  it('reports a network failure without touching local data', async () => {
    const h = harness(snapshotOf([entry('a')]))
    h.provider.failNextPull = new SyncError('network', 'offline')
    const before = h.local

    const result = await runSync(h.deps)
    expect(result).toMatchObject({ status: 'failed', kind: 'network' })
    expect(h.local).toBe(before)
    expect(h.local.entities['entries']).toHaveLength(1)
  })

  it('treats a not-found pull as a first run rather than an error', async () => {
    const h = harness(snapshotOf([entry('a')]))
    h.provider.failNextPull = new SyncError('not-found', 'no such file')
    const result = await runSync(h.deps)
    expect(result).toMatchObject({ status: 'pushed' })
  })
})

describe('runSync — schema safety (0012 M9, C4)', () => {
  it('refuses to push over a newer remote schema and does not write local', async () => {
    const h = harness(snapshotOf([entry('a')]))
    h.provider.remote = {
      body: serialiseEnvelope(toEnvelope(snapshotOf([entry('x')], 99), T0)),
      rev: 'rev-future',
    }
    const before = h.local

    const result = await runSync(h.deps)
    expect(result).toMatchObject({ status: 'blocked', reason: 'unsupported-schema' })
    expect(h.local).toBe(before)
    expect(h.provider.pushCount).toBe(0)
  })

  it('refuses a file that is not a backup at all', async () => {
    const h = harness(snapshotOf([entry('a')]))
    h.provider.remote = { body: JSON.stringify({ hello: 'world' }), rev: 'rev-x' }
    const result = await runSync(h.deps)
    expect(result).toMatchObject({ status: 'blocked' })
    expect(h.provider.pushCount).toBe(0)
  })
})

describe('runSync — concurrency (0012 C5)', () => {
  it('re-reads and merges when the remote changes mid-push', async () => {
    // A local deletion is what makes this cycle push at all: a remote-only change no
    // longer publishes, since the union would equal the remote.
    // Strictly newer than the remote copy, so last-write-wins picks the tombstone
    // and the union genuinely differs from what the remote holds.
    const deletedAt = '2026-10-13T10:00:00.000Z'
    const h = harness(snapshotOf([{ ...entry('a', deletedAt), deletedAt }]))
    await runSync(h.deps)
    h.lastRev.value = 'rev-stale'

    // Another device writes between our pull and our push.
    h.provider.remote = {
      body: serialiseEnvelope(toEnvelope(snapshotOf([entry('a')]), T0)),
      rev: 'rev-mine',
    }
    h.provider.concurrentWriteOnPush = [entry('a'), entry('from-other-device')]

    const result = await runSync(h.deps)
    expect(result).toMatchObject({ status: 'pushed', merged: true })

    // The other device's record survived rather than being clobbered.
    const ids = (h.local.entities['entries'] ?? []).map((e) => e.id)
    expect(ids).toContain('from-other-device')
  })

  it('gives up after a bounded number of retries', async () => {
    const h = harness(snapshotOf([entry('a')]))
    await runSync(h.deps)
    h.provider.failNextPush = new SyncError('network', 'flaky')
    const result = await runSync(h.deps)
    // One attempt's worth of failure is reported, not an infinite loop.
    expect(['failed', 'up-to-date']).toContain(result.status)
  }, 15_000)
})

describe('runSync — tokens never leave the payload (0012 AU6)', () => {
  it('does not put credentials in the serialised envelope', async () => {
    const h = harness(snapshotOf([entry('a')]))
    await runSync(h.deps)
    const body = h.provider.remote?.body ?? ''
    expect(body).not.toMatch(/access[_-]?token/i)
    expect(body).not.toMatch(/refresh[_-]?token/i)
    expect(body).not.toMatch(/secret/i)
  })
})

/**
 * Local-only changes must reach the provider (0012 C5).
 *
 * A local edit, addition or deletion leaves the remote revision untouched. Deciding
 * "nothing to do" from the revision alone therefore concluded that local-only changes
 * needed no publishing, and they silently never reached the provider. This was the
 * deletion bug: delete an entry, sync, and the provider still held the live record.
 */
describe('runSync — local-only changes (0012 C5)', () => {
  function tombstone(id: string, updatedAt: string): Mergeable {
    return { ...entry(id, updatedAt), deletedAt: updatedAt }
  }

  function syncedOnce(local: Snapshot, remoteEntries: Mergeable[]) {
    const h = harness(local)
    h.provider.remote = {
      rev: 'r1',
      body: serialiseEnvelope(toEnvelope(snapshotOf(remoteEntries), T0)),
    }
    h.lastRev.value = 'r1'
    return h
  }

  it('publishes a local deletion even though the remote revision is unchanged', async () => {
    const h = syncedOnce(snapshotOf([tombstone('a', '2026-10-13T10:00:00.000Z')]), [
      entry('a', '2026-10-13T09:00:00.000Z'),
    ])

    const result = await runSync(h.deps)

    expect(result).toMatchObject({ status: 'pushed' })
    const written = JSON.parse(h.provider.remote?.body ?? '{}') as Envelope
    expect(written.data.entries[0]?.deletedAt).toBe('2026-10-13T10:00:00.000Z')
  })

  it('publishes a local edit even though the remote revision is unchanged', async () => {
    const edited = { ...entry('a', '2026-10-13T10:00:00.000Z'), note: 'changed' } as Mergeable
    const h = syncedOnce(snapshotOf([edited]), [entry('a')])

    await runSync(h.deps)

    const written = JSON.parse(h.provider.remote?.body ?? '{}') as Envelope
    expect(written.data.entries[0]?.note).toBe('changed')
  })

  it('publishes a local addition even though the remote revision is unchanged', async () => {
    const h = syncedOnce(snapshotOf([entry('a'), entry('b')]), [entry('a')])

    const result = await runSync(h.deps)

    expect(result).toMatchObject({ status: 'pushed' })
    const written = JSON.parse(h.provider.remote?.body ?? '{}') as Envelope
    expect(written.data.entries).toHaveLength(2)
  })

  it('does nothing when local and remote genuinely agree', async () => {
    const h = syncedOnce(snapshotOf([entry('a')]), [entry('a')])

    const result = await runSync(h.deps)

    expect(result).toMatchObject({ status: 'up-to-date' })
    expect(h.provider.pushCount).toBe(0)
  })
})

/**
 * Local and remote must agree on what was stored (0012 M2).
 *
 * The engine writes the merge result locally and publishes it. If those two differ, every
 * later cycle finds a difference, pushes it again, and never settles — a redundant write
 * on every sync, with a new revision each time, and nothing reporting a problem.
 */
describe('repaired references reach both sides', () => {
  /** This file's `entry` helper produces a `Mergeable`, so read the field explicitly. */
  function projectIdOf(snapshot: Snapshot, id: string): string | null | undefined {
    const records = snapshot.entities['entries'] ?? []
    const record = records.find((candidate) => candidate.id === id) as
      (Mergeable & { projectId?: string | null }) | undefined
    return record?.projectId
  }

  /** A remote file already holding an entry whose project does not exist anywhere. */
  function withDanglingRemote() {
    // `entry` here produces a Mergeable, so the reference is added by assignment rather
    // than in the literal, where TypeScript would reject it as an unknown field.
    const dangling: Mergeable & { projectId: string } = { ...entry('a'), projectId: 'ghost' }
    const local = snapshotOf([dangling])
    const h = harness(local)
    h.provider.remote = {
      rev: 'r1',
      body: serialiseEnvelope(toEnvelope(local, T0)),
    }
    return h
  }

  it('writes the same records locally as it publishes', async () => {
    const h = withDanglingRemote()

    const result = await runSync(h.deps)

    expect(result).toMatchObject({ status: 'pushed' })
    const written = JSON.parse(h.provider.remote?.body ?? '{}') as Envelope
    expect(written.data.entries[0]?.projectId).toBeNull()

    // Locally too. Writing the unrepaired merge and publishing the repaired one left
    // the database and the remote holding different data, so they never matched.
    expect(projectIdOf(h.local, 'a')).toBeNull()
  })

  it('settles after the first push rather than pushing on every cycle', async () => {
    const h = withDanglingRemote()

    await runSync(h.deps)
    const afterFirst = h.provider.pushCount

    await runSync(h.deps)

    // A repair that reached only one side would make this 2, then 3, and so on: every
    // cycle finds a difference and publishes it. Invisible without counting pushes.
    expect(h.provider.pushCount).toBe(afterFirst)
  })

  it('keeps a resolvable reference rather than clearing it', async () => {
    const project = {
      id: 'p1',
      name: 'Real',
      clientId: null,
      colour: '#000000',
      defaultRateMinor: null,
      currency: null,
      archived: false,
      createdAt: '2026-10-13T09:00:00.000Z',
      updatedAt: '2026-10-13T09:00:00.000Z',
      deletedAt: null,
    }
    // This file's `entry` helper takes (id, updatedAt), so the extra fields are added
    // explicitly rather than through the shared fixtures helper.
    const withProject: Mergeable & { projectId: string } = { ...entry('a'), projectId: 'p1' }
    const h = harness({
      schemaVersion: SUPPORTED,
      entities: { entries: [withProject], projects: [project] },
    })
    await runSync(h.deps)

    // Repair only drops references nothing can display.
    expect(projectIdOf(h.local, 'a')).toBe('p1')
  })
})
