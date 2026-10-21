/**
 * Entry-only reports (0006 R1–R7).
 *
 * Every figure here is computed at read time from the entries themselves, with no
 * persisted results (0006 RP1) and no precomputed rollups (0006 P2). A rollup would
 * be a second source of truth that can disagree with the entries, which is exactly the
 * failure RP1 exists to prevent.
 *
 * Two invariants run through all of it:
 *
 * - **Reconciliation** (0006 RP2): a breakdown's groups sum to the headline total, with
 *   no unallocated remainder. Every group here is derived from a partition of the
 *   entries, so the sum is exact by construction rather than by a final adjustment.
 * - **Unknown propagates** (0006 RP2, and the same rule the summaries use): an entry
 *   whose duration cannot be read poisons the total it belongs to, rather than being
 *   counted as zero. A total that quietly omits an unreadable entry is a confident
 *   wrong number.
 */

import { entryDurationMs } from '../time/duration'
import { dayKey, localDayBounds } from '../time/days'
import { resolveCurrency, resolveRateMinor } from '../taxonomy/money'
import { billableAmountMinor, billableDurationMs } from './rounding'
import type { TimeEntry } from '../entries/types'
import type { Client, Project } from '../taxonomy/types'
import type { DateRange, RangeMode } from './ranges'

/** The taxonomy a report needs, so a group can be named rather than merely identified. */
export interface ReportTaxonomy {
  projects: readonly Project[]
  clients: readonly Client[]
  /** The app-wide default currency, for money that resolves to it. */
  defaultCurrency: string
}

export interface ReportEntry {
  entry: TimeEntry
  /** Duration in milliseconds, or null when it cannot be read. */
  durationMs: number | null
  project: Project | null
  client: Client | null
  /** The client the entry belongs to, resolved through its project (0005 R3). */
  clientId: string | null
  /** The billable duration, rounded to the increment (0006 RD4). */
  billableMs: number | null
  /** The monetary value in minor units, or null when no rate resolves. */
  amountMinor: number | null
  /** The currency the amount is in, or null when there is no amount. */
  currency: string | null
  /**
   * The rate that actually applies, in minor units per hour, or null when none does.
   *
   * The *resolved* rate rather than the project's default: an entry with an override
   * bills at the override, and an invoice that showed the default would be claiming a
   * rate that was never charged (0006 I3).
   */
  rateMinorPerHour: number | null
}

/** The placeholder for work with no client (0005 R3, U1). */
export const UNASSIGNED = 'Unassigned'

/**
 * Prepare entries for reporting: resolve their taxonomy, duration and money.
 *
 * Done once and passed around, so every report agrees about what an entry's duration
 * and rate are. Two reports computing them separately is how a breakdown stops
 * reconciling with its total.
 */
export function prepareEntries(
  entries: readonly TimeEntry[],
  taxonomy: ReportTaxonomy,
  now: Date,
  incrementMinutes: number,
): ReportEntry[] {
  const projectById = new Map(taxonomy.projects.map((row) => [row.id, row]))
  const clientById = new Map(taxonomy.clients.map((row) => [row.id, row]))

  return entries.map((entry) => {
    const project = entry.projectId === null ? null : (projectById.get(entry.projectId) ?? null)
    const client = project?.clientId ? (clientById.get(project.clientId) ?? null) : null
    const durationMs = entryDurationMs(entry, now)

    const rateMinor = resolveRateMinor({
      rateOverrideMinor: entry.rateOverrideMinor,
      project,
      client,
    })
    const currency =
      rateMinor === null
        ? null
        : resolveCurrency(project, client, taxonomy.defaultCurrency).code

    const billableMs =
      durationMs === null ? null : billableDurationMs(durationMs, incrementMinutes)
    const amountMinor =
      durationMs === null || rateMinor === null
        ? null
        : billableAmountMinor(durationMs, incrementMinutes, rateMinor)

    return {
      entry,
      durationMs,
      project,
      client,
      clientId: client?.id ?? null,
      billableMs,
      amountMinor,
      currency,
      rateMinorPerHour: rateMinor,
    }
  })
}

/**
 * The milliseconds of an entry that fall inside a range.
 *
 * `clipped` counts only the time inside the range; `overlap` counts the whole entry
 * when any part of it touches the range (0006 DR5). The two are different questions
 * and the choice is exposed rather than assumed.
 *
 * Null when the entry cannot be read, so the caller can propagate the unknown.
 */
export function durationInRange(
  prepared: ReportEntry,
  range: DateRange,
  mode: RangeMode,
  now: Date,
): number | null {
  if (prepared.durationMs === null) return null

  const start = new Date(prepared.entry.start)
  const end = prepared.entry.end === null ? now : new Date(prepared.entry.end)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null

  const rangeStart = localDayBounds(range.from).start
  const rangeEnd = localDayBounds(range.to).end

  if (mode === 'overlap') {
    const overlaps =
      start.getTime() < rangeEnd.getTime() && rangeStart.getTime() < end.getTime()
    return overlaps ? prepared.durationMs : 0
  }

  const from = Math.max(start.getTime(), rangeStart.getTime())
  const to = Math.min(end.getTime(), rangeEnd.getTime())
  return to > from ? to - from : 0
}

/**
 * A group in a breakdown (0006 R2).
 *
 * `totalMs` is null when any entry in the group had an unreadable duration, so the
 * group says "I do not know" rather than reporting a partial figure as a whole.
 */
export interface BreakdownGroup {
  /** A stable key for the group: a project id, a client id, or a tag id. */
  key: string
  /** The name to show. */
  label: string
  totalMs: number | null
  entryCount: number
  /** Share of the headline total, as a percentage. Null when the total is unknown. */
  percentage: number | null
  /** The billable value in minor units, or null when no rate resolved. */
  amountMinor: number | null
  /** The currency the amount is in. */
  currency: string | null
}

export type BreakdownDimension = 'project' | 'client' | 'tag'

/**
 * Group entries by a dimension (0006 R2).
 *
 * The groups partition the entries, so their durations sum to the headline total
 * exactly — reconciliation is a property of the construction rather than something to
 * be checked afterwards (0006 RP2).
 *
 * The percentage denominator is the headline total. The spec does not state it, and
 * this is the only denominator that makes a breakdown's percentages sum to 100 — which
 * is what RP2 requires of a breakdown.
 */
export function breakdownBy(
  prepared: readonly ReportEntry[],
  dimension: BreakdownDimension,
  durations: readonly (number | null)[],
): { groups: BreakdownGroup[]; totalMs: number | null } {
  const totalMs = sumDurations(durations)
  const buckets = new Map<
    string,
    {
      label: string
      totalMs: number | null
      count: number
      amountMinor: number | null
      currency: string | null
    }
  >()

  prepared.forEach((item, index) => {
    const duration = durations[index] ?? null
    const { key, label } = groupKeyFor(item, dimension)

    const bucket = buckets.get(key) ?? {
      label,
      totalMs: 0,
      count: 0,
      amountMinor: null,
      currency: null,
    }
    bucket.count += 1
    if (bucket.totalMs === null || duration === null) {
      bucket.totalMs = null
    } else {
      bucket.totalMs += duration
    }
    if (item.amountMinor !== null) {
      bucket.amountMinor = (bucket.amountMinor ?? 0) + item.amountMinor
      bucket.currency = item.currency
    }
    buckets.set(key, bucket)
  })

  const groups = [...buckets.entries()].map(([key, bucket]) => ({
    key,
    label: bucket.label,
    totalMs: bucket.totalMs,
    entryCount: bucket.count,
    percentage: percentageOf(bucket.totalMs, totalMs),
    amountMinor: bucket.amountMinor,
    currency: bucket.currency,
  }))

  // Duration descending by default, with the unnamed group last so it never leads a
  // report (0006 R2).
  groups.sort((a, b) => {
    if (a.key === UNASSIGNED) return 1
    if (b.key === UNASSIGNED) return -1
    if (a.totalMs === null && b.totalMs === null) return a.label.localeCompare(b.label)
    if (a.totalMs === null) return 1
    if (b.totalMs === null) return -1
    if (a.totalMs !== b.totalMs) return b.totalMs - a.totalMs
    return a.label.localeCompare(b.label)
  })

  return { groups, totalMs }
}

function groupKeyFor(
  item: ReportEntry,
  dimension: BreakdownDimension,
): { key: string; label: string } {
  switch (dimension) {
    case 'project':
      return item.project === null
        ? { key: UNASSIGNED, label: UNASSIGNED }
        : { key: item.project.id, label: item.project.name }

    case 'client':
      return item.client === null
        ? { key: UNASSIGNED, label: UNASSIGNED }
        : { key: item.client.id, label: item.client.name }

    case 'tag': {
      // An entry can carry several tags, so it appears in more than one group. That is
      // what a breakdown by tag means, and it is why a tag breakdown's total is the
      // sum of the entries, not the sum of the groups.
      const first = item.entry.tagIds[0]
      if (first === undefined) return { key: UNASSIGNED, label: UNASSIGNED }
      return { key: first, label: first }
    }
  }
}

/**
 * Daily totals (0006 R1).
 *
 * One row per local day: the total duration, the number of entries, and the split
 * across projects. Day totals are computed by clipping each entry at local midnight,
 * never by dividing the range's duration by the number of days (0006 DT2) — a local
 * day is 23 or 25 hours on a transition day, and dividing is an hour out twice a year.
 */
export interface DailyTotal {
  dayKey: string
  totalMs: number | null
  entryCount: number
  /** Duration per project id. */
  byProject: Map<string, number | null>
}

export function dailyTotals(
  prepared: readonly ReportEntry[],
  durations: readonly (number | null)[],
): DailyTotal[] {
  const days = new Map<string, DailyTotal>()

  prepared.forEach((item, index) => {
    const duration = durations[index] ?? null
    const start = new Date(item.entry.start)
    if (Number.isNaN(start.getTime())) return
    const key = dayKey(start)

    const day = days.get(key) ?? {
      dayKey: key,
      totalMs: 0,
      entryCount: 0,
      // Annotated rather than inferred: a bare `new Map()` is `Map<any, any>`, and the
      // union with the stored day would make every use of it untyped.
      byProject: new Map<string, number | null>(),
    }
    day.entryCount += 1
    if (day.totalMs === null || duration === null) {
      day.totalMs = null
    } else {
      day.totalMs += duration
    }

    const projectKey = item.project?.id ?? UNASSIGNED
    const projectTotal = day.byProject.get(projectKey)
    if (projectTotal === undefined) day.byProject.set(projectKey, duration)
    else if (projectTotal === null || duration === null) day.byProject.set(projectKey, null)
    else day.byProject.set(projectKey, projectTotal + duration)

    days.set(key, day)
  })

  return [...days.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey))
}

/**
 * The billable summary (0006 R6).
 *
 * The billable figure is the rounded duration (0006 RD2), so it is the same number
 * that appears on an invoice line — not a second, differently-rounded version of the
 * hours worked.
 */
export interface BillableSummary {
  /** Minutes, like every other figure on the reports screen. */
  billableMinutes: number | null
  nonBillableMinutes: number | null
  totalMinutes: number | null
  /**
   * The billable time *before* rounding, in milliseconds.
   *
   * 0006 RD5 requires the app to show both the raw duration and the rounded one
   * wherever they differ, so the raw figure has to be carried as well as the rounded
   * one. It is not a second policy: it is the same time, unrounded, so a reader can
   * see what the rounding changed.
   */
  rawBillableMinutes: number | null
  /** The total monetary value, per currency. Never summed across currencies. */
  amountByCurrency: Map<string, number>
}

export function billableSummary(ranged: readonly RangedEntry[]): BillableSummary {
  let billable = 0
  let rawBillable = 0
  let nonBillable = 0
  let total = 0
  let unknown = false
  const amountByCurrency = new Map<string, number>()

  for (const { item, ms, billableMs } of ranged) {
    if (ms === null) {
      unknown = true
      continue
    }
    total += ms
    if (item.entry.billable) {
      // The rounded *clipped* duration, so the billable figure is about the same
      // period as the total beside it. An entry that ran from before the period
      // into it contributes only the part inside.
      billable += billableMs ?? ms
      rawBillable += ms
    } else nonBillable += ms

    if (item.amountMinor !== null && item.currency !== null) {
      amountByCurrency.set(
        item.currency,
        (amountByCurrency.get(item.currency) ?? 0) + item.amountMinor,
      )
    }
  }

  /*
   * Minutes, not milliseconds.
   *
   * These figures are shown beside the other reports, which are in minutes, and they
   * were in milliseconds — so five hours of work read as "300000h". The figure was
   * never wrong about the *amount*; it was wrong about the unit, and a unit error in
   * a number that is otherwise plausible is the worst kind.
   */
  return {
    billableMinutes: unknown ? null : billable / 60_000,
    nonBillableMinutes: unknown ? null : nonBillable / 60_000,
    totalMinutes: unknown ? null : total / 60_000,
    rawBillableMinutes: unknown ? null : rawBillable / 60_000,
    amountByCurrency,
  }
}

/**
 * The entries in a range, with the duration each one contributes.
 *
 * **Both** figures are clipped to the range: the time it contributed, and the billable
 * time it contributed.
 *
 * The billable one matters as much as the other. An entry that runs from before the
 * range into it contributes only the part inside, and the billable figure has to be
 * the rounded *clipped* time — otherwise a month's total says "8 hours" and the
 * billable figure beside it says the whole of an entry that started last month.
 *
 * One function, so the reports cannot disagree about which entries are in the period
 * or what they contributed to it.
 */
export interface RangedEntry {
  item: ReportEntry
  /** Milliseconds inside the range. Null when the entry's duration cannot be read. */
  ms: number | null
  /** The billable duration inside the range, rounded to the increment. */
  billableMs: number | null
}

export function rangeEntries(
  prepared: readonly ReportEntry[],
  range: DateRange,
  mode: RangeMode,
  now: Date,
  incrementMinutes: number,
): RangedEntry[] {
  return prepared.map((item) => {
    const ms = durationInRange(item, range, mode, now)
    return {
      item,
      ms,
      billableMs: ms === null ? null : billableDurationMs(ms, incrementMinutes),
    }
  })
}

/**
 * Unbilled work (0006 R7).
 *
 * Billable entries with no resolved rate, surfaced as a list. "Unbilled" here means
 * *no rate resolved*, not "not marked billable" — a non-billable entry is not
 * unbilled work, it is work that was never going to be billed.
 */
export interface UnbilledEntry {
  entry: TimeEntry
  durationMs: number
  projectName: string
  clientName: string
}

export function unbilledWork(prepared: readonly ReportEntry[]): UnbilledEntry[] {
  const rows: UnbilledEntry[] = []
  for (const item of prepared) {
    if (!item.entry.billable) continue
    if (item.amountMinor !== null) continue
    if (item.durationMs === null) continue
    rows.push({
      entry: item.entry,
      durationMs: item.durationMs,
      projectName: item.project?.name ?? UNASSIGNED,
      clientName: item.client?.name ?? UNASSIGNED,
    })
  }
  return rows.sort((a, b) => b.durationMs - a.durationMs)
}

/**
 * Week over week (0006 R5).
 *
 * The current period against the immediately preceding period of equal length, with an
 * absolute and a percentage delta per group.
 *
 * A percentage change from zero renders as "new" rather than dividing by zero — the
 * spec's own rule, and the one case where a delta has no meaningful percentage.
 */
export interface DeltaGroup {
  key: string
  label: string
  currentMs: number | null
  previousMs: number | null
  /** The absolute change. Null when either side is unknown. */
  deltaMs: number | null
  /** The percentage change, or null when the previous figure was zero or unknown. */
  deltaPercent: number | null
  /** True when there was no previous figure at all, rather than a previous zero. */
  isNew: boolean
}

export function weekOverWeek(
  current: readonly ReportEntry[],
  currentDurations: readonly (number | null)[],
  previous: readonly ReportEntry[],
  previousDurations: readonly (number | null)[],
  dimension: BreakdownDimension,
): DeltaGroup[] {
  const currentGroups = new Map(
    breakdownBy(current, dimension, currentDurations).groups.map((g) => [g.key, g]),
  )
  const previousGroups = new Map(
    breakdownBy(previous, dimension, previousDurations).groups.map((g) => [g.key, g]),
  )

  const keys = new Set([...currentGroups.keys(), ...previousGroups.keys()])
  const rows: DeltaGroup[] = []

  for (const key of keys) {
    const now = currentGroups.get(key)
    const before = previousGroups.get(key)
    const currentMs = now?.totalMs ?? null
    const previousMs = before?.totalMs ?? null

    const isNew = before === undefined
    const deltaMs = currentMs === null || previousMs === null ? null : currentMs - previousMs
    const deltaPercent =
      currentMs === null || previousMs === null || previousMs === 0
        ? null
        : Math.round(((currentMs - previousMs) / previousMs) * 1000) / 10

    rows.push({
      key,
      label: now?.label ?? before?.label ?? key,
      currentMs,
      previousMs,
      deltaMs,
      deltaPercent,
      isNew,
    })
  }

  return rows.sort((a, b) => {
    if (a.currentMs === null && b.currentMs === null) return a.label.localeCompare(b.label)
    if (a.currentMs === null) return 1
    if (b.currentMs === null) return -1
    return b.currentMs - a.currentMs
  })
}

/** Sum durations, propagating an unknown rather than absorbing it. */
function sumDurations(durations: readonly (number | null)[]): number | null {
  let total = 0
  for (const duration of durations) {
    if (duration === null) return null
    total += duration
  }
  return total
}

/** A share of a total, or null when either side is unknown. */
function percentageOf(part: number | null, total: number | null): number | null {
  if (part === null || total === null || total === 0) return null
  return Math.round((part / total) * 1000) / 10
}
