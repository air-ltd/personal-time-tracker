/**
 * Expected hours (0013 §Capacity computation).
 *
 * All derived, all at read time (0013 CP1). Every function here takes dates and data as
 * parameters — no clock reads, no storage access (0002 A2).
 *
 * The per-day loop is the whole point. Expected hours cannot be computed as
 * `range × minutesPerWeek / 7`, because the work pattern is not uniform across the
 * week: a 37.5-hour week of Mon–Thu 480 / Fri 300 is 2,250 minutes, and dividing that
 * by seven is wrong for every individual day (0013 CP-A1, K2).
 */

import {
  addLocalDays,
  localDayBounds,
  localWeekBounds,
  mondayFirstWeekday,
  type WeekStart,
} from '../time/days'
import { contractPeriodContaining, localDateKey } from './contract'
import type { ContractPeriod } from './types'

/**
 * The expected minutes for one local day, or `null` when no contract covered it.
 *
 * `null` means *not specified*, not zero. The distinction is kept at the day level
 * because it is worth knowing — a day the contract says nothing about is a different
 * fact from a day the contract says is zero hours — but it does not poison a total.
 *
 * See `expectedMinutes` for what happens when the two are added up.
 */
export function expectedMinutesForDay(
  periods: readonly ContractPeriod[],
  clientId: string,
  day: string,
): number | null {
  const period = contractPeriodContaining(periods, clientId, day)
  if (period === null) return null

  const weekday = mondayFirstWeekday(localDayBounds(day).start)
  const entry = period.workPattern.find((candidate) => candidate.weekday === weekday)
  // A pattern covering all seven weekdays always has an entry (0003 CT2), but a period
  // that arrived from an import may not. An absent day is unknown rather than zero.
  return entry?.minutes ?? null
}

export interface ExpectedHours {
  /**
   * Total expected minutes over the range.
   *
   * **A day no contract covered counts as zero.** It used to make the whole total
   * unknown, which meant a report over a period the contract only partly covered
   * could not be added up or compared with anything — the figure was a dash, and a
   * dash next to a total is a number about a different thing.
   *
   * Summing is the point: a report that cannot be summed cannot be read. The days
   * that were not covered are still counted in `unknownDays`, so the report can say
   * how much of the period the contract had an opinion about.
   */
  minutes: number
  /** Days in the range that no contract covered, and which therefore counted as zero. */
  unknownDays: number
  /** Days in the range that a contract covered. */
  coveredDays: number
}

/**
 * Expected minutes over an inclusive range of local calendar days.
 *
 * The range is given as `YYYY-MM-DD` day keys, because that is what a contract's
 * effective dates are, and mixing a key with a `Date` invites a timezone bug at the
 * boundary (0006 DT7).
 */
export function expectedMinutes(
  from: string,
  to: string,
  clientId: string,
  periods: readonly ContractPeriod[],
): ExpectedHours {
  let total = 0
  let unknownDays = 0
  let coveredDays = 0

  forEachDayKey(from, to, (day) => {
    const minutes = expectedMinutesForDay(periods, clientId, day)
    if (minutes === null) {
      // No contract covered this day, so no hours are expected for it. Zero, and the
      // day is counted so the report can say how much of the period was like this.
      unknownDays += 1
      return
    }
    total += minutes
    coveredDays += 1
  })

  return { minutes: total, unknownDays, coveredDays }
}

/**
 * Expected minutes grouped by the week each day falls in.
 *
 * A range total is not enough for a per-week report (0013 CR2), and the week boundary
 * depends on the user's setting (0006 DR3), so the grouping is done here rather than
 * left to the caller — a second implementation of "which week is this day in" is a
 * second chance to disagree with the first (0013 K3).
 */
export function expectedMinutesByWeek(
  from: string,
  to: string,
  clientId: string,
  periods: readonly ContractPeriod[],
  weekStart: WeekStart = 'monday',
): Map<string, ExpectedHours> {
  const weeks = new Map<string, ExpectedHours>()

  forEachDayKey(from, to, (day) => {
    const week = weekKeyFor(day, weekStart)
    const bucket = weeks.get(week) ?? { minutes: 0, unknownDays: 0, coveredDays: 0 }
    const minutes = expectedMinutesForDay(periods, clientId, day)
    if (minutes === null) {
      // No contract covered this day, so no hours are expected for it. Zero, and the
      // day is counted so the report can say how much of the week was like this.
      bucket.unknownDays += 1
    } else {
      bucket.minutes += minutes
      bucket.coveredDays += 1
    }
    weeks.set(week, bucket)
  })

  return weeks
}

/**
 * The week a day belongs to, as a day key for that week's first day.
 *
 * Delegated to `domain/time/days.ts` so the week boundary is computed in exactly one
 * place (0013 K3). A second copy of the Monday-first conversion here would be a
 * second chance to disagree with the first — and the two would disagree the moment
 * the week start setting changed.
 */
export function weekKeyFor(day: string, weekStart: WeekStart = 'monday'): string {
  const { start } = localWeekBounds(day, weekStart)
  return localDateKey(start)
}

/**
 * The time tracked, grouped by the week it falls in.
 *
 * The counterpart to `expectedMinutesByWeek`, and the reason the two are paired: a
 * week that shows what was expected and nothing about what was done reads as a total,
 * and a total next to the period's totals is a number about a different thing.
 *
 * An entry that runs across a week boundary is split between the weeks it touches, so
 * the weeks add up to the period's total.
 */
export function trackedMinutesByWeek(
  entries: readonly { startMs: number; endMs: number }[],
  from: string,
  to: string,
  weekStart: WeekStart = 'monday',
): Map<string, number> {
  const weeks = new Map<string, number>()

  forEachDayKey(from, to, (day) => {
    const week = weekKeyFor(day, weekStart)
    weeks.set(week, weeks.get(week) ?? 0)
  })

  for (const entry of entries) {
    forEachDayKey(from, to, (day) => {
      const { start, end } = localDayBounds(day)
      const from_ = Math.max(entry.startMs, start.getTime())
      const to_ = Math.min(entry.endMs, end.getTime())
      if (to_ <= from_) return
      const week = weekKeyFor(day, weekStart)
      weeks.set(week, (weeks.get(week) ?? 0) + (to_ - from_) / 60_000)
    })
  }

  return weeks
}

/**
 * Call `visit` for every local day key from `from` to `to`, inclusive of both ends.
 *
 * Inclusive at both ends because a contract's dates are inclusive (0003 §ContractPeriod)
 * and a range that quietly dropped its last day would understate every figure it
 * produced.
 */
export function forEachDayKey(from: string, to: string, visit: (day: string) => void): void {
  if (from > to) return
  let current = localDayBounds(from).start
  const last = localDayBounds(to).start
  while (current.getTime() <= last.getTime()) {
    visit(localDateKey(current))
    current = addLocalDays(current, 1)
  }
}
