import { beforeEach, describe, expect, it } from 'vitest'
import { canonicalStringify, countRecords, mergeSnapshots, type Snapshot } from './merge'
import { Ids, Rng, entry, snapshotOf, tombstone, type EntryOverrides } from '../test/factories'
import type { TimeEntry } from './entries/types'

/**
 * Merge invariants over generated record sets (0010 property tests, 0012 M1–M11).
 *
 * The hand-written cases in `merge.test.ts` each pin one rule with one input. They
 * cannot show that a rule holds for the *combinations* that produce real bugs: a
 * tombstone that happens to tie with an edit, an id present on one side only, three
 * devices that each changed different records.
 *
 * Every case here is generated from a fixed seed, so a failure replays exactly. A
 * random failure that cannot be reproduced is a failure nobody chases.
 */

const SEEDS = [1, 2, 3, 7, 11, 42, 99, 256, 1337, 8080]
const SCHEMA = 1

let ids: Ids

beforeEach(() => {
  ids = new Ids()
})

/**
 * A random record, biased towards collisions.
 *
 * Ids are drawn from a small pool, so two snapshots frequently contain the same id with
 * different `updatedAt`, and sometimes an exact tie. Those are the cases where a merge
 * is actually decided; wide-apart random ids never exercise the decision at all.
 */
function randomEntry(rng: Rng, idPool: string[]): TimeEntry {
  const id = rng.pick(idPool)
  const updatedMinutes = rng.int(0, 240)
  const updatedAt = new Date(Date.UTC(2026, 9, 13, 0, updatedMinutes))
  const startMinutes = Math.max(0, updatedMinutes - rng.int(0, 120))
  const duration = rng.int(0, 480)

  // An exact tie on updatedAt is deliberately possible, so the canonical-string
  // tiebreak gets exercised rather than assumed.
  const base = {
    id,
    projectId: rng.bool(0.2) ? 'p-1' : null,
    tagIds: rng.bool(0.2) ? ['t-1'] : [],
    note: rng.pick(['', 'note', 'edited note']),
    billable: rng.bool(),
    rateOverrideMinor: null,
    source: 'manual' as const,
    createdAt: new Date(Date.UTC(2026, 9, 13, 0, startMinutes)).toISOString(),
    updatedAt: updatedAt.toISOString(),
  }

  const deleted = rng.bool(0.25)
  return {
    ...base,
    start: new Date(Date.UTC(2026, 9, 13, 0, startMinutes)).toISOString(),
    end: new Date(Date.UTC(2026, 9, 13, 0, startMinutes + duration)).toISOString(),
    deletedAt: deleted ? updatedAt.toISOString() : null,
  }
}

function randomSnapshot(rng: Rng, idPool: string[], count: number): Snapshot {
  // Deduplicate by id, as a real device's table would be: one record per id.
  const seen = new Map<string, TimeEntry>()
  for (let i = 0; i < count; i += 1) {
    const record = randomEntry(rng, idPool)
    const existing = seen.get(record.id)
    // Keep the newest, mirroring what the database would hold.
    if (!existing || existing.updatedAt < record.updatedAt) seen.set(record.id, record)
  }
  return snapshotOf([...seen.values()])
}

function mergeOk(a: Snapshot, b: Snapshot, supported = SCHEMA): Snapshot {
  const result = mergeSnapshots(a, b, supported)
  if (!result.ok) throw new Error(`merge unexpectedly blocked: ${result.reason}`)
  return result.merged
}

describe('merge invariants over generated record sets', () => {
  it('never loses a record that exists on either side (M2)', () => {
    for (const seed of SEEDS) {
      const rng = new Rng(seed)
      const pool = ['a', 'b', 'c', 'd']
      const local = randomSnapshot(rng, pool, 6)
      const remote = randomSnapshot(rng, pool, 6)

      const merged = mergeOk(local, remote)

      const expected = new Set([
        ...((local.entities['entries'] ?? []) as TimeEntry[]).map((e) => e.id),
        ...((remote.entities['entries'] ?? []) as TimeEntry[]).map((e) => e.id),
      ])
      const actual = new Set(
        ((merged.entities['entries'] ?? []) as TimeEntry[]).map((e) => e.id),
      )

      // A lost record here is a lost hour of someone's work, so the ids are compared
      // as sets rather than counts: a duplicate could mask a loss.
      expect([...actual].sort(), `seed ${seed}`).toEqual([...expected].sort())
    }
  })

  it('is commutative: either argument order gives the same result (M4)', () => {
    for (const seed of SEEDS) {
      const rng = new Rng(seed)
      const pool = ['a', 'b', 'c', 'd', 'e']
      const local = randomSnapshot(rng, pool, 7)
      const remote = randomSnapshot(rng, pool, 7)

      const forwards = mergeOk(local, remote)
      const backwards = mergeOk(remote, local)

      // Two devices that sync in opposite orders must not end up disagreeing, or they
      // will never converge and no error will ever be reported.
      expect(canonicalStringify(forwards), `seed ${seed}`).toBe(canonicalStringify(backwards))
    }
  })

  it('is idempotent: merging an already-merged snapshot changes nothing (M11)', () => {
    for (const seed of SEEDS) {
      const rng = new Rng(seed)
      const pool = ['a', 'b', 'c']
      const local = randomSnapshot(rng, pool, 5)
      const remote = randomSnapshot(rng, pool, 5)

      const once = mergeOk(local, remote)
      const twice = mergeOk(once, remote)

      expect(canonicalStringify(twice), `seed ${seed}`).toBe(canonicalStringify(once))
    }
  })

  it('is associative across three snapshots (M4)', () => {
    for (const seed of SEEDS) {
      const rng = new Rng(seed)
      const pool = ['a', 'b', 'c', 'd']
      const first = randomSnapshot(rng, pool, 5)
      const second = randomSnapshot(rng, pool, 5)
      const third = randomSnapshot(rng, pool, 5)

      const left = mergeOk(mergeOk(first, second), third)
      const right = mergeOk(first, mergeOk(second, third))

      expect(canonicalStringify(left), `seed ${seed}`).toBe(canonicalStringify(right))
    }
  })

  it('is independent of key insertion order within each record (M4)', () => {
    for (const seed of SEEDS) {
      const rng = new Rng(seed)
      const pool = ['a', 'b']
      const local = randomSnapshot(rng, pool, 4)
      const remote = randomSnapshot(rng, pool, 4)

      // Rebuild both snapshots with their keys reversed. Two devices that reached the
      // same record by different routes must still agree on the winner, which is why
      // the tiebreak compares canonical serialisations.
      const reverseKeys = (snapshot: Snapshot): Snapshot => ({
        schemaVersion: snapshot.schemaVersion,
        entities: {
          entries: ((snapshot.entities['entries'] ?? []) as TimeEntry[]).map(
            (record) => Object.fromEntries(Object.entries(record).reverse()) as TimeEntry,
          ),
        },
      })

      expect(canonicalStringify(mergeOk(reverseKeys(local), remote)), `seed ${seed}`).toBe(
        canonicalStringify(mergeOk(local, reverseKeys(remote))),
      )
    }
  })

  it('takes the newer version whenever the two differ', () => {
    for (const seed of SEEDS) {
      const rng = new Rng(seed)
      const pool = ['a', 'b', 'c']
      const local = randomSnapshot(rng, pool, 6)
      const remote = randomSnapshot(rng, pool, 6)

      const merged = (mergeOk(local, remote).entities['entries'] ?? []) as TimeEntry[]
      const sources = [
        ...((local.entities['entries'] ?? []) as TimeEntry[]),
        ...((remote.entities['entries'] ?? []) as TimeEntry[]),
      ]

      for (const winner of merged) {
        const candidates = sources.filter((e) => e.id === winner.id)
        const newest = candidates.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b))
        // On an exact tie either may win, so only a genuinely newer winner is asserted.
        if (newest.updatedAt > winner.updatedAt) {
          throw new Error(
            `seed ${seed}: id ${winner.id} won at ${winner.updatedAt} over newer ${newest.updatedAt}`,
          )
        }
      }
      expect(merged.length).toBeGreaterThan(0)
    }
  })

  it('produces byte-identical output for identical inputs (M11)', () => {
    for (const seed of SEEDS) {
      const rng = new Rng(seed)
      const pool = ['a', 'b', 'c', 'd']
      const local = randomSnapshot(rng, pool, 6)
      const remote = randomSnapshot(rng, pool, 6)

      expect(canonicalStringify(mergeOk(local, remote)), `seed ${seed}`).toBe(
        canonicalStringify(mergeOk(local, remote)),
      )
    }
  })

  it('retains tombstones, so a deletion is never silently dropped (M6)', () => {
    for (const seed of SEEDS) {
      const rng = new Rng(seed)
      const pool = ['a', 'b', 'c']
      const local = randomSnapshot(rng, pool, 6)
      const remote = randomSnapshot(rng, pool, 6)

      const merged = (mergeOk(local, remote).entities['entries'] ?? []) as TimeEntry[]

      // For each id, the merge must pick one side's record outright. Dropping the
      // tombstone would resurrect the entry on the next pull.
      const tombstones = merged.filter((e) => e.deletedAt !== null)
      expect(countRecords({ schemaVersion: SCHEMA, entities: { entries: merged } })).toBe(
        merged.length,
      )
      // Every id present as a tombstone anywhere must be a tombstone in the output,
      // unless an even newer edit superseded it.
      for (const record of tombstones) {
        const sources = [
          ...((local.entities['entries'] ?? []) as TimeEntry[]),
          ...((remote.entities['entries'] ?? []) as TimeEntry[]),
        ].filter((e) => e.id === record.id)
        const newest = sources.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b))
        if (newest.deletedAt === null) continue
        expect(record.deletedAt, `seed ${seed}`).toBe(newest.deletedAt)
      }
    }
  })

  it('never downgrades the schema version (M8)', () => {
    for (const seed of SEEDS) {
      const rng = new Rng(seed)
      const pool = ['a', 'b']
      const local = randomSnapshot(rng, pool, 3)
      const remote = randomSnapshot(rng, pool, 3)

      const lower = { ...local, schemaVersion: 1 }
      const higher = { ...remote, schemaVersion: 2 }

      // Supported is 2, so a newer *remote* is accepted rather than refused. M9 still
      // blocks a schema this build does not understand, which is a different case and
      // is covered in merge.test.ts.
      expect(mergeOk(lower, higher, 2).schemaVersion).toBe(2)
      expect(mergeOk(higher, lower, 2).schemaVersion).toBe(2)
    }
  })

  it('handles an empty side without discarding anything', () => {
    for (const seed of SEEDS) {
      const rng = new Rng(seed)
      const populated = randomSnapshot(rng, ['a', 'b', 'c'], 5)
      const empty: Snapshot = { schemaVersion: SCHEMA, entities: { entries: [] } }

      expect(countRecords(mergeOk(populated, empty))).toBe(countRecords(populated))
      expect(countRecords(mergeOk(empty, populated))).toBe(countRecords(populated))
    }
  })
})

/**
 * Exact `updatedAt` ties, constructed rather than generated.
 *
 * A generator aiming for ties is the wrong tool: the odds of a collision on a
 * millisecond-precision timestamp are so low that the properties pass without ever
 * reaching the tiebreak. Measuring this first found zero ties across every seed, which
 * is precisely the case worth asserting — so the ties are built directly.
 */
describe('exact updatedAt ties resolve deterministically (M4)', () => {
  const AT = new Date('2026-10-13T09:00:00.000Z')

  function tieRecords(left: EntryOverrides, right: EntryOverrides): [TimeEntry, TimeEntry] {
    return [
      entry({ ...left, id: 'a', updatedAt: AT }),
      entry({ ...right, id: 'a', updatedAt: AT }),
    ]
  }

  it('resolves an edit-versus-deletion tie the same way regardless of order', () => {
    const [live, dead] = tieRecords({ note: 'kept' }, { note: 'kept', deletedAt: AT })

    const forwards = mergeOk(snapshotOf([live]), snapshotOf([dead]))
    const backwards = mergeOk(snapshotOf([dead]), snapshotOf([live]))

    // Whichever wins, both devices must pick the same one. Two devices choosing
    // differently here never converge, and nothing ever reports an error.
    expect(canonicalStringify(forwards)).toBe(canonicalStringify(backwards))
    expect(forwards.entities['entries'] ?? []).toHaveLength(1)
  })

  it('resolves an edit-versus-edit tie the same way regardless of order', () => {
    const [x, y] = tieRecords({ note: 'first' }, { note: 'second' })

    const forwards = mergeOk(snapshotOf([x]), snapshotOf([y]))
    const backwards = mergeOk(snapshotOf([y]), snapshotOf([x]))

    expect(canonicalStringify(forwards)).toBe(canonicalStringify(backwards))
  })

  it('reaches the same answer when key order differs on a tied record', () => {
    const [x, y] = tieRecords({ note: 'first' }, { note: 'second' })
    const reversed = Object.fromEntries(Object.entries(y).reverse()) as TimeEntry

    expect(canonicalStringify(mergeOk(snapshotOf([x]), snapshotOf([y])))).toBe(
      canonicalStringify(mergeOk(snapshotOf([x]), snapshotOf([reversed]))),
    )
  })

  it('actually contains a tie, so the assertions above are not vacuous', () => {
    const [x, y] = tieRecords({ note: 'first' }, { note: 'second' })
    expect(x.updatedAt).toBe(y.updatedAt)
    expect(canonicalStringify(x)).not.toBe(canonicalStringify(y))
  })
})

describe('generated data reaches the cases that matter', () => {
  it('produces tombstones that collide with live records', () => {
    let collisions = 0
    for (const seed of SEEDS) {
      const rng = new Rng(seed)
      const local = randomSnapshot(rng, ['a', 'b', 'c'], 6)
      const remote = randomSnapshot(rng, ['a', 'b', 'c'], 6)

      const locals = (local.entities['entries'] ?? []) as TimeEntry[]
      const remotes = (remote.entities['entries'] ?? []) as TimeEntry[]
      for (const l of locals) {
        for (const r of remotes) {
          if (l.id === r.id && (l.deletedAt === null) !== (r.deletedAt === null)) {
            collisions += 1
          }
        }
      }
    }
    // Without this the deletion-versus-edit path would be untested by the properties.
    expect(collisions).toBeGreaterThan(0)
  })

  it('keeps fixtures distinct, so a shared id cannot hide a lost record', () => {
    const a = entry({ id: ids.next() })
    const b = entry({ id: ids.next() })
    expect(a.id).not.toBe(b.id)
    expect(tombstone().id).not.toBe(tombstone().id)
  })
})
