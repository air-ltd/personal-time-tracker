import Dexie from 'dexie'
import type { TimeEntry } from '../domain/entries/types'
import type { Client, Project, Tag } from '../domain/taxonomy/types'

/**
 * Database schema (0003 V1, 0007 S1–S4).
 *
 * IndexedDB rather than localStorage: localStorage is synchronous, string-only and
 * capped at roughly 5 MB, which entries with notes will eventually exceed, and a
 * quota error thrown mid-write loses the write (0007 S1). Dexie's versioned schema
 * is also the migration registry 0007 M1–M6 requires, rather than something to
 * hand-roll and only exercise during an upgrade.
 *
 * Version history:
 *   1 — entries, meta
 *   2 — secrets, for sync credentials (Phase 2B)
 *   3 — projects, clients, tags, for the taxonomy (Phase 4)
 *
 * Adding a store needs no backfill: absent rows correctly mean "no contract
 * configured" and "not connected", so there is no data to invent (0003 V2).
 */

export const SCHEMA_VERSION = 3

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

export class AppDb extends Dexie {
  entries!: Dexie.Table<TimeEntry, string>
  meta!: Dexie.Table<MetaRecord, string>
  secrets!: Dexie.Table<SecretRecord, string>
  projects!: Dexie.Table<Project, string>
  clients!: Dexie.Table<Client, string>
  tags!: Dexie.Table<Tag, string>

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
    // Dexie applies it inside the upgrade transaction (0007 M2, M3).
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
