/**
 * Cross-device merge (0012 M1–M11).
 *
 * This is the highest-risk code in the project. It runs unattended, a wrong answer
 * loses a user's history, and a non-deterministic answer means two devices never
 * converge without any error ever being reported (0012 M4).
 *
 * It is therefore a pure function with no I/O, no clock reads and no framework
 * imports (0002 A1, A4), so it can be property-tested directly.
 */

/** Any stored entity that participates in sync. */
import { validatePattern } from './capacity/contract'

export interface Mergeable {
  id: string
  updatedAt: string
  deletedAt: string | null
}

export type EntityTable = Record<string, Mergeable[]>

export interface Snapshot {
  schemaVersion: number
  entities: EntityTable
}

export type MergeOutcome =
  | { ok: true; merged: Snapshot }
  | {
      ok: false
      reason: 'unsupported-schema'
      remoteSchemaVersion: number
      supportedSchemaVersion: number
    }

/**
 * JSON with object keys sorted, recursively.
 *
 * The tiebreak in M4 compares two records that claim the same `updatedAt`. Using
 * plain `JSON.stringify` would not be deterministic: key order follows insertion
 * order, which can differ between two devices that built the same record by
 * different routes. Two devices would then pick different winners from identical
 * data and never agree.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`).join(',')}}`
}

/**
 * Pick the winner for one id present on both sides.
 *
 * Whole-record last-write-wins, never field-by-field: merging fields can synthesise
 * a record that never existed on either device (0012 M3).
 */
function pickWinner<T extends Mergeable>(local: T, remote: T): T {
  if (local.updatedAt > remote.updatedAt) return local
  if (remote.updatedAt > local.updatedAt) return remote

  // Exact tie. Compare canonical serialisations so every device independently
  // arrives at the same answer (0012 M4).
  return canonicalStringify(local) >= canonicalStringify(remote) ? local : remote
}

function mergeTable<T extends Mergeable>(local: readonly T[], remote: readonly T[]): T[] {
  const merged = new Map<string, T>()

  for (const record of local) merged.set(record.id, record)
  for (const record of remote) {
    const existing = merged.get(record.id)
    // Nothing on either side is ever dropped: a union, not a replacement (M2).
    merged.set(record.id, existing ? pickWinner(existing, record) : record)
  }

  // Sorted by id so the output bytes are identical on every device (M11).
  return [...merged.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * Merge two snapshots into one.
 *
 * `deletedAt` is an ordinary field, so a deletion is resolved by the same
 * last-write-wins rule as an edit (M5) and needs no special case. Tombstones are
 * retained in the output so a device that was offline for a month does not
 * resurrect entries deleted elsewhere (M6).
 */
export function mergeSnapshots(
  local: Snapshot,
  remote: Snapshot,
  supportedSchemaVersion: number,
): MergeOutcome {
  // M9. Syncing an older client against a newer schema is how data gets corrupted.
  // Refuse rather than "helpfully" interpreting what we do not understand.
  if (remote.schemaVersion > supportedSchemaVersion) {
    return {
      ok: false,
      reason: 'unsupported-schema',
      remoteSchemaVersion: remote.schemaVersion,
      supportedSchemaVersion,
    }
  }

  const tableNames = new Set([...Object.keys(local.entities), ...Object.keys(remote.entities)])
  const entities: EntityTable = {}

  for (const name of [...tableNames].sort()) {
    const localTable = local.entities[name] ?? []
    const remoteTable = remote.entities[name] ?? []
    entities[name] = mergeTable(localTable, remoteTable)
  }

  return {
    ok: true,
    merged: {
      // M8: never downgrade the schema version by merging with a stale device.
      schemaVersion: Math.max(local.schemaVersion, remote.schemaVersion),
      entities,
    },
  }
}

/**
 * Drop references to records that exist in neither snapshot.
 *
 * After a union, references normally resolve, so this is close to a no-op. It matters
 * when a table was lost outright — a hand-edited import, or a device whose database
 * predates an entity type — and the alternative would be entries carrying a project id
 * nothing can display (0003 F1, F2).
 *
 * Returns new objects for the entries it changes and reuses every other reference, so
 * the input is never modified. That matters because `mergeSnapshots` shares object
 * identity with its arguments: a repair that edited in place would silently rewrite the
 * caller's snapshot.
 */
export function repairReferences(snapshot: Snapshot): Snapshot {
  const entities: EntityTable = { ...snapshot.entities }

  const projectIds = new Set((entities['projects'] ?? []).map((p) => p.id))
  const tagIds = new Set((entities['tags'] ?? []).map((t) => t.id))
  const hasProjects = 'projects' in entities
  const hasTags = 'tags' in entities

  const entries = entities['entries']
  if (entries) {
    entities['entries'] = entries.map((entry) => {
      const record = entry as Mergeable & {
        projectId?: string | null
        tagIds?: string[]
      }

      // Only repair when the taxonomy tables are actually present; otherwise a snapshot
      // with no projects table would have every projectId nulled by a check that has
      // nothing to compare against.
      const danglingProject =
        hasProjects && typeof record.projectId === 'string' && !projectIds.has(record.projectId)

      const danglingTags =
        hasTags && Array.isArray(record.tagIds)
          ? record.tagIds.filter((id) => tagIds.has(id))
          : null

      if (!danglingProject && danglingTags === null) return entry
      if (danglingProject && danglingTags === null) {
        return { ...record, projectId: null }
      }

      /*
       * New objects rather than mutation.
       *
       * This used to edit each entry in place, which meant the result shared object
       * identity with the snapshot passed in — and `mergeSnapshots` hands back the very
       * objects it was given. A caller that repaired after comparing, then compared
       * again, was comparing a record against itself. That is not hypothetical: the sync
       * engine wrote the unrepaired merge locally and published the repaired one, so
       * the database and the remote held different data and every cycle afterwards
       * pushed a redundant correction.
       */
      return {
        ...record,
        projectId: danglingProject ? null : record.projectId,
        tagIds: danglingTags ?? record.tagIds,
      }
    })
  }

  /*
   * Contract periods whose client is missing are dropped (0003 F7).
   *
  /*
   * Contract periods are NOT dropped here.
   *
   * An orphaned contract *could* be dropped here — its content is "these hours are
   * expected on that client", so a contract naming no client describes a scope that
   * cannot be compared against anything, and unlike an entry it cannot be
   * uncategorised and still mean something.
   *
   * It is not, because this function runs on the sync path as well as the import
   * path, and the sync path *publishes* what it returns. Dropping here would let a
   * sync permanently delete a contract from the remote file — the one path in the
   * app where a record can be removed rather than tombstoned. The import path drops
   * orphans deliberately, and reports the drop (0008 J13, 0003 F7); see
   * `dropOrphanedContractPeriods`, which is called from there and nowhere else.
   */

  return { schemaVersion: snapshot.schemaVersion, entities }
}

/**
 * Drop contract periods that cannot be used (0003 F7, CT3).
 *
 * Used by the import path only, and only after the merge has decided what the file
 * contains. The drop is a repair of the *imported* data, not a rule about what the
 * app publishes: a record the user cannot see, cannot attribute and cannot delete
 * from the UI is a record they cannot get rid of, so it is better to drop it and say
 * so than to leave it in place.
 *
 * Not tombstoned, because a tombstone would travel to the other devices as a
 * deletion of something they may still hold.
 *
 * Two things make a contract unusable:
 *
 * - It names a client that is not in the file. A contract's whole content is "these
 *   hours are expected on that client", so a contract naming no client describes a
 *   scope that cannot be compared against anything, and unlike an entry it cannot be
 *   uncategorised and still mean something.
 * - Its work pattern does not agree with its own weekly total. 0003 CT3 requires the
 *   pattern to sum exactly to `minutesPerWeek`, and a contract that breaks it makes
 *   every expected-hours figure disagree with the contract it came from. Kept, it
 *   would be a number that looks authoritative and is not.
 */
export function dropUnusableContractPeriods(snapshot: Snapshot): Snapshot {
  const entities: EntityTable = { ...snapshot.entities }
  const contractPeriods = entities['contractPeriods']
  if (contractPeriods === undefined) {
    return { schemaVersion: snapshot.schemaVersion, entities }
  }

  const clientIds = new Set((entities['clients'] ?? []).map((client) => client.id))
  const hasClients = 'clients' in entities

  entities['contractPeriods'] = contractPeriods.filter((record) => {
    const contract = record as Mergeable & {
      clientId?: string
      minutesPerWeek?: number
      workPattern?: { weekday: number; minutes: number }[]
    }

    // A record with no clientId at all is malformed rather than orphaned, and is
    // dropped too: 0003 CT9 makes the client required.
    if (typeof contract.clientId !== 'string') return false
    if (hasClients && !clientIds.has(contract.clientId)) return false

    // The pattern has to agree with the week it claims to describe.
    if (typeof contract.minutesPerWeek !== 'number') return false
    if (!Array.isArray(contract.workPattern)) return false
    return validatePattern(contract.workPattern, contract.minutesPerWeek).ok
  })

  return { schemaVersion: snapshot.schemaVersion, entities }
}

/** Count records across a snapshot, for tests and diagnostics. */
export function countRecords(snapshot: Snapshot): number {
  return Object.values(snapshot.entities).reduce((total, table) => total + table.length, 0)
}
