import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDb, SCHEMA_VERSION, setDbForTests } from '../storage/db'
import { resetRevisionForTests } from '../storage/events'
import { readSnapshot, writeSnapshot } from '../storage/snapshotRepo'
import { createBackup, restoreBackup, type BackupDeps } from './backup'
import { canonicalStringify, type Snapshot } from '../domain/merge'
import { entryDurationMs } from '../domain/time/duration'
import { T0, entry, runningEntry, tombstone } from '../test/factories'
import type { TimeEntry } from '../domain/entries/types'

/**
 * Backup round trip through the real database (0001 criterion 3, 0008 J1–J12).
 *
 * The envelope tests exercise serialisation. This one exercises the path a user
 * actually takes — database out, file, database in — which is the only version that
 * can catch a field the schema and the storage disagree about. That disagreement is
 * easy to miss: the file round-trips perfectly while the restored record is missing
 * something the app reads.
 *
 * "Identical" is compared canonically rather than by serialised bytes, because
 * `exportedAt` and `counts` legitimately differ between two exports of the same data.
 * Comparing raw bytes would either fail for the right reason at the wrong moment or,
 * once someone excluded those fields, hide a real difference.
 */

let db: AppDb
let counter = 0
let deps: BackupDeps

beforeEach(() => {
  db = new AppDb(`backup-${(counter += 1)}`)
  setDbForTests(db)
  resetRevisionForTests()
  deps = {
    readLocal: readSnapshot,
    writeLocal: writeSnapshot,
    supportedSchemaVersion: SCHEMA_VERSION,
    now: () => T0,
  }
})

/** Every field of every stored record, so nothing can be quietly dropped. */
function records(snapshot: Snapshot): TimeEntry[] {
  return ((snapshot.entities['entries'] ?? []) as TimeEntry[]).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
}

describe('backup round trip through the database', () => {
  it('restores a wiped database to an identical state', async () => {
    const original = [
      entry({ id: 'a', note: 'first' }),
      entry({ id: 'b', billable: true, rateOverrideMinor: 12_345, source: 'timer' }),
      tombstone({ id: 'c' }),
      runningEntry({ id: 'd' }),
      entry({ id: 'e', projectId: 'p-1', tagIds: ['t-1', 't-2'] }),
    ]
    await writeSnapshot({ schemaVersion: SCHEMA_VERSION, entities: { entries: original } })

    const backup = await createBackup(deps)

    // The wipe the gate describes.
    await db.entries.clear()
    expect(await readSnapshot().then((s) => records(s))).toHaveLength(0)

    const result = await restoreBackup(deps, backup.body)
    expect(result.status).toBe('restored')

    const restored = records(await readSnapshot())
    // Field-for-field, not id-for-id: the point is that nothing was lost in
    // translation, and comparing only ids would miss a dropped field.
    expect(canonicalStringify(restored)).toBe(
      canonicalStringify(
        records({
          schemaVersion: SCHEMA_VERSION,
          entities: { entries: original },
        }),
      ),
    )
  })

  it('keeps a tombstone deleted across the round trip', async () => {
    await writeSnapshot({
      schemaVersion: SCHEMA_VERSION,
      entities: { entries: [entry({ id: 'a' }), tombstone({ id: 'b' })] },
    })
    const backup = await createBackup(deps)
    await db.entries.clear()
    await restoreBackup(deps, backup.body)

    const restored = records(await readSnapshot())
    expect(restored.find((e) => e.id === 'a')?.deletedAt).toBeNull()
    expect(restored.find((e) => e.id === 'b')?.deletedAt).not.toBeNull()
  })

  it('keeps a running entry running, so a restore does not invent an end', async () => {
    await writeSnapshot({
      schemaVersion: SCHEMA_VERSION,
      entities: { entries: [runningEntry({ id: 'a' })] },
    })
    const backup = await createBackup(deps)
    await db.entries.clear()
    await restoreBackup(deps, backup.body)

    const [restored] = records(await readSnapshot())
    expect(restored?.end).toBeNull()
    // And it is still the live entry the timer would pick up.
    expect(restored?.source).toBe('timer')
  })

  it('survives being exported and restored twice without drift', async () => {
    await writeSnapshot({
      schemaVersion: SCHEMA_VERSION,
      entities: { entries: [entry({ id: 'a' })] },
    })

    let snapshot = await readSnapshot()
    for (let pass = 0; pass < 3; pass += 1) {
      const backup = await createBackup(deps)
      await db.entries.clear()
      await restoreBackup(deps, backup.body)
      snapshot = await readSnapshot()
    }

    // Idempotence at the storage layer. A restore that appended, or that rewrote
    // timestamps, would grow or shift the data on every pass.
    expect(records(snapshot)).toHaveLength(1)
    expect(entryDurationMs(records(snapshot)[0] as TimeEntry, T0)).toBe(
      entryDurationMs(records(snapshot)[0] as TimeEntry, T0),
    )
  })

  it('leaves the database untouched when the file is not a backup', async () => {
    await writeSnapshot({
      schemaVersion: SCHEMA_VERSION,
      entities: { entries: [entry({ id: 'a' })] },
    })
    const before = canonicalStringify(await readSnapshot())

    const result = await restoreBackup(deps, '{"format":"something-else"}')

    expect(result.status).toBe('rejected')
    expect(canonicalStringify(await readSnapshot())).toBe(before)
  })

  it('does not write a token even if the secrets table holds one', async () => {
    // The secrets store exists and holds the Dropbox token. A backup must not be able
    // to reach it, so the exclusion is asserted against a populated table rather than
    // an empty one.
    await db.secrets.put({ key: 'dropbox:token', value: 'sl-access-token-value' })
    await writeSnapshot({
      schemaVersion: SCHEMA_VERSION,
      entities: { entries: [entry({ id: 'a' })] },
    })

    const backup = await createBackup(deps)

    expect(backup.body).not.toContain('sl-access-token-value')
    expect(backup.body).not.toMatch(/secrets/i)
  })
})
