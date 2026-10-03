import { describe, expect, it } from 'vitest'
import {
  canonicalStringify,
  countRecords,
  mergeSnapshots,
  repairReferences,
  type Mergeable,
  type Snapshot,
} from './merge'

function record(id: string, updatedAt: string, extra: Record<string, unknown> = {}): Mergeable {
  return { id, updatedAt, deletedAt: null, ...extra }
}

function snap(schemaVersion: number, entities: Record<string, Mergeable[]>): Snapshot {
  return { schemaVersion, entities }
}

const entries = (list: Mergeable[]) => ({ entries: list })

describe('canonicalStringify', () => {
  // The tiebreak depends on this being independent of key insertion order.
  it('is independent of key order', () => {
    const a = { b: 1, a: 2, c: { z: 1, y: 2 } }
    const b = { c: { y: 2, z: 1 }, a: 2, b: 1 }
    expect(canonicalStringify(a)).toBe(canonicalStringify(b))
  })

  it('preserves array order, which is meaningful', () => {
    expect(canonicalStringify([1, 2])).not.toBe(canonicalStringify([2, 1]))
  })

  it('handles primitives and null', () => {
    expect(canonicalStringify(null)).toBe('null')
    expect(canonicalStringify(1)).toBe('1')
    expect(canonicalStringify('x')).toBe('"x"')
  })
})

describe('mergeSnapshots — union (0012 M2)', () => {
  it('keeps records present on only one side', () => {
    const local = snap(1, entries([record('a', '2026-10-13T09:00:00.000Z')]))
    const remote = snap(1, entries([record('b', '2026-10-13T09:00:00.000Z')]))
    const result = mergeSnapshots(local, remote, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.merged.entities.entries?.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('unions across multiple entity tables', () => {
    const local = snap(1, {
      entries: [record('a', '2026-10-13T09:00:00.000Z')],
      projects: [record('p', '2026-10-13T09:00:00.000Z')],
    })
    const remote = snap(1, {
      entries: [record('b', '2026-10-13T09:00:00.000Z')],
      tags: [record('t', '2026-10-13T09:00:00.000Z')],
    })
    const result = mergeSnapshots(local, remote, 1)
    if (!result.ok) throw new Error('expected ok')
    expect(Object.keys(result.merged.entities).sort()).toEqual(['entries', 'projects', 'tags'])
    expect(countRecords(result.merged)).toBe(4)
  })
})

describe('mergeSnapshots — last write wins (0012 M3)', () => {
  it('takes the later updatedAt, whole record', () => {
    const local = snap(1, entries([record('a', '2026-10-13T09:00:00.000Z', { note: 'old' })]))
    const remote = snap(1, entries([record('a', '2026-10-13T11:00:00.000Z', { note: 'new' })]))
    const result = mergeSnapshots(local, remote, 1)
    if (!result.ok) throw new Error('expected ok')
    expect(result.merged.entities.entries?.[0]).toMatchObject({ note: 'new' })
  })

  it('does not synthesise a record from fields of both', () => {
    const local = snap(
      1,
      entries([record('a', '2026-10-13T09:00:00.000Z', { note: 'local note', rate: 10 })]),
    )
    const remote = snap(
      1,
      entries([record('a', '2026-10-13T11:00:00.000Z', { note: 'remote note' })]),
    )
    const result = mergeSnapshots(local, remote, 1)
    if (!result.ok) throw new Error('expected ok')
    // The winner's shape exactly; `rate` from the loser must not survive.
    expect(result.merged.entities.entries?.[0]).toEqual({
      id: 'a',
      updatedAt: '2026-10-13T11:00:00.000Z',
      deletedAt: null,
      note: 'remote note',
    })
  })
})

describe('mergeSnapshots — deterministic tiebreak (0012 M4)', () => {
  const sameTime = '2026-10-13T09:00:00.000Z'

  it('resolves the same winner regardless of which side is local', () => {
    const a = record('a', sameTime, { note: 'AAA' })
    const b = record('a', sameTime, { note: 'BBB' })

    const first = mergeSnapshots(snap(1, entries([a])), snap(1, entries([b])), 1)
    const second = mergeSnapshots(snap(1, entries([b])), snap(1, entries([a])), 1)
    if (!first.ok || !second.ok) throw new Error('expected ok')

    // Two devices must independently agree. If these differ they would re-derive
    // different results on every subsequent sync and never converge.
    expect(canonicalStringify(first.merged)).toBe(canonicalStringify(second.merged))
  })

  it('resolves ties identically even with different key insertion order', () => {
    const a = { id: 'a', updatedAt: sameTime, deletedAt: null, note: 'x' }
    const b = { deletedAt: null, updatedAt: sameTime, id: 'a', note: 'x' }
    const first = mergeSnapshots(snap(1, entries([a])), snap(1, entries([b])), 1)
    if (!first.ok) throw new Error('expected ok')
    expect(first.merged.entities.entries).toHaveLength(1)
  })
})

describe('mergeSnapshots — tombstones (0012 M5, M6)', () => {
  it('a newer deletion beats an older edit', () => {
    const local = snap(1, entries([record('a', '2026-10-13T09:00:00.000Z')]))
    const remote = snap(
      1,
      entries([
        record('a', '2026-10-13T11:00:00.000Z', { deletedAt: '2026-10-13T11:00:00.000Z' }),
      ]),
    )
    const result = mergeSnapshots(local, remote, 1)
    if (!result.ok) throw new Error('expected ok')
    expect(result.merged.entities.entries?.[0]?.deletedAt).toBe('2026-10-13T11:00:00.000Z')
  })

  it('a newer edit resurrects a deleted record', () => {
    // The deletion must be the OLDER action for the edit to win. Written the other
    // way round this asserts the opposite, and last-write-wins correctly keeps the
    // deletion.
    const local = snap(
      1,
      entries([
        record('a', '2026-10-13T09:00:00.000Z', { deletedAt: '2026-10-13T09:00:00.000Z' }),
      ]),
    )
    const remote = snap(1, entries([record('a', '2026-10-13T11:00:00.000Z')]))
    const result = mergeSnapshots(local, remote, 1)
    if (!result.ok) throw new Error('expected ok')
    expect(result.merged.entities.entries?.[0]?.deletedAt).toBeNull()
  })

  // M6: a device offline for a month must not bring deleted entries back.
  it('retains tombstones through a merge', () => {
    const local = snap(
      1,
      entries([
        record('a', '2026-10-13T11:00:00.000Z', { deletedAt: '2026-10-13T11:00:00.000Z' }),
      ]),
    )
    const remote = snap(1, entries([record('b', '2026-10-13T12:00:00.000Z')]))
    const result = mergeSnapshots(local, remote, 1)
    if (!result.ok) throw new Error('expected ok')
    const ids = result.merged.entities.entries?.map((e) => e.id) ?? []
    expect(ids).toContain('a')
    expect(result.merged.entities.entries?.find((e) => e.id === 'a')?.deletedAt).not.toBeNull()
  })
})

describe('mergeSnapshots — schema version (0012 M8, M9)', () => {
  it('takes the maximum', () => {
    const result = mergeSnapshots(snap(3, entries([])), snap(2, entries([])), 3)
    if (!result.ok) throw new Error('expected ok')
    expect(result.merged.schemaVersion).toBe(3)
  })

  it('never downgrades when merging with a stale device', () => {
    const result = mergeSnapshots(snap(3, entries([])), snap(1, entries([])), 3)
    if (!result.ok) throw new Error('expected ok')
    expect(result.merged.schemaVersion).toBe(3)
  })

  // M9: an older build must refuse rather than interpret what it cannot understand.
  it('refuses a newer remote schema and does not merge', () => {
    const result = mergeSnapshots(
      snap(1, entries([record('a', '2026-10-13T09:00:00.000Z')])),
      snap(5, entries([])),
      1,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unsupported-schema')
    expect(result.remoteSchemaVersion).toBe(5)
    expect(result.supportedSchemaVersion).toBe(1)
  })

  it('accepts an equal schema version', () => {
    expect(mergeSnapshots(snap(2, entries([])), snap(2, entries([])), 2).ok).toBe(true)
  })
})

describe('mergeSnapshots — determinism (0012 M11)', () => {
  it('produces byte-identical output for the same inputs', () => {
    const local = snap(
      1,
      entries([
        record('b', '2026-10-13T09:00:00.000Z'),
        record('a', '2026-10-13T10:00:00.000Z'),
      ]),
    )
    const remote = snap(
      1,
      entries([
        record('c', '2026-10-13T11:00:00.000Z'),
        record('a', '2026-10-13T12:00:00.000Z'),
      ]),
    )
    const one = mergeSnapshots(local, remote, 1)
    const two = mergeSnapshots(local, remote, 1)
    if (!one.ok || !two.ok) throw new Error('expected ok')
    expect(canonicalStringify(one.merged)).toBe(canonicalStringify(two.merged))
  })

  it('sorts output by id regardless of input order', () => {
    const local = snap(
      1,
      entries([
        record('z', '2026-10-13T09:00:00.000Z'),
        record('a', '2026-10-13T09:00:00.000Z'),
      ]),
    )
    const remote = snap(1, entries([]))
    const result = mergeSnapshots(local, remote, 1)
    if (!result.ok) throw new Error('expected ok')
    expect(result.merged.entities.entries?.map((e) => e.id)).toEqual(['a', 'z'])
  })
})

describe('mergeSnapshots — invariants over randomised input', () => {
  // Deterministic PRNG so a failure is reproducible rather than a one-off.
  function makeRandom(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0
      return state / 0x1_0000_0000
    }
  }

  function randomSnapshot(random: () => number, idCount: number): Snapshot {
    const list: Mergeable[] = []
    for (let i = 0; i < idCount; i += 1) {
      if (random() < 0.3) continue // some ids absent from this side
      const id = `id-${Math.floor(random() * idCount)}`
      const minute = Math.floor(random() * 60)
      const deleted =
        random() < 0.25 ? `2026-10-13T${String(minute).padStart(2, '0')}:00:00.000Z` : null
      // An extra payload field, to prove merge passes unknown keys through intact
      // rather than reconstructing records from known fields only.
      list.push({
        id,
        updatedAt: `2026-10-13T${String(minute).padStart(2, '0')}:00:00.000Z`,
        deletedAt: deleted,
        payload: Math.floor(random() * 1000),
      } as Mergeable)
    }
    // Deduplicate ids within one side, keeping the last occurrence.
    const byId = new Map(list.map((r) => [r.id, r]))
    return { schemaVersion: 1, entities: { entries: [...byId.values()] } }
  }

  it('never loses a record that exists on either side', () => {
    const random = makeRandom(20261013)
    for (let trial = 0; trial < 300; trial += 1) {
      const local = randomSnapshot(random, 12)
      const remote = randomSnapshot(random, 12)
      const result = mergeSnapshots(local, remote, 1)
      if (!result.ok) throw new Error('expected ok')

      const expected = new Set([
        ...(local.entities.entries ?? []).map((e) => e.id),
        ...(remote.entities.entries ?? []).map((e) => e.id),
      ])
      const actual = new Set((result.merged.entities.entries ?? []).map((e) => e.id))
      expect([...actual].sort()).toEqual([...expected].sort())
    }
  })

  it('is commutative: either argument order gives the same result', () => {
    const random = makeRandom(777)
    for (let trial = 0; trial < 300; trial += 1) {
      const local = randomSnapshot(random, 10)
      const remote = randomSnapshot(random, 10)
      const a = mergeSnapshots(local, remote, 1)
      const b = mergeSnapshots(remote, local, 1)
      if (!a.ok || !b.ok) throw new Error('expected ok')
      expect(canonicalStringify(a.merged)).toBe(canonicalStringify(b.merged))
    }
  })

  it('is idempotent: merging an already-merged snapshot changes nothing', () => {
    const random = makeRandom(31337)
    for (let trial = 0; trial < 300; trial += 1) {
      const local = randomSnapshot(random, 10)
      const remote = randomSnapshot(random, 10)
      const first = mergeSnapshots(local, remote, 1)
      if (!first.ok) throw new Error('expected ok')
      const second = mergeSnapshots(first.merged, remote, 1)
      if (!second.ok) throw new Error('expected ok')
      expect(canonicalStringify(second.merged)).toBe(canonicalStringify(first.merged))
    }
  })

  it('is associative across three snapshots', () => {
    const random = makeRandom(4242)
    for (let trial = 0; trial < 200; trial += 1) {
      const a = randomSnapshot(random, 8)
      const b = randomSnapshot(random, 8)
      const c = randomSnapshot(random, 8)
      const left = mergeSnapshots(
        mergeSnapshots(a, b, 1).ok
          ? (mergeSnapshots(a, b, 1) as { ok: true; merged: Snapshot }).merged
          : a,
        c,
        1,
      )
      const ab = mergeSnapshots(a, b, 1)
      if (!ab.ok) throw new Error('expected ok')
      const bc = mergeSnapshots(b, c, 1)
      if (!bc.ok) throw new Error('expected ok')
      const right = mergeSnapshots(ab.merged, bc.merged, 1)
      if (!right.ok) throw new Error('expected ok')
      expect(canonicalStringify(left.ok ? left.merged : null)).toBe(
        canonicalStringify(right.merged),
      )
    }
  })
})

describe('repairReferences (0012 M7, 0003 F1–F2)', () => {
  it('nulls a projectId that does not exist', () => {
    const snapshot = snap(1, {
      projects: [record('p1', '2026-10-13T09:00:00.000Z')],
      entries: [record('e1', '2026-10-13T09:00:00.000Z', { projectId: 'ghost', tagIds: [] })],
    })
    const repaired = repairReferences(snapshot)
    expect(
      (repaired.entities.entries?.[0] as unknown as { projectId: string | null }).projectId,
    ).toBeNull()
  })

  it('keeps a projectId that does exist', () => {
    const snapshot = snap(1, {
      projects: [record('p1', '2026-10-13T09:00:00.000Z')],
      entries: [record('e1', '2026-10-13T09:00:00.000Z', { projectId: 'p1', tagIds: [] })],
    })
    const repaired = repairReferences(snapshot)
    expect(
      (repaired.entities.entries?.[0] as unknown as { projectId: string | null }).projectId,
    ).toBe('p1')
  })

  it('drops tag ids that do not exist and keeps the rest', () => {
    const snapshot = snap(1, {
      tags: [record('t1', '2026-10-13T09:00:00.000Z')],
      entries: [
        record('e1', '2026-10-13T09:00:00.000Z', { projectId: null, tagIds: ['t1', 'ghost'] }),
      ],
    })
    const repaired = repairReferences(snapshot)
    expect((repaired.entities.entries?.[0] as unknown as { tagIds: string[] }).tagIds).toEqual([
      't1',
    ])
  })

  // Phase 2B has no taxonomy tables. Repairing against an absent table would null
  // every reference, which is a bug that only appears before Phase 4.
  it('leaves references alone when the taxonomy tables are absent', () => {
    const snapshot = snap(1, {
      entries: [
        record('e1', '2026-10-13T09:00:00.000Z', {
          projectId: 'whatever',
          tagIds: ['anything'],
        }),
      ],
    })
    const repaired = repairReferences(snapshot)
    const entry = repaired.entities.entries?.[0] as unknown as {
      projectId: string
      tagIds: string[]
    }
    expect(entry.projectId).toBe('whatever')
    expect(entry.tagIds).toEqual(['anything'])
  })

  it('never removes an entry', () => {
    const snapshot = snap(1, {
      projects: [],
      entries: [record('e1', '2026-10-13T09:00:00.000Z', { projectId: 'ghost' })],
    })
    expect(countRecords(repairReferences(snapshot))).toBe(1)
  })
})
