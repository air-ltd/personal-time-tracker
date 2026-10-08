import { getDb, SCHEMA_VERSION } from './db'
import { bumpRevision } from './events'
import type { Table } from 'dexie'
import type { Mergeable, Snapshot } from '../domain/merge'

/**
 * Snapshot bridge between the database and the sync engine.
 *
 * `merge` operates on plain records and knows nothing about Dexie, while the engine
 * knows nothing about the schema. This is the seam.
 *
 * `TABLES` and the Dexie schema are two lists that must agree, and the merge is
 * table-agnostic — so a table added to one and forgotten in the other is the quietest
 * possible bug: the data simply never syncs, with nothing anywhere reporting it (0012
 * M2). `snapshotRepo.test.ts` derives its expectation from the live schema, which is
 * what makes the next table impossible to add silently.
 *
 * The list is therefore the only place table membership is declared. Adding a store to
 * `db.ts` without adding it here fails that test rather than passing.
 *
 * It lists only stores that exist. Listing one that does not yet is worse than leaving it
 * out: the read skips it silently, so the entry reads as coverage that is not there, and
 * nothing fails until the table appears and the omission becomes real. The envelope still
 * carries empty arrays for the tables later phases introduce (0008 J2.1), so a backup
 * written today remains a complete document rather than one missing sections.
 */

/*
 * The tables that travel in a sync payload or a backup.
 *
 * `settings` is here (SPECS/todo.md item 46) and `meta` is not, which is the whole point of
 * having split them: `meta` holds `lastRev` and `lastSyncAt`, which belong to the device
 * doing the syncing and would make two devices fight over them forever.
 */
const TABLES = ['entries', 'projects', 'clients', 'tags', 'settings'] as const

export async function readSnapshot(): Promise<Snapshot> {
  const db = getDb()
  const entities: Snapshot['entities'] = {}

  for (const name of TABLES) {
    const table = db.tables.find((candidate) => candidate.name === name)
    if (!table) continue
    // Dexie's `toArray` is typed `any[]`; the tables here are all taxonomy entities,
    // which is exactly the mergeable shape the snapshot declares.
    entities[name] = (await table.toArray()) as Mergeable[]
  }

  // `meta` and `secrets` are deliberately absent from TABLES: credentials must never
  // travel in a sync payload or a backup file (0012 AU6, 0008 S2), and what is left in
  // `meta` is sync bookkeeping rather than user data. Settings live in their own table so
  // this exclusion is a property of the schema rather than a filter someone has to
  // remember.
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

  // Work out what will actually be written before opening the transaction, so the
  // transaction can be given every table it needs rather than one at a time.
  const writes: { table: Table; records: unknown[] }[] = []
  for (const name of TABLES) {
    const table = db.tables.find((candidate) => candidate.name === name)
    if (!table) continue
    const records = snapshot.entities[name]
    if (!Array.isArray(records)) continue
    writes.push({ table, records })
  }

  if (writes.length === 0) return

  // One transaction across every table (0007 S6).
  //
  // A per-table transaction commits each table as it goes, so a crash or a quota error
  // partway through leaves the database holding a mixture of two snapshots. The next
  // sync would then merge that mixture and publish it, quietly losing whatever was in
  // the tables not yet written — with no error anywhere, because every individual write
  // did succeed.
  //
  // `bulkPut` is an upsert, not a replace: records absent from the snapshot are left
  // alone. That is safe here and deliberate. Both callers pass a merge result, which is
  // a union containing every record that exists on either side, so there is nothing to
  // remove; and clearing the table first would turn a truncated or hostile snapshot into
  // a way to delete a user's history. Tombstones are retained by the merge in any case
  // (0012 M6), so deletions arrive as records rather than as absences.
  await db.transaction(
    'rw',
    writes.map((write) => write.table),
    async () => {
      for (const write of writes) await write.table.bulkPut(write.records)
    },
  )

  // Views subscribe to a revision counter rather than to IndexedDB, so a write that does
  // not bump it is invisible until something else re-renders. A synced entry or a
  // restored backup could sit on disk, correctly stored and correctly merged, while the
  // list still showed the old contents.
  bumpRevision()
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
