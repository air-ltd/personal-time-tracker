import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDb, setDbForTests, SCHEMA_VERSION } from './db'
import { getRevision, resetRevisionForTests, subscribe } from './events'
import { readSnapshot, writeSnapshot } from './snapshotRepo'
import type { Mergeable, Snapshot } from '../domain/merge'
import type { TimeEntry } from '../domain/entries/types'

let db: AppDb
let counter = 0

beforeEach(async () => {
  db = new AppDb(`snapshot-${(counter += 1)}`)
  setDbForTests(db)
  // Await the open so the schema upgrade chain has committed before the first
  // query. See useTimer.test.tsx: without this a query can arrive mid-upgrade and
  // Dexie reports an unhandled PrematureCommitError with no failing assertion.
  await db.open()
  resetRevisionForTests()
})

function entry(id: string): TimeEntry {
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
    createdAt: '2026-10-13T08:00:00.000Z',
    updatedAt: '2026-10-13T09:00:00.000Z',
    deletedAt: null,
  }
}

function project(id: string, name: string) {
  return {
    id,
    name,
    clientId: null,
    colour: '#000000',
    defaultRateMinor: null,
    currency: null,
    archived: false,
    createdAt: '2026-10-13T09:00:00.000Z',
    updatedAt: '2026-10-13T09:00:00.000Z',
    deletedAt: null,
  }
}

function snapshotOf(entries: TimeEntry[]): Snapshot {
  return { schemaVersion: SCHEMA_VERSION, entities: { entries } }
}

describe('readSnapshot', () => {
  it('includes tombstoned entries, or a deletion would not sync', async () => {
    const deleted = { ...entry('b'), deletedAt: '2026-10-13T10:00:00.000Z' }
    await db.entries.bulkPut([entry('a'), deleted])

    const snapshot = await readSnapshot()

    // Both records, so the merge can see the tombstone. Filtering here would make
    // deletions invisible to sync and resurrect them on the next pull.
    expect(snapshot.entities['entries']).toHaveLength(2)
    expect((snapshot.entities['entries'] ?? []).find((e) => e.id === 'b')?.deletedAt).toBe(
      '2026-10-13T10:00:00.000Z',
    )
  })

  it('excludes the secrets store so credentials never travel in a payload', async () => {
    const snapshot = await readSnapshot()
    expect(Object.keys(snapshot.entities)).not.toContain('secrets')
  })
})

describe('writeSnapshot', () => {
  it('notifies views, which subscribe to a revision rather than to IndexedDB', async () => {
    let notified = 0
    subscribe(() => {
      notified += 1
    })
    const before = getRevision()

    await writeSnapshot(snapshotOf([entry('a')]))

    // Without this the write lands correctly but the list keeps showing old contents
    // until some unrelated re-render happens.
    expect(notified).toBe(1)
    expect(getRevision()).toBeGreaterThan(before)
  })

  it('does not notify when there was nothing to write', async () => {
    let notified = 0
    subscribe(() => {
      notified += 1
    })

    await writeSnapshot({ schemaVersion: SCHEMA_VERSION, entities: {} })

    expect(notified).toBe(0)
  })

  it('round-trips a snapshot through the database', async () => {
    const original = snapshotOf([entry('a'), entry('b')])
    await writeSnapshot(original)

    expect((await readSnapshot()).entities['entries']).toHaveLength(2)
  })

  it('keeps tombstones, so a restore cannot resurrect a deleted entry', async () => {
    const deleted = { ...entry('a'), deletedAt: '2026-10-13T10:00:00.000Z' }
    await writeSnapshot(snapshotOf([deleted]))

    const [restored] = (await readSnapshot()).entities['entries'] ?? []
    expect(restored?.deletedAt).toBe('2026-10-13T10:00:00.000Z')
  })
})

/**
 * The bridge must cover every entity table the schema has.
 *
 * A table added to the schema and forgotten here would simply never sync: the merge is
 * table-agnostic, so nothing downstream complains, and the data is quietly absent from
 * every other device with no warning (0012 M2). Deriving the expectation from the live
 * schema means the next table cannot be added without this failing.
 */
describe('every entity table is bridged', () => {
  const INTERNAL = new Set(['meta', 'secrets'])

  it('reads and writes all of them', async () => {
    const entityTables = db.tables.map((t) => t.name).filter((name) => !INTERNAL.has(name))
    expect(entityTables.length).toBeGreaterThan(0)

    for (const name of entityTables) {
      await db
        .table(name)
        .put({ id: `${name}-1`, updatedAt: '2026-10-13T09:00:00.000Z', deletedAt: null })

      const snapshot = await readSnapshot()
      expect(Object.keys(snapshot.entities), `${name} was not read`).toContain(name)

      await db.table(name).clear()
      await writeSnapshot(snapshot)
      expect(await db.table(name).count(), `${name} was not written back`).toBe(1)
    }
  })

  it('excludes the internal stores, which are not entities', async () => {
    const snapshot = await readSnapshot()
    // meta holds sync bookkeeping and secrets holds the token. Neither is user data,
    // and syncing either would be a bug in its own right.
    expect(Object.keys(snapshot.entities)).not.toContain('meta')
    expect(Object.keys(snapshot.entities)).not.toContain('secrets')
  })
})

/**
 * Atomicity (0007 S6).
 *
 * A per-table transaction commits each table as it goes. A crash or quota error partway
 * through would leave a mixture of two snapshots, and the next sync would merge and
 * publish that mixture — losing whatever had not been written yet, with no error anywhere
 * because every individual write did succeed.
 */
describe('writeSnapshot is atomic', () => {
  it('writes every table in one go, not one transaction at a time', async () => {
    await writeSnapshot({
      schemaVersion: SCHEMA_VERSION,
      entities: {
        entries: [entry('e1')],
        projects: [project('p1', 'New')],
        tags: [
          {
            id: 't1',
            name: 'research',
            colour: '#000000',
            createdAt: '2026-10-13T09:00:00.000Z',
            updatedAt: '2026-10-13T09:00:00.000Z',
            deletedAt: null,
          } as unknown as Mergeable,
        ],
      },
    })

    // All three tables. A per-table loop would also satisfy this, so the rollback case
    // below is what actually pins the behaviour down.
    expect((await db.entries.toArray()).map((r) => r.id)).toEqual(['e1'])
    expect((await db.projects.toArray()).map((r) => r.id)).toEqual(['p1'])
    expect((await db.tags.toArray()).map((r) => r.id)).toEqual(['t1'])
  })

  it('rolls back every table when a later one fails', async () => {
    await db.entries.put(entry('original'))

    // Entries is written first and succeeds; projects then fails on an invalid primary
    // key. If each table had its own transaction, 'e-new' would survive.
    await expect(
      writeSnapshot({
        schemaVersion: SCHEMA_VERSION,
        entities: {
          entries: [entry('e-new')],
          projects: [{ ...project('p1', 'New'), id: { invalid: true } } as never],
        },
      }),
    ).rejects.toBeDefined()

    // The successful write was rolled back with the failed one.
    expect((await db.entries.toArray()).map((r) => r.id)).toEqual(['original'])
    expect(await db.projects.count()).toBe(0)
  })

  it('leaves records the snapshot omits alone rather than clearing them', async () => {
    await db.entries.put(entry('kept'))

    await writeSnapshot({
      schemaVersion: SCHEMA_VERSION,
      entities: { entries: [entry('added')] },
    })

    // An upsert, not a replace. Both callers pass a merge result, which is a union and
    // so contains everything; clearing first would make a truncated snapshot a way to
    // delete a user's history.
    expect((await db.entries.toArray()).map((r) => r.id).sort()).toEqual(['added', 'kept'])
  })

  it('writes nothing at all when the snapshot carries no known tables', async () => {
    await db.entries.put(entry('keep-me'))
    let notified = 0
    subscribe(() => {
      notified += 1
    })

    await writeSnapshot({ schemaVersion: SCHEMA_VERSION, entities: {} })

    // Opening a transaction with an empty scope would throw, so an empty snapshot has to
    // short-circuit — and must not report a change that did not happen.
    expect((await db.entries.toArray()).map((r) => r.id)).toEqual(['keep-me'])
    expect(notified).toBe(0)
  })
})
