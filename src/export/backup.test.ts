import { beforeEach, describe, expect, it } from 'vitest'
import { createBackup, restoreBackup, backupFilename, type BackupDeps } from './backup'
import { parseEnvelope, serialiseEnvelope, toEnvelope } from './envelope'
import type { Snapshot } from '../domain/merge'
import type { TimeEntry } from '../domain/entries/types'

const SCHEMA = 1
const T0 = new Date('2026-10-13T09:00:00.000Z')

function entry(id: string, overrides: Partial<TimeEntry> = {}): TimeEntry {
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
    ...overrides,
  }
}

function snapshotOf(entries: TimeEntry[]): Snapshot {
  return { schemaVersion: SCHEMA, entities: { entries } }
}

/** One entry as stored, so assertions can name fields like `note` directly. */
function stored(snapshot: Snapshot): TimeEntry[] {
  return (snapshot.entities['entries'] ?? []) as TimeEntry[]
}

function harness(initial: Snapshot) {
  const state = { local: initial }
  const writes: Snapshot[] = []
  const deps: BackupDeps = {
    readLocal: () => Promise.resolve(state.local),
    writeLocal: (snapshot) => {
      writes.push(snapshot)
      state.local = snapshot
      return Promise.resolve()
    },
    supportedSchemaVersion: SCHEMA,
    now: () => T0,
  }
  return {
    deps,
    get local() {
      return state.local
    },
    writes,
  }
}

let h: ReturnType<typeof harness>

beforeEach(() => {
  h = harness(snapshotOf([entry('a'), entry('b')]))
})

describe('createBackup', () => {
  it('produces a file that parses back to the same records', async () => {
    const backup = await createBackup(h.deps)

    const parsed = parseEnvelope(JSON.parse(backup.body), SCHEMA)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.snapshot.entities['entries']).toHaveLength(2)
  })

  it('never writes a credential (0008 J10, 0012 AU6)', async () => {
    const backup = await createBackup(h.deps)

    // A backup travels by email and gets opened on other machines. If a Dropbox token
    // could ride along, handing over the file would hand over the account.
    expect(backup.body).not.toMatch(/accessToken/i)
    expect(backup.body).not.toMatch(/"secrets"/)
    expect(backup.body).not.toMatch(/refreshToken/i)
  })

  it('reports what it contains, so the user can check before relying on it', async () => {
    const backup = await createBackup(h.deps)
    expect(backup.counts['entries']).toBe(2)
  })

  it('includes tombstones, or a restore would resurrect deleted entries', async () => {
    const deleted = entry('c', { deletedAt: T0.toISOString() })
    h = harness(snapshotOf([deleted]))

    const backup = await createBackup(h.deps)

    const parsed = parseEnvelope(JSON.parse(backup.body), SCHEMA)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect((parsed.snapshot.entities['entries'] ?? [])[0]?.deletedAt).toBe(T0.toISOString())
  })
})

describe('backupFilename', () => {
  it('uses the local date, not UTC', () => {
    // 23:30 in London on the 13th is the 14th in UTC. The file should say the 13th,
    // because that is the day the user recognises.
    const lateEvening = new Date('2026-10-13T23:30:00.000Z')
    expect(backupFilename(lateEvening)).toMatch(/-\d{4}-\d{2}-\d{2}\.json$/)
    expect(backupFilename(lateEvening).startsWith('time-tracker-backup-')).toBe(true)
  })

  it('is stable for a given moment', () => {
    expect(backupFilename(T0)).toBe(backupFilename(T0))
  })
})

describe('restoreBackup', () => {
  function backupOf(snapshot: Snapshot, exportedAt = T0): string {
    return serialiseEnvelope(toEnvelope(snapshot, exportedAt))
  }

  it('restores an emptied database to exactly the exported state', async () => {
    const original = snapshotOf([
      entry('a'),
      entry('b'),
      entry('c', {
        deletedAt: T0.toISOString(),
      }),
    ])
    const file = backupOf(original)

    // The wipe the gate describes: everything local is gone.
    h = harness(snapshotOf([]))

    const result = await restoreBackup(h.deps, file)

    expect(result.status).toBe('restored')
    expect(h.local.entities['entries']).toHaveLength(3)
    expect(h.local.entities['entries']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'a' }),
        expect.objectContaining({ id: 'b' }),
        expect.objectContaining({ id: 'c' }),
      ]),
    )
  })

  it('keeps a deleted entry deleted across a restore', async () => {
    const file = backupOf(snapshotOf([entry('a', { deletedAt: T0.toISOString() })]))

    h = harness(snapshotOf([]))
    await restoreBackup(h.deps, file)

    expect(stored(h.local)[0]?.deletedAt).toBe(T0.toISOString())
  })

  it('never deletes local records, so a stale file cannot empty the database', async () => {
    const file = backupOf(snapshotOf([entry('from-backup')]))
    h = harness(snapshotOf([entry('local-only')]))

    await restoreBackup(h.deps, file)

    // Merge rather than replace: restoring must be incapable of data loss.
    const ids = (h.local.entities['entries'] ?? []).map((e) => e.id).sort()
    expect(ids).toEqual(['from-backup', 'local-only'])
  })

  it('keeps the newer of two versions of the same record', async () => {
    const file = backupOf(
      snapshotOf([entry('a', { note: 'from backup', updatedAt: '2026-10-13T08:00:00.000Z' })]),
    )
    h = harness(
      snapshotOf([entry('a', { note: 'local', updatedAt: '2026-10-13T10:00:00.000Z' })]),
    )

    await restoreBackup(h.deps, file)

    // The local edit is newer, so the stale backup must not undo it.
    expect(stored(h.local)[0]?.note).toBe('local')
  })

  it('takes a newer version from the backup', async () => {
    const file = backupOf(
      snapshotOf([entry('a', { note: 'from backup', updatedAt: '2026-10-13T10:00:00.000Z' })]),
    )
    h = harness(
      snapshotOf([entry('a', { note: 'stale', updatedAt: '2026-10-13T08:00:00.000Z' })]),
    )

    await restoreBackup(h.deps, file)

    expect(stored(h.local)[0]?.note).toBe('from backup')
  })

  it('reports when the file is not JSON and writes nothing', async () => {
    const result = await restoreBackup(h.deps, 'not json at all')

    expect(result).toMatchObject({ status: 'rejected' })
    expect(h.writes).toHaveLength(0)
  })

  it('rejects a backup from a newer build without touching the database', async () => {
    const file = serialiseEnvelope({
      ...toEnvelope(snapshotOf([entry('a')]), T0),
      schemaVersion: SCHEMA + 1,
    })

    const result = await restoreBackup(h.deps, file)

    expect(result.status).toBe('rejected')
    expect(h.writes).toHaveLength(0)
  })

  it('rejects an unrelated file', async () => {
    const result = await restoreBackup(h.deps, JSON.stringify({ hello: 'world' }))

    expect(result.status).toBe('rejected')
    expect(h.writes).toHaveLength(0)
  })

  it('validates fully before writing anything (0007 F-EXPORT-4)', async () => {
    // Right format, wrong shape: the entry table is not an array of records.
    const file = JSON.stringify({
      format: 'personal-time-tracker-backup',
      formatVersion: 1,
      schemaVersion: SCHEMA,
      exportedAt: T0.toISOString(),
      counts: { entries: 1 },
      data: { entries: 'not-an-array' },
    })

    const result = await restoreBackup(h.deps, file)

    expect(result.status).toBe('rejected')
    // A partial import is worse than none: it would leave the database inconsistent.
    expect(h.writes).toHaveLength(0)
  })

  it('says when the backup was taken', async () => {
    const file = backupOf(snapshotOf([entry('a')]), T0)
    const result = await restoreBackup(h.deps, file)

    expect(result).toMatchObject({ status: 'restored', exportedAt: T0.toISOString() })
  })
})
