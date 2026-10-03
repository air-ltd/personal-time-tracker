import Dexie from 'dexie'
import type { TimeEntry } from '../domain/entries/types'

/**
 * Database schema (0003 V1, 0007 S1–S4).
 *
 * IndexedDB rather than localStorage: localStorage is synchronous, string-only and
 * capped at roughly 5 MB, which entries with notes will eventually exceed, and a
 * quota error thrown mid-write loses the write (0007 S1). Dexie's versioned schema
 * is also the migration registry 0007 M1–M6 requires, rather than something to
 * hand-roll and only exercise during an upgrade.
 */

export const SCHEMA_VERSION = 1

export interface MetaRecord {
  key: string
  value: unknown
}

export class AppDb extends Dexie {
  entries!: Dexie.Table<TimeEntry, string>
  meta!: Dexie.Table<MetaRecord, string>

  constructor(name = 'personal-time-tracker') {
    super(name)
    this.version(SCHEMA_VERSION).stores({
      // Indexes follow the actual query patterns (0007 S4).
      //
      // Note the `end` index: IndexedDB cannot index `null`, so a running entry
      // is absent from it and the index cannot be used to find one. `findRunning`
      // scans instead, which is acceptable at the confirmed volume (0006 P1).
      entries: 'id, start, projectId, end, deletedAt',
      meta: 'key',
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
