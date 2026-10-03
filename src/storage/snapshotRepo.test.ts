import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDb, setDbForTests, SCHEMA_VERSION } from './db'
import { getRevision, resetRevisionForTests, subscribe } from './events'
import { readSnapshot, writeSnapshot } from './snapshotRepo'
import type { Snapshot } from '../domain/merge'
import type { TimeEntry } from '../domain/entries/types'

let db: AppDb
let counter = 0

beforeEach(() => {
  db = new AppDb(`snapshot-${(counter += 1)}`)
  setDbForTests(db)
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
