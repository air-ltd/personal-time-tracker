import Dexie, { type Table } from 'dexie'
import type { TimeEntry } from '../domain/entries/types'
import type { Client, Project, Tag } from '../domain/taxonomy/types'

/**
 * Database schema (0003 V1, 0007 S1–S4).
 *
 * IndexedDB rather than localStorage: localStorage is synchronous, string-only and
 * capped at roughly 5 MB, which entries with notes will eventually exceed, and a
 * quota error thrown mid-write loses the write (0007 S1). Dexie's versioned schema
 * is also the migration registry 0007 M-1–M-6 requires, rather than something to
 * hand-roll and only exercise during an upgrade.
 *
 * Version history:
 *   1 — entries, meta
 *   2 — secrets, for sync credentials (Phase 2B)
 *   3 — projects, clients, tags, for the taxonomy (Phase 4)
 *   4 — settings, so preferences follow the user across devices (SPECS/todo.md item 46)
 *
 * Adding a store needs no backfill: absent rows correctly mean "no contract
 * configured" and "not connected", so there is no data to invent (0003 V2).
 */

export const SCHEMA_VERSION = 4

export interface MetaRecord {
  key: string
  value: unknown
}

/**
 * Sync credentials.
 *
 * A separate table from `meta` so that exporting `meta` can exclude it by
 * construction rather than by remembering to filter. A backup file that grants
 * access to the user's Dropbox must not be the kind of thing that gets emailed
 * around (0012 AU6, 0008 S2).
 */
export interface SecretRecord {
  key: string
  value: unknown
}

/**
 * A user preference, as one row per setting.
 *
 * Separate from `meta` because `meta` holds two things that must never travel together:
 * sync bookkeeping, which is this device's own (`lastRev`, `lastSyncAt`), and settings,
 * which are the user's and should reach their other devices (item 46). One table containing
 * both would mean every sync decided which half to send.
 *
 * Shaped as a `Mergeable` — `id`, `updatedAt`, `deletedAt` — so settings sync through the
 * existing union-by-id, last-write-wins merge with no rule of their own to get wrong. A
 * setting is a single value under a stable key, which is exactly what that merge already
 * handles correctly.
 *
 * The theme is deliberately absent: 0002 TH4 requires it in localStorage, readable before
 * first paint, which IndexedDB cannot serve. The Dropbox app key is absent for a different
 * reason — it is chosen by host, so syncing it would let a local build inherit the deployed
 * app's identity.
 */
export interface SettingRecord {
  /** The setting's name, and its primary key. Stable, so it is the merge identity. */
  id: string
  value: unknown
  updatedAt: string
  deletedAt: string | null
}

export class AppDb extends Dexie {
  entries!: Dexie.Table<TimeEntry, string>
  meta!: Dexie.Table<MetaRecord, string>
  secrets!: Dexie.Table<SecretRecord, string>
  projects!: Dexie.Table<Project, string>
  clients!: Dexie.Table<Client, string>
  tags!: Dexie.Table<Tag, string>
  settings!: Dexie.Table<SettingRecord, string>

  constructor(name = 'personal-time-tracker') {
    super(name)
    // Indexes follow the actual query patterns (0007 S4).
    //
    // Note the `end` index: IndexedDB cannot index `null`, so a running entry is
    // absent from it and the index cannot be used to find one. `findRunningEntry`
    // scans instead, which is acceptable at the confirmed volume (0006 P1).
    this.version(1).stores({
      entries: 'id, start, projectId, end, deletedAt',
      meta: 'key',
    })
    // v2: additive only. No data is rewritten, so this cannot lose anything, and
    // Dexie applies it inside the upgrade transaction (0007 M-2, M-3).
    this.version(2).stores({
      entries: 'id, start, projectId, end, deletedAt',
      meta: 'key',
      secrets: 'key',
    })
    // v3: additive only, like v2. No existing row is rewritten, so there is nothing to
    // lose; the tables simply start empty and their absence correctly means "nothing
    // configured yet" (0003 V2). `deletedAt` is indexed so tombstones can be found
    // without scanning, and `name` is not indexed because uniqueness is enforced in the
    // domain layer against a case-folded comparison that IndexedDB cannot express.
    this.version(3).stores({
      entries: 'id, start, projectId, end, deletedAt',
      meta: 'key',
      secrets: 'key',
      projects: 'id, clientId, archived, deletedAt',
      clients: 'id, archived, deletedAt',
      tags: 'id, deletedAt',
    })
    /*
     * v4: additive plus a migration, because it is the first version that moves a row
     * rather than only adding a table.
     *
     * `meta` already held the three settings, written by `settingsRepo` before this
     * version existed. They are copied into `settings` with an `updatedAt` so they merge
     * like everything else, and left in `meta` rather than deleted: removing them would
     * make the downgrade path lossy, and a row nobody reads costs nothing. The bookkeeping
     * keys stay in `meta` alone, which is what makes "send the settings, never the
     * bookkeeping" structural rather than a remembered filter (0012 AU6, 0008 S2).
     */
    this.version(4)
      .stores({
        entries: 'id, start, projectId, end, deletedAt',
        meta: 'key',
        secrets: 'key',
        projects: 'id, clientId, archived, deletedAt',
        clients: 'id, archived, deletedAt',
        tags: 'id, deletedAt',
        settings: 'id, updatedAt',
      })
      .upgrade(async (tx) => {
        // Typed rather than `tx.table(...)`, whose rows are `any`. The value column is
        // genuinely untyped — that is the point of it — but the *envelope* around it is not,
        // and an untyped upgrade is where a mistyped key silently becomes a data loss.
        const settings = tx.table('settings') as Table<SettingRecord, string>
        const meta = tx.table('meta') as Table<MetaRecord, string>
        const carried: readonly string[] = [
          'app-default-currency',
          'visible-currencies',
          'entry-period',
        ]
        const now = new Date().toISOString()
        for (const key of carried) {
          const row = await meta.get(key)
          if (row === undefined) continue
          await settings.put({ id: key, value: row.value, updatedAt: now, deletedAt: null })
        }
      })
  }
}

let singleton: AppDb | null = null

/** Lazily created so tests can inject their own database. */
export function getDb(): AppDb {
  singleton ??= new AppDb()
  return singleton
}

export function setDbForTests(db: AppDb | null): void {
  singleton = db
}

/**
 * The installed database, or null if none has been created or injected yet.
 *
 * `getDb()` would *create* one as a side effect, which is the wrong answer to "is there
 * one to clean up?". The test harness uses this to close the database the previous test
 * left open.
 */
export function peekDb(): AppDb | null {
  return singleton
}
