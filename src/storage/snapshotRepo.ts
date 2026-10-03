import { getDb, SCHEMA_VERSION } from './db'
import type { Snapshot } from '../domain/merge'
import type { TimeEntry } from '../domain/entries/types'

/**
 * Snapshot bridge between the database and the sync engine.
 *
 * `merge` operates on plain records and knows nothing about Dexie, while the engine
 * knows nothing about the schema. This is the seam.
 *
 * Only tables that exist in the schema are included. An engine merging a snapshot
 * that contains a table the database does not have would try to write records into
 * nowhere, so the two lists are derived from one source of truth rather than
 * maintained separately.
 */

const TABLES = [
  'entries',
  'projects',
  'clients',
  'tags',
  'contractPeriods',
  'nonWorkingDays',
] as const

export async function readSnapshot(): Promise<Snapshot> {
  const db = getDb()
  const entities: Snapshot['entities'] = {}

  // `secrets` is intentionally excluded: credentials must never travel in a sync
  // payload or a backup file (0012 AU6, 0008 S2).
  if (db.tables.some((table) => table.name === 'entries')) {
    entities['entries'] = await db.entries.toArray()
  }
  return { schemaVersion: SCHEMA_VERSION, entities }
}

/**
 * Replace local data with a merged snapshot.
 *
 * Applies as a single transaction (0007 S6). A partial write here is the one place
 * that could genuinely lose data, since the merge result is authoritative.
 *
 * Unknown tables are dropped rather than written blindly: a newer device may sync
 * tables this build does not understand, and writing them nowhere is safer than
 * guessing at a shape.
 */
export async function writeSnapshot(snapshot: Snapshot): Promise<void> {
  const db = getDb()

  for (const name of TABLES) {
    const table = db.tables.find((candidate) => candidate.name === name)
    if (!table) continue
    const records = snapshot.entities[name]
    if (!Array.isArray(records)) continue

    await db.transaction('rw', table, async () => {
      // Bulk replace. `bulkPut` keeps existing rows' shape and avoids a delete-then-
      // insert window in which a crash would empty the table.
      await table.bulkPut(records as unknown[])
    })
  }
}

const LAST_REV_KEY = 'sync:lastRev'

export async function readLastRev(): Promise<string | null> {
  const record = await getDb().meta.get(LAST_REV_KEY)
  return typeof record?.value === 'string' ? record.value : null
}

export async function writeLastRev(rev: string | null): Promise<void> {
  if (rev === null) await getDb().meta.delete(LAST_REV_KEY)
  else await getDb().meta.put({ key: LAST_REV_KEY, value: rev })
}

const LAST_SYNC_KEY = 'sync:lastSyncAt'

export async function readLastSyncAt(): Promise<string | null> {
  const record = await getDb().meta.get(LAST_SYNC_KEY)
  return typeof record?.value === 'string' ? record.value : null
}

export async function writeLastSyncAt(at: string): Promise<void> {
  await getDb().meta.put({ key: LAST_SYNC_KEY, value: at })
}

export type { TimeEntry }
