import { beforeEach, describe, expect, it } from 'vitest'
import { restoreBackup, backupFilename, type BackupDeps } from './backup'
import { FORMAT, FORMAT_VERSION, parseEnvelope, toEnvelope } from './envelope'
import type { Snapshot, Mergeable } from '../domain/merge'
import type { TimeEntry } from '../domain/entries/types'

/**
 * Restoring a file written by a *previous release* (SPECS/todo.md item 68).
 *
 * 0.1.0 shipped at `SCHEMA_VERSION = 3`, and its `TABLES` was
 * `['entries', 'projects', 'clients', 'tags']` — no `settings` table, because the split out
 * of `meta` came later. So a backup file, or a JSON file in Dropbox, that a real user is
 * holding right now has **no `settings` key at all**.
 *
 * The failure this guards is not a crash. It is a preference quietly becoming a default:
 * a restore that treated the absent key as "this user has no settings" would reset their
 * billing currency and their entry period, the app would look perfectly healthy, and there
 * would be nothing to notice. The envelope's `settings` field is `.optional()` and dropped
 * rather than defaulted precisely to prevent that — and until now nothing tested it.
 */

const SCHEMA = 4
const T0 = new Date('2026-10-13T09:00:00.000Z')
const NOW = '2026-10-13T09:00:00.000Z'

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

/**
 * A settings row: mergeable, plus the `value` column that `Mergeable` does not declare.
 *
 * Not a cast to `Mergeable`, because that would drop the very column the merge is being
 * tested about. `Mergeable & { value: unknown }` is what the envelope actually reads — it
 * treats `settings` as a loose table precisely so this column survives the round trip.
 */
type SettingRow = Mergeable & { value: unknown }

/** The preferences this device has already chosen. */
function localSettings(): SettingRow[] {
  return [
    { id: 'app-default-currency', value: 'JPY', updatedAt: NOW, deletedAt: null },
    { id: 'visible-currencies', value: ['GBP', 'JPY'], updatedAt: NOW, deletedAt: null },
    { id: 'entry-period', value: 'week', updatedAt: NOW, deletedAt: null },
  ]
}

function snapshotOf(entities: Snapshot['entities'], schemaVersion = SCHEMA): Snapshot {
  return { schemaVersion, entities }
}

function harness(initial: Snapshot) {
  const state = { local: initial }
  const deps: BackupDeps = {
    readLocal: () => Promise.resolve(state.local),
    writeLocal: (snapshot) => {
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
  }
}

/**
 * A file exactly as 0.1.0 wrote it: schema 3, and a `data` object with no `settings` key.
 *
 * Hand-written rather than produced by `toEnvelope`, because `toEnvelope` is this build's
 * serialiser and would add the key the whole point is that the file lacks.
 */
function fileFrom010(entries: TimeEntry[] = [entry('a')]): string {
  return JSON.stringify({
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    schemaVersion: 3,
    exportedAt: '2026-10-05T09:00:00.000Z',
    counts: { entries: entries.length },
    data: { entries },
  })
}

/** The local settings rows keyed by id, so order cannot disguise a difference. */
function settingsById(): Record<string, unknown> {
  return Object.fromEntries((h.local.entities['settings'] ?? []).map(byId))
}

function byId(row: Mergeable): [string, unknown] {
  return [String(row['id']), row]
}

let h: ReturnType<typeof harness>

beforeEach(() => {
  h = harness(snapshotOf({ entries: [entry('a'), entry('b')] }))
})

describe('parsing a file from a previous release', () => {
  it('accepts an older schema version rather than refusing it', () => {
    const parsed = parseEnvelope(JSON.parse(fileFrom010()), SCHEMA)

    // Refusing would strand the user with a file they cannot import and no way to recover
    // their work. Only a *newer* schema is refused, since that one cannot be half-read.
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.snapshot.schemaVersion).toBe(3)
  })

  it('drops the absent settings key instead of defaulting it to an empty table', () => {
    const parsed = parseEnvelope(JSON.parse(fileFrom010()), SCHEMA)
    if (!parsed.ok) throw new Error('expected the file to parse')

    /*
     * The distinction is the whole test. `[]` would be a real assertion that the user has no
     * settings, and an empty table merged over a populated one would delete their
     * preferences. Absent has to stay absent.
     */
    expect('settings' in parsed.snapshot.entities).toBe(false)
    expect(parsed.snapshot.entities['settings']).toBeUndefined()
  })
})

describe('restoring a file from a previous release', () => {
  it('keeps this device’s settings when the file has none', async () => {
    h = harness(snapshotOf({ entries: [entry('a')], settings: localSettings() }))

    const result = await restoreBackup(h.deps, fileFrom010([entry('a'), entry('b')]))

    expect(result.status).toBe('restored')
    /*
     * The user's billing currency and period survive a restore from a file that predates
     * the settings table. Were this to come back empty, the app would carry on reading the
     * fallback currency and the default period with nothing wrong-looking on screen.
     *
     * Compared as a set, by id. The merge emits the merged table in its own order, which is
     * not this one — and a test that pinned the order would fail on a harmless reordering
     * while still passing if a row were replaced by an equal one.
     */
    expect(settingsById()).toEqual(Object.fromEntries(localSettings().map(byId)))
  })

  it('still brings across the entries the file does contain', async () => {
    h = harness(snapshotOf({ entries: [], settings: localSettings() }))

    await restoreBackup(h.deps, fileFrom010([entry('a'), entry('b')]))

    // The point of a restore is the records. Settings are only the thing that must not be
    // sacrificed to get them, so both halves are asserted together.
    expect(h.local.entities['entries']).toHaveLength(2)
    expect(h.local.entities['settings']).toHaveLength(3)
  })

  it('leaves a device with no settings alone rather than inventing any', async () => {
    // The other direction: a fresh device restoring an old file has no preferences to lose,
    // and must not acquire some as a side effect of the restore.
    h = harness(snapshotOf({ entries: [] }))

    const result = await restoreBackup(h.deps, fileFrom010())

    expect(result.status).toBe('restored')
    expect(h.local.entities['settings']).toBeUndefined()
  })

  it('round-trips a current file with settings and does not duplicate them', async () => {
    h = harness(snapshotOf({ entries: [entry('a')], settings: localSettings() }))
    const current = JSON.stringify(toEnvelope(h.local, new Date('2026-10-13T09:00:00.000Z')))

    await restoreBackup(h.deps, current)

    const ids = (h.local.entities['settings'] as Mergeable[]).map((row) => row.id).sort()
    expect(ids).toEqual(['app-default-currency', 'entry-period', 'visible-currencies'])
  })

  it('names the file it produces, so the old ones are still recognisable', () => {
    // Not a migration assertion, but the only way anyone tells a 0.1.0 file from a current
    // one by eye. Cheap to keep and easy to break by changing the prefix.
    expect(backupFilename(T0)).toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})
