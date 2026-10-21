/**
 * Date ranges for reports (0006 DR1–DR5).
 *
 * "Week" and "month" are calendar-based in the browser's local zone, not rolling
 * windows (0006 DR2). A rolling seven days and the calendar week containing today
 * differ by up to six days, and a report that silently switches between the two
 * depending on when it is opened is a report nobody trusts.
 *
 * The week starts on the day the user chose, defaulting to Monday (0006 DR3, DT8), and
 * the week boundary itself is computed in exactly one place — `domain/time/days.ts` —
 * so this module asks for it rather than re-deriving it (0013 K3).
 */

import {
  addLocalDays,
  dayKey,
  localDayBounds,
  localWeekBounds,
  startOfLocalDay,
} from '../time/days'
import type { WeekStart } from '../time/days'

export type RangePreset =
  | 'today'
  | 'yesterday'
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month'
  | 'last-30-days'
  | 'last-90-days'
  | 'all-time'
  | 'custom'

export const RANGE_PRESETS: readonly RangePreset[] = [
  'today',
  'yesterday',
  'this-week',
  'last-week',
  'this-month',
  'last-month',
  'last-30-days',
  'last-90-days',
  'all-time',
  'custom',
]

export const RANGE_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  'this-week': 'This week',
  'last-week': 'Last week',
  'this-month': 'This month',
  'last-month': 'Last month',
  'last-30-days': 'Last 30 days',
  'last-90-days': 'Last 90 days',
  'all-time': 'All time',
  custom: 'Custom range',
}

/**
 * An inclusive range of local calendar days.
 *
 * Inclusive at both ends, because a custom range the user picked from the 1st to the
 * 31st must include the 31st, and a range that dropped its last day would understate
 * every figure it produced (0006 DR4).
 */
export interface DateRange {
  /** Local calendar date, inclusive. */
  from: string
  /** Local calendar date, inclusive. */
  to: string
}

/**
 * How an entry is counted against a range (0006 DR5).
 *
 * The two are genuinely different questions. "How much time did I work in this week"
 * clips an entry that straddles the boundary; "which entries touched this week" counts
 * the whole entry even if most of it fell outside. The default is `clipped`, because
 * a total that includes time from outside the range is not a total of the range.
 */
export type RangeMode = 'clipped' | 'overlap'

export const RANGE_MODE_LABELS: Record<RangeMode, string> = {
  clipped: 'Time within the range',
  overlap: 'Entries overlapping the range',
}

/**
 * The range a preset names, as of `now`.
 *
 * `all-time` has no end: it is the one preset whose "to" is not a date, so it is
 * represented by an empty `to` rather than by a far-future date, which would make
 * every day in the range iterate for a hundred years.
 */
export interface ResolvedRange {
  preset: RangePreset
  /** Local calendar date, inclusive. */
  from: string
  /** Local calendar date, inclusive. Null for `all-time`, meaning "no upper bound". */
  to: string | null
}

/**
 * Resolve a preset to a concrete range.
 *
 * `all-time` is not really a range — it is the absence of one — so it is handled by
 * the caller rather than here, and this function returns null for it.
 */
export function resolveRange(
  preset: RangePreset,
  now: Date,
  weekStart: WeekStart = 'monday',
  custom?: DateRange,
): ResolvedRange | null {
  const today = startOfLocalDay(now)
  const key = dayKey(today)

  switch (preset) {
    case 'today':
      return { preset, from: key, to: key }

    case 'yesterday': {
      const yesterday = dayKey(addLocalDays(today, -1))
      return { preset, from: yesterday, to: yesterday }
    }

    case 'this-week':
    case 'last-week': {
      const week = weekBounds(today, weekStart)
      const offset = preset === 'this-week' ? 0 : -7
      return {
        preset,
        from: dayKey(addLocalDays(week, offset)),
        to: dayKey(addLocalDays(week, offset + 6)),
      }
    }

    case 'this-month': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1)
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      return { preset, from: dayKey(first), to: dayKey(last) }
    }

    case 'last-month': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const last = new Date(today.getFullYear(), today.getMonth(), 0)
      return { preset, from: dayKey(first), to: dayKey(last) }
    }

    case 'last-30-days':
      return { preset, from: dayKey(addLocalDays(today, -29)), to: key }

    case 'last-90-days':
      return { preset, from: dayKey(addLocalDays(today, -89)), to: key }

    case 'all-time':
      return null

    case 'custom':
      return custom ? { preset, from: custom.from, to: custom.to } : null
  }
}

/**
 * The first day of the week containing `day`.
 *
 * Delegates to the one place a week boundary is computed (0006 DT8, 0013 K3). A second
 * copy of the Monday-first conversion here would be a second chance to be off by one.
 */
export function weekBounds(day: Date, weekStart: WeekStart = 'monday'): Date {
  const { start } = localWeekBounds(dayKey(day), weekStart)
  return start
}

/**
 * The range immediately before this one, of the same length (0006 R5).
 *
 * "The immediately preceding period of equal length" — so a custom range compares
 * against the same number of days immediately before it, and not against a calendar
 * month that happens to precede it.
 */
export function precedingRange(range: DateRange): DateRange | null {
  const from = localDayBounds(range.from).start
  const to = localDayBounds(range.to).start
  if (to.getTime() < from.getTime()) return null

  // Counted by stepping day by day rather than by dividing the millisecond span by
  // 86,400,000. A local day is not always 86,400,000 ms — a range spanning a DST
  // transition is a day shorter or longer in milliseconds than it is in days — and
  // dividing would give the previous range the wrong number of days.
  let days = 0
  for (let cursor = from; cursor.getTime() <= to.getTime(); cursor = addLocalDays(cursor, 1)) {
    days += 1
  }
  if (days <= 0) return null
  return {
    from: dayKey(addLocalDays(from, -days)),
    to: dayKey(addLocalDays(from, -1)),
  }
}
