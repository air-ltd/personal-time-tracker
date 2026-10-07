import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDb, setDbForTests, type MetaRecord } from './db'
import { readDefaultCurrency, readEntryPeriod, readVisibleCurrencies } from './settingsRepo'

/**
 * The v3 → v4 upgrade, which every existing device runs exactly once (item 46, SPECS/todo.md
 * item 68).
 *
 * **Why this file exists at all.** `installTestDb` opens a fresh database at whatever the
 * current version is, so `.upgrade()` never fires anywhere else in the suite. That left the
 * one callback in this codebase which *moves a row* completely untested — and it is the path
 * every 0.1.0 user takes on first load, since 0.1.0 shipped at `SCHEMA_VERSION = 3`.
 *
 * The failure it guards is silent and total: the three preferences live in `meta` at v3 and
 * in `settings` at v4, and nothing anywhere reads `meta` any more. An upgrade that drops or
 * misspells a key leaves the app working perfectly with the user's defaults quietly reset,
 * and there is no error to notice.
 *
 * **How the old data is written.** Through a throwaway `Dexie` subclass declaring the v3
 * stores verbatim, rather than through the current repositories. Writing v3 rows with v4
 * code would only prove that v4 code can write what v4 code expects; the point is the shape
 * a real 0.1.0 device left behind, tombstones and all.
 */
class V3Db extends Dexie {
  meta!: Dexie.Table<MetaRecord, string>
  entries!: Dexie.Table<Record<string, unknown>, string>
  projects!: Dexie.Table<Record<string, unknown>, string>
  clients!: Dexie.Table<Record<string, unknown>, string>

  constructor(name: string) {
    super(name)
    // Copied from `db.ts`'s v3 declaration. If that ever changes, this is the place that
    // should fail loudly rather than quietly testing the wrong shape.
    this.version(3).stores({
      entries: 'id, start, projectId, end, deletedAt',
      meta: 'key',
      secrets: 'key',
      projects: 'id, clientId, archived, deletedAt',
      clients: 'id, archived, deletedAt',
      tags: 'id, deletedAt',
    })
  }
}

const NAME = `migration-test-${Math.random().toString(36).slice(2)}`

const META_ROWS: readonly MetaRecord[] = [
  { key: 'app-default-currency', value: 'JPY' },
  { key: 'visible-currencies', value: ['GBP', 'JPY'] },
  { key: 'entry-period', value: 'week' },
  // The device's own sync bookkeeping. It belongs in `meta` and must **not** be carried
  // across: shipping a revision number to another device is how two devices fight.
  { key: 'lastRev', value: 7 },
  { key: 'lastSyncAt', value: '2026-10-05T09:00:00.000Z' },
]

const ENTRY = {
  id: 'entry-1',
  projectId: null,
  tagIds: [],
  start: '2026-10-01T09:00:00.000Z',
  end: '2026-10-01T10:30:00.000Z',
  note: 'pre-upgrade work',
  billable: true,
  rateOverrideMinor: null,
  source: 'timer',
  createdAt: '2026-10-01T10:30:00.000Z',
  updatedAt: '2026-10-01T10:30:00.000Z',
  deletedAt: null,
}

/** A project 0.1.0 deleted. That build had delete enabled (item 41 removed it). */
const TOMBSTONE_PROJECT = {
  id: 'project-gone',
  clientId: null,
  name: 'Old Work',
  colour: '#123456',
  archived: false,
  deletedAt: '2026-10-02T09:00:00.000Z',
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
}

/** Seeds a database in the shape 0.1.0 left behind, and closes it. */
async function seedV3(): Promise<void> {
  const old = new V3Db(NAME)
  await old.open()
  await old.meta.bulkPut([...META_ROWS])
  await old.entries.put({ ...ENTRY })
  await old.projects.put({ ...TOMBSTONE_PROJECT })
  await old.clients.put({
    id: 'client-1',
    name: 'Acme Ltd',
    colour: '#abcdef',
    currency: 'JPY',
    defaultRateMinor: 9000,
    archived: false,
    deletedAt: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
  })
  old.close()
}

/** Opens the seeded database with the *current* schema, running the upgrade chain. */
async function upgradeToCurrent(): Promise<AppDb> {
  const db = new AppDb(NAME)
  setDbForTests(db)
  await db.open()
  return db
}

let open: AppDb | null = null

afterEach(async () => {
  // `Dexie.delete` returns a thenable rather than a `Promise`, so awaiting it trips
  // `await-thenable` — hence the explicit `Promise.resolve`.
  await Promise.resolve(open?.close())
  open = null
  setDbForTests(null)
  await Promise.resolve(Dexie.delete(NAME))
})

describe('the v3 to v4 upgrade', () => {
  it('carries the three preferences out of meta, so they survive', async () => {
    await seedV3()
    open = await upgradeToCurrent()

    /*
     * Read through the repositories rather than off the table. The question is not "did the
     * rows land in `settings`" but "does the app still see the user's preferences", and
     * those are the same only while the readers and the writer agree.
     */
    expect(await readDefaultCurrency()).toBe('JPY')
    expect(await readVisibleCurrencies()).toEqual(['GBP', 'JPY'])
    expect(await readEntryPeriod()).toBe('week')
  })

  it('leaves the rows in meta as well, so downgrading does not lose them', async () => {
    await seedV3()
    open = await upgradeToCurrent()

    // Copied rather than moved, deliberately: an older build reads `meta` and nothing else,
    // so a move would be lossy on the way back.
    for (const row of META_ROWS) {
      expect(await open.meta.get(row.key)).toEqual(row)
    }
  })

  it('does not carry the device bookkeeping across as settings', async () => {
    await seedV3()
    open = await upgradeToCurrent()

    /*
     * `lastRev` and `lastSyncAt` describe *this* device. Carried into `settings` they would
     * sync, and two devices would overwrite each other's idea of what has been published
     * forever. They must stay in `meta` alone — which is the whole reason the tables were
     * split in the first place.
     */
    const ids = (await open.settings.toArray()).map((row) => row.id).sort()
    expect(ids).toEqual(['app-default-currency', 'entry-period', 'visible-currencies'])
    expect(ids).not.toContain('lastRev')
    expect(ids).not.toContain('lastSyncAt')
  })

  it('keeps the entries and the taxonomy, tombstones included', async () => {
    await seedV3()
    open = await upgradeToCurrent()

    expect(await open.entries.count()).toBe(1)
    expect((await open.entries.get('entry-1'))?.note).toBe('pre-upgrade work')

    expect(await open.clients.count()).toBe(1)
    expect((await open.clients.get('client-1'))?.name).toBe('Acme Ltd')

    /*
     * The tombstone survives. 0.1.0 could delete a project, so a real database can hold one
     * — and this build no longer offers delete, so it can neither create nor clear one. If
     * the upgrade dropped it, a deleted project would come back from the grave on the next
     * sync, republishing records the user believed they had removed.
     */
    expect((await open.projects.get('project-gone'))?.deletedAt).toBe(
      '2026-10-02T09:00:00.000Z',
    )
  })

  it('is safe to run twice', async () => {
    // Closing and reopening an already-upgraded database re-runs nothing, and a user who
    // reloads mid-upgrade must not find their preferences duplicated or overwritten.
    await seedV3()
    const first = await upgradeToCurrent()
    first.close()

    open = new AppDb(NAME)
    setDbForTests(open)
    await open.open()

    expect(await readDefaultCurrency()).toBe('JPY')
    expect(await open.settings.count()).toBe(3)
  })

  it('copes with a v3 database that never had the preferences set', async () => {
    // The other half: absence is not an error. A user who never chose a default currency has
    // no `meta` row, and the upgrade must leave them with none rather than inventing a value
    // or failing the open outright.
    const old = new V3Db(`${NAME}-empty`)
    await old.open()
    await old.meta.put({ key: 'lastRev', value: 1 })
    old.close()

    const db = new AppDb(`${NAME}-empty`)
    setDbForTests(db)
    await db.open()

    expect(await db.settings.count()).toBe(0)
    expect(await readDefaultCurrency()).toBeNull()
    expect(await readEntryPeriod()).toBe('all')
    db.close()
  })
})
