import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDb, setDbForTests } from './db'
import { resetRevisionForTests } from './events'
import {
  createManualEntry,
  discardTimer,
  findRunningEntry,
  listDeletedEntries,
  listEntries,
  makeEntry,
  restoreEntry,
  softDeleteEntry,
  startTimer,
  stopTimer,
  updateEntry,
} from './entriesRepo'

let db: AppDb
let counter = 0

beforeEach(async () => {
  db = new AppDb(`test-db-${(counter += 1)}`)
  setDbForTests(db)
  resetRevisionForTests()
  await db.open()
})

const at = (iso: string): Date => new Date(iso)

describe('timer lifecycle', () => {
  // 0004 T1
  it('starting twice does not create two running entries', async () => {
    const first = await startTimer(at('2026-10-13T09:00:00Z'))
    const second = await startTimer(at('2026-10-13T09:00:01Z'))
    expect(second.id).toBe(first.id)
    expect(await db.entries.count()).toBe(1)
  })

  it('stopping sets the end from the passed instant', async () => {
    const started = await startTimer(at('2026-10-13T09:00:00Z'))
    const stopped = await stopTimer(started.id, at('2026-10-13T10:30:00Z'))
    expect(stopped?.end).toBe('2026-10-13T10:30:00.000Z')
    expect(await findRunningEntry()).toBeUndefined()
  })

  // 0004 ED2: editing end on a running entry stops it.
  it('a stopped entry is idempotent under a second stop', async () => {
    const started = await startTimer(at('2026-10-13T09:00:00Z'))
    const first = await stopTimer(started.id, at('2026-10-13T10:00:00Z'))
    const second = await stopTimer(started.id, at('2026-10-13T11:00:00Z'))
    expect(second?.end).toBe(first?.end)
  })

  // 0004 T6: discard leaves no zero-value record in the active list.
  it('discarding removes it from active entries but retains the row', async () => {
    const started = await startTimer(at('2026-10-13T09:00:00Z'))
    await discardTimer(started.id, at('2026-10-13T09:05:00Z'))

    expect(await listEntries()).toHaveLength(0)
    expect(await findRunningEntry()).toBeUndefined()
    expect(await listDeletedEntries()).toHaveLength(1)
  })
})

describe('manual entries', () => {
  it('creates an active manual entry', async () => {
    await createManualEntry({
      start: at('2026-10-13T09:00:00Z'),
      end: at('2026-10-13T12:00:00Z'),
      note: 'wrote specs',
      now: at('2026-10-13T13:00:00Z'),
    })
    const [entry] = await listEntries()
    expect(entry?.source).toBe('manual')
    expect(entry?.note).toBe('wrote specs')
  })

  it('assigns distinct ids to entries created in the same millisecond', () => {
    const now = at('2026-10-13T09:00:00Z')
    const ids = new Set<string>()
    for (let i = 0; i < 200; i += 1) {
      const entry = makeEntry({
        start: now,
        end: at('2026-10-13T10:00:00Z'),
        source: 'manual',
        now,
      })
      ids.add(entry.id)
    }
    expect(ids.size).toBe(200)
  })
})

describe('editing', () => {
  it('updates fields and bumps updatedAt', async () => {
    const created = await createManualEntry({
      start: at('2026-10-13T09:00:00Z'),
      end: at('2026-10-13T10:00:00Z'),
      note: 'before',
      now: at('2026-10-13T10:00:00Z'),
    })
    const updated = await updateEntry(created.id, { note: 'after' }, at('2026-10-13T11:00:00Z'))
    expect(updated?.note).toBe('after')
    expect(updated?.updatedAt).toBe('2026-10-13T11:00:00.000Z')
    expect(updated?.createdAt).toBe(created.createdAt)
  })

  // 0004 ED1: a running entry can be edited, including its start.
  it('re-anchors a running entry when its start is edited', async () => {
    const started = await startTimer(at('2026-10-13T09:00:00Z'))
    const updated = await updateEntry(
      started.id,
      { start: '2026-10-13T08:00:00.000Z' },
      at('2026-10-13T09:30:00Z'),
    )
    expect(updated?.start).toBe('2026-10-13T08:00:00.000Z')
    expect(updated?.end).toBeNull()
  })

  it('refuses to update a soft-deleted entry', async () => {
    const created = await createManualEntry({
      start: at('2026-10-13T09:00:00Z'),
      end: at('2026-10-13T10:00:00Z'),
      note: 'x',
      now: at('2026-10-13T10:00:00Z'),
    })
    await softDeleteEntry(created.id, at('2026-10-13T10:30:00Z'))
    expect(
      await updateEntry(created.id, { note: 'y' }, at('2026-10-13T11:00:00Z')),
    ).toBeUndefined()
  })
})

describe('soft delete and undo', () => {
  // 0003 D1, D2, D3
  it('hides the entry from the active list but keeps the row', async () => {
    const created = await createManualEntry({
      start: at('2026-10-13T09:00:00Z'),
      end: at('2026-10-13T10:00:00Z'),
      note: 'oops',
      now: at('2026-10-13T10:00:00Z'),
    })
    await softDeleteEntry(created.id, at('2026-10-13T10:30:00Z'))

    expect(await listEntries()).toHaveLength(0)
    expect(await db.entries.count()).toBe(1)
    expect(await listDeletedEntries()).toHaveLength(1)
  })

  it('restores a deleted entry (0003 D4)', async () => {
    const created = await createManualEntry({
      start: at('2026-10-13T09:00:00Z'),
      end: at('2026-10-13T10:00:00Z'),
      note: 'oops',
      now: at('2026-10-13T10:00:00Z'),
    })
    await softDeleteEntry(created.id, at('2026-10-13T10:30:00Z'))
    const restored = await restoreEntry(created.id, at('2026-10-13T10:31:00Z'))

    expect(restored?.deletedAt).toBeNull()
    expect(await listEntries()).toHaveLength(1)
    expect(await listDeletedEntries()).toHaveLength(0)
  })

  it('deleting twice is idempotent and the second call is a no-op', async () => {
    const created = await createManualEntry({
      start: at('2026-10-13T09:00:00Z'),
      end: at('2026-10-13T10:00:00Z'),
      note: '',
      now: at('2026-10-13T10:00:00Z'),
    })
    const first = await softDeleteEntry(created.id, at('2026-10-13T10:30:00Z'))
    const second = await softDeleteEntry(created.id, at('2026-10-13T10:40:00Z'))
    expect(second).toBeUndefined()
    expect(second?.deletedAt ?? first?.deletedAt).toBe('2026-10-13T10:30:00.000Z')
  })
})

describe('running-entry invariant (0003 E4)', () => {
  it('never exposes more than one running entry', async () => {
    for (let i = 0; i < 5; i += 1) {
      await startTimer(at(`2026-10-13T09:00:0${i}Z`))
    }
    const running = await db.entries.filter((e) => e.end === null).toArray()
    expect(running).toHaveLength(1)
  })

  it('finds the running entry created before the current session', async () => {
    await startTimer(at('2026-10-13T06:00:00Z'))
    const found = await findRunningEntry()
    // 0004 T5: a timer survives a reload, so this is the normal case on load.
    expect(found?.start).toBe('2026-10-13T06:00:00.000Z')
  })
})

describe('change notification', () => {
  it('bumps the revision on writes so views re-read', async () => {
    const { getRevision } = await import('./events')
    const before = getRevision()
    await createManualEntry({
      start: at('2026-10-13T09:00:00Z'),
      end: at('2026-10-13T10:00:00Z'),
      note: '',
      now: at('2026-10-13T10:00:00Z'),
    })
    expect(getRevision()).toBeGreaterThan(before)
  })
})
