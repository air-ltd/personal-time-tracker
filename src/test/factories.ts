import type { Snapshot } from '../domain/merge'
import type { TimeEntry } from '../domain/entries/types'
import { entryDurationMs } from '../domain/time/duration'

/**
 * Shared test fixtures (0010 "shared fixtures").
 *
 * Tests that hand-write four entities inline drift apart within a week: two tests end
 * up with different `source` values, a shared field goes missing from one, and a
 * failure points at the fixture rather than the behaviour. Everything here is
 * deterministic, so a failure is reproducible from its name alone.
 *
 * Determinism is the point. `newId()` is deliberately random, which is right in
 * production and wrong here: a failing property test that cannot be replayed is a
 * failing property test nobody reruns.
 */

/** A fixed instant, so no assertion depends on the day the suite happens to run. */
export const T0 = new Date('2026-10-13T09:00:00.000Z')

/**
 * Counter-based id generation.
 *
 * Resets per suite, so `entry()` in one test cannot leak into another.
 */
export class Ids {
  private counter = 0

  next(prefix = 'e'): string {
    this.counter += 1
    return `${prefix}-${String(this.counter).padStart(4, '0')}`
  }

  reset(): void {
    this.counter = 0
  }
}

export const ids = new Ids()

export interface EntryOverrides {
  id?: string
  projectId?: string | null
  tagIds?: string[]
  start?: Date
  end?: Date | null
  note?: string
  billable?: boolean
  rateOverrideMinor?: number | null
  source?: 'manual' | 'timer'
  createdAt?: Date
  updatedAt?: Date
  deletedAt?: Date | null
}

/**
 * A complete `TimeEntry`, with every field of the 0003 shape filled in.
 *
 * Built from the full shape even where a test only cares about one field, so adding a
 * field to the model surfaces here rather than in a dozen hand-written literals.
 */
export function entry(overrides: EntryOverrides = {}): TimeEntry {
  const start = overrides.start ?? new Date('2026-10-13T08:00:00.000Z')
  const end = overrides.end === undefined ? new Date('2026-10-13T09:00:00.000Z') : overrides.end
  const created = overrides.createdAt ?? start
  return {
    id: overrides.id ?? ids.next(),
    projectId: overrides.projectId ?? null,
    tagIds: overrides.tagIds ?? [],
    start: start.toISOString(),
    end: end === null ? null : end.toISOString(),
    note: overrides.note ?? '',
    billable: overrides.billable ?? false,
    rateOverrideMinor: overrides.rateOverrideMinor ?? null,
    source: overrides.source ?? 'manual',
    createdAt: created.toISOString(),
    updatedAt: (overrides.updatedAt ?? end ?? start).toISOString(),
    deletedAt:
      overrides.deletedAt === undefined ? null : (overrides.deletedAt?.toISOString() ?? null),
  }
}

/** A deleted entry: a tombstone, which is what sync actually propagates. */
export function tombstone(overrides: EntryOverrides = {}): TimeEntry {
  const deletedAt = overrides.deletedAt ?? new Date('2026-10-13T10:00:00.000Z')
  return entry({ ...overrides, deletedAt })
}

/** A running entry: `end` is null, so its duration is only known now. */
export function runningEntry(overrides: EntryOverrides = {}): TimeEntry {
  return entry({ ...overrides, end: null })
}

/**
 * A snapshot holding the given entries.
 *
 * `schemaVersion` is a parameter rather than an import of the storage constant,
 * because these fixtures also build *remote* snapshots standing in for a device
 * running a different build.
 */
export function snapshotOf(entries: TimeEntry[], schemaVersion = 1): Snapshot {
  return { schemaVersion, entities: { entries } }
}

/** Entries by id, for asserting on a specific record in a merged snapshot. */
export function byId(snapshot: Snapshot, id: string): TimeEntry | undefined {
  return ((snapshot.entities['entries'] ?? []) as TimeEntry[]).find((e) => e.id === id)
}

/** Ids present in a snapshot, sorted, so order never affects an assertion. */
export function idsOf(snapshot: Snapshot): string[] {
  return ((snapshot.entities['entries'] ?? []) as TimeEntry[]).map((e) => e.id).sort()
}

/** Total duration in whole minutes across a snapshot, for reconciliation checks. */
export function totalMinutes(snapshot: Snapshot, now = T0): number {
  return ((snapshot.entities['entries'] ?? []) as TimeEntry[]).reduce((total, record) => {
    if (record.deletedAt !== null) return total
    const ms = entryDurationMs(record, now)
    return ms === null ? total : total + Math.round(ms / 60_000)
  }, 0)
}

/**
 * Deterministic pseudo-random generator.
 *
 * A seeded LCG rather than a property-testing library: the properties under test are
 * merge invariants that are cheap to state directly, and a fixed seed means a failure
 * replays exactly. A dependency would bring its own opinions about shrinking and
 * reporting for no gain here.
 *
 * Not for anything cryptographic, and not for production code.
 */
export class Rng {
  private state: number

  constructor(seed = 0x2b2b2b) {
    this.state = seed >>> 0
  }

  /** Uniform in [0, 1). */
  next(): number {
    // Numerical Recipes LCG: full period for a 32-bit state, and cheap.
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0
    return this.state / 0x1_0000_0000
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick from an empty list')
    return items[this.int(0, items.length - 1)] as T
  }

  bool(trueProbability = 0.5): boolean {
    return this.next() < trueProbability
  }
}

/** An ISO instant offset from the epoch base, for generated records. */
export function at(minutesFromT0: number): Date {
  return new Date(T0.getTime() + minutesFromT0 * 60_000)
}
