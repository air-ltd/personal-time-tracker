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

import { addLocalDays, localDayBounds, mondayFirstWeekday, type WeekStart } from '../time/days'
import { contractPeriodContaining, localDateKey } from './contract'
import type { ContractPeriod } from './types'

/**
 * The expected minutes for one local day, or `null` when unknown.
 *
 * `null` means *unknown*, not zero (0013 K5). Zero contracted hours makes utilisation
 * divide by zero, and "unknown" is the truth: no contract covered that day, so there is
 * no denominator for it.
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
   * Total expected minutes, or `null` when any part of the range is unknown.
   *
   * Unknown is sticky for the range: a total that adds a known number to an unknown one
   * is itself unknown, and reporting it as the known part would understate the
   * expectation without saying so (0013 K5).
   */
  minutes: number | null
  /** Days in the range that no contract covered. */
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
    if (minutes === null) unknownDays += 1
    else {
      total += minutes
      coveredDays += 1
    }
  })

  return { minutes: unknownDays > 0 ? null : total, unknownDays, coveredDays }
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
      bucket.unknownDays += 1
      // Unknown is sticky within the week, exactly as it is within a range.
      bucket.minutes = null
    } else {
      // `coveredDays` counts every covered day, even after the week has become
      // unknown — the count is diagnostic, and a week that turned unknown halfway
      // through still covered the days before that point.
      bucket.coveredDays += 1
      if (bucket.minutes !== null) bucket.minutes += minutes
    }
    weeks.set(week, bucket)
  })

  return weeks
}

/**
 * The week a day belongs to, as a day key for that week's first day.
 *
 * Delegated to `domain/time/days.ts` so the week boundary is computed in exactly one
 * place (0013 K3).
 */
export function weekKeyFor(day: string, weekStart: WeekStart = 'monday'): string {
  const { start } = localDayBounds(day)
  const index = mondayFirstWeekday(start)
  const firstIndex = weekStart === 'sunday' ? 6 : 0
  const offset = (index - firstIndex + 7) % 7
  return localDateKey(addLocalDays(start, -offset))
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
