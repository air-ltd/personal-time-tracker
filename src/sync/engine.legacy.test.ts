import { describe, expect, it } from 'vitest'
import { runSync, type SyncDeps, type SyncLogEntry } from './engine'
import { SyncError, type ProviderStatus, type RemoteFile, type SyncProvider } from './provider'
import type { Mergeable, Snapshot } from '../domain/merge'
import { FORMAT, FORMAT_VERSION } from '../export/envelope'

/**
 * A device meeting the file a previous release left in Dropbox (SPECS/todo.md item 68).
 *
 * This is the case the other two migration suites cannot reach on their own. They prove the
 * v3 → v4 database upgrade keeps the preferences, and that a file without a `settings` key
 * does not reset them. Neither proves that the *sync engine* will accept a schema-3 file at
 * all, or that merging one leaves the taxonomy and the tombstones intact — and that is the
 * path a real second device takes the first time it connects to an account that has been
 * syncing since 0.1.0.
 *
 * 0.1.0 shipped at `SCHEMA_VERSION = 3` with `TABLES = ['entries', 'projects', 'clients',
 * 'tags']`, so the file in Dropbox today has no `settings` key and may carry tombstones for
 * projects this build can neither create nor clear (item 41 removed delete).
 */

const PATH = '/data.json'
const SUPPORTED = 4
const T0 = new Date('2026-10-13T09:00:00.000Z')

/** A minimal provider: models `rev` changing on write, which is all the engine needs. */
class FakeProvider implements SyncProvider {
  readonly id = 'fake'
  remote: RemoteFile | null = null
  counter = 0
  authenticated = true

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
    return Promise.resolve({ authenticated: this.authenticated })
  }
  pull(): Promise<RemoteFile | null> {
    return Promise.resolve(this.remote)
  }
  /*
   * The path is the first parameter, as `SyncProvider.push` declares. Writing this as
   * `(body, expectedRev)` compiled happily — TypeScript allows a narrower signature — and
   * then compared the whole JSON body against the remote revision, so every push "conflicted".
   * A test double that gets an interface wrong in a way the type system permits is worse
   * than no double, because it fails as if the code under test were broken.
   */
  push(_path: string, body: string, expectedRev: string | null): Promise<{ rev: string }> {
    if (this.remote && expectedRev !== this.remote.rev) {
      return Promise.reject(new SyncError('conflict', 'Conflict'))
    }
    this.counter += 1
    this.remote = { body, rev: `rev-${this.counter}` }
    return Promise.resolve({ rev: this.remote.rev })
  }
}

const REMOTE_ENTRY: Mergeable = {
  id: 'entry-old',
  projectId: 'project-old',
  tagIds: ['tag-old'],
  start: '2026-10-01T09:00:00.000Z',
  end: '2026-10-01T11:00:00.000Z',
  note: 'recorded on 0.1.0',
  billable: true,
  rateOverrideMinor: null,
  source: 'timer',
  createdAt: '2026-10-01T11:00:00.000Z',
  updatedAt: '2026-10-01T11:00:00.000Z',
  deletedAt: null,
} as Mergeable

const REMOTE_CLIENT: Mergeable = {
  id: 'client-old',
  name: 'Acme Ltd',
  colour: '#abcdef',
  currency: 'GBP',
  defaultRateMinor: 9000,
  archived: false,
  deletedAt: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
} as Mergeable

const REMOTE_PROJECT: Mergeable = {
  id: 'project-old',
  clientId: 'client-old',
  name: 'Website',
  colour: '#123456',
  archived: false,
  deletedAt: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
} as Mergeable

/** A project deleted while running 0.1.0, which had delete enabled. */
const REMOTE_TOMBSTONE: Mergeable = {
  id: 'project-gone',
  clientId: null,
  name: 'Old Work',
  colour: '#654321',
  archived: false,
  deletedAt: '2026-10-02T09:00:00.000Z',
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
} as Mergeable

/** Exactly the JSON 0.1.0 wrote: schema 3, and no `settings` key anywhere. */
function fileFrom010(): string {
  return JSON.stringify({
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    schemaVersion: 3,
    exportedAt: '2026-10-05T09:00:00.000Z',
    counts: { entries: 1, projects: 2, clients: 1, tags: 1 },
    data: {
      entries: [REMOTE_ENTRY],
      projects: [REMOTE_PROJECT, REMOTE_TOMBSTONE],
      clients: [REMOTE_CLIENT],
      tags: [
        {
          id: 'tag-old',
          name: 'research',
          colour: '#00aa88',
          deletedAt: null,
          createdAt: '2026-10-01T09:00:00.000Z',
          updatedAt: '2026-10-01T09:00:00.000Z',
        },
      ],
    },
  })
}

function harness(provider: FakeProvider, local: Snapshot) {
  const state = { local }
  const logs: SyncLogEntry[] = []
  const lastRev = { value: null as string | null }
  const deps: SyncDeps = {
    provider,
    path: PATH,
    supportedSchemaVersion: SUPPORTED,
    readLocal: () => Promise.resolve(state.local),
    writeLocal: (snapshot) => {
      state.local = snapshot
      return Promise.resolve()
    },
    writeLastRev: (rev) => {
      lastRev.value = rev
      return Promise.resolve()
    },
    now: () => T0,
    onLog: (event) => logs.push(event),
  }
  return {
    deps,
    logs,
    lastRev,
    get local() {
      return state.local
    },
  }
}

/** A settings row: mergeable, plus the `value` column `Mergeable` does not declare. */
type SettingRow = Mergeable & { value: unknown }

/** This device's own preferences, which the old file says nothing about. */
function localSettings(): SettingRow[] {
  return [
    {
      id: 'app-default-currency',
      value: 'JPY',
      updatedAt: '2026-10-13T09:00:00.000Z',
      deletedAt: null,
    },
    {
      id: 'visible-currencies',
      value: ['GBP', 'JPY'],
      updatedAt: '2026-10-13T09:00:00.000Z',
      deletedAt: null,
    },
  ]
}

describe('syncing against a file left by 0.1.0', () => {
  it('accepts the older schema rather than failing the cycle', async () => {
    const provider = new FakeProvider()
    provider.remote = { body: fileFrom010(), rev: 'rev-1' }
    const h = harness(provider, { schemaVersion: SUPPORTED, entities: { entries: [] } })

    const result = await runSync(h.deps)

    // The whole point: an account that has been syncing since before the schema change must
    // not present the user with a sync that quietly stopped working.
    expect(result).toMatchObject({ status: 'pushed' })
  })

  it('brings across every record the old file holds', async () => {
    const provider = new FakeProvider()
    provider.remote = { body: fileFrom010(), rev: 'rev-1' }
    const h = harness(provider, { schemaVersion: SUPPORTED, entities: { entries: [] } })

    await runSync(h.deps)

    expect(h.local.entities['entries']).toHaveLength(1)
    expect(h.local.entities['projects']).toHaveLength(2)
    expect(h.local.entities['clients']).toHaveLength(1)
    expect(h.local.entities['tags']).toHaveLength(1)
    // Read through the entry's own shape rather than indexing a bare `Mergeable`, so the
    // assertion names the field it is about.
    const [first] = h.local.entities['entries'] as (Mergeable & { note?: string })[]
    expect(first?.note).toBe('recorded on 0.1.0')
  })

  it('keeps a project deleted on 0.1.0 deleted', async () => {
    const provider = new FakeProvider()
    provider.remote = { body: fileFrom010(), rev: 'rev-1' }
    const h = harness(provider, { schemaVersion: SUPPORTED, entities: { entries: [] } })

    await runSync(h.deps)

    /*
     * This build cannot delete a project, so it can neither create nor clear this
     * tombstone. If it were lost the project would return from the grave, and the next push
     * would republish it — resurrecting records the user removed three versions ago.
     */
    const tombstone = (h.local.entities['projects'] ?? []).find(
      (p) => p['id'] === 'project-gone',
    )
    expect(tombstone?.['deletedAt']).toBe('2026-10-02T09:00:00.000Z')
  })

  it('leaves this device’s settings alone, because the file mentions none', async () => {
    const provider = new FakeProvider()
    provider.remote = { body: fileFrom010(), rev: 'rev-1' }
    const h = harness(provider, {
      schemaVersion: SUPPORTED,
      entities: { entries: [], settings: localSettings() },
    })

    await runSync(h.deps)

    /*
     * A file with no `settings` key is not a statement that the user has no settings. Read
     * that way it would overwrite a second device's chosen currency with nothing, and the
     * device would quietly start billing in the fallback.
     */
    const ids = (h.local.entities['settings'] ?? []).map((row) => row.id).sort()
    expect(ids).toEqual(['app-default-currency', 'visible-currencies'])
  })

  it('publishes a file the old build could still read', async () => {
    const provider = new FakeProvider()
    provider.remote = { body: fileFrom010(), rev: 'rev-1' }
    const h = harness(provider, { schemaVersion: SUPPORTED, entities: { entries: [] } })

    await runSync(h.deps)

    // The push is the other half of the migration: a device still on 0.1.0 will read this
    // file next, so it must not gain a table it cannot parse.
    // Typed rather than indexed blind: `JSON.parse` is `any`, and an untyped read here would
    // pass on a file that was missing the very fields being asserted.
    const written = JSON.parse(provider.remote?.body ?? '{}') as {
      schemaVersion?: number
      data?: { entries?: unknown[]; settings?: unknown }
    }
    expect(written.schemaVersion).toBeGreaterThanOrEqual(3)
    expect(written.data?.entries).toHaveLength(1)
  })

  it('merges both ways: the old file’s records and this device’s own', async () => {
    const provider = new FakeProvider()
    provider.remote = { body: fileFrom010(), rev: 'rev-1' }
    const here: Mergeable = {
      id: 'entry-new',
      projectId: null,
      tagIds: [],
      start: '2026-10-13T08:00:00.000Z',
      end: '2026-10-13T09:00:00.000Z',
      note: 'recorded on this build',
      billable: false,
      rateOverrideMinor: null,
      source: 'manual',
      createdAt: '2026-10-13T09:00:00.000Z',
      updatedAt: '2026-10-13T09:00:00.000Z',
      deletedAt: null,
    } as Mergeable
    const h = harness(provider, {
      schemaVersion: SUPPORTED,
      entities: { entries: [here], settings: localSettings() },
    })

    await runSync(h.deps)

    /*
     * Neither device's work may be lost, and the schema version must not go backwards
     * (0012 M8) — an old device must not be able to drag the account's file back to 3.
     */
    const ids = (h.local.entities['entries'] ?? []).map((e) => e['id']).sort()
    expect(ids).toEqual(['entry-new', 'entry-old'])
    expect(h.local.schemaVersion).toBe(SUPPORTED)
  })
})
