/**
 * Contract period rules (0003 CT1–CT9, 0013 K1–K9).
 *
 * All of it is pure: no clock reads, no storage access, no `Date.now()` (0002 A2). The
 * `now` a caller needs is passed in, which is what makes a rule about "today" testable
 * by pinning the instant rather than by waiting for it.
 *
 * The validation exists because the alternative is a number that looks right and is
 * wrong: a work pattern that does not sum to `minutesPerWeek` makes every expected-hours
 * figure disagree with the contract it came from, and there is no way for the user to
 * tell which of the two is authoritative.
 */

import type { ContractPeriod, DayPattern } from './types'

/** The outcome of a validation. `ok: false` carries a reason the UI can show. */
export type ValidationResult =
  { ok: true } | { ok: false; reason: string; code: ValidationCode }

export type ValidationCode =
  | 'client-required'
  | 'no-working-days'
  | 'pattern-incomplete'
  | 'pattern-sum-mismatch'
  | 'pattern-out-of-range'
  | 'date-range-invalid'
  | 'overlaps-existing'

/** Days in a week, Monday-first. 0003 CT2 requires exactly this many pattern entries. */
export const WEEKDAYS = 7

/**
 * Validate a contract period against the periods already stored for its client.
 *
 * `existing` MUST be every other period for the same client, including tombstones —
 * a deleted period still occupied its dates, and ignoring it would let a new period
 * be created inside a range that a live copy on another device still covers.
 */
export function validateContractPeriod(
  period: Pick<
    ContractPeriod,
    'clientId' | 'effectiveFrom' | 'effectiveTo' | 'minutesPerWeek' | 'workPattern'
  >,
  existing: readonly ContractPeriod[],
): ValidationResult {
  if (period.clientId.trim() === '') {
    return { ok: false, code: 'client-required', reason: 'A contract must name a client.' }
  }

  if (!isIsoDate(period.effectiveFrom)) {
    return {
      ok: false,
      code: 'date-range-invalid',
      reason: 'The start date is not a valid date.',
    }
  }
  if (period.effectiveTo !== null && !isIsoDate(period.effectiveTo)) {
    return {
      ok: false,
      code: 'date-range-invalid',
      reason: 'The end date is not a valid date.',
    }
  }
  if (period.effectiveTo !== null && period.effectiveTo < period.effectiveFrom) {
    return {
      ok: false,
      code: 'date-range-invalid',
      reason: 'The contract ends before it starts.',
    }
  }

  if (!Number.isInteger(period.minutesPerWeek) || period.minutesPerWeek < 0) {
    return {
      ok: false,
      code: 'pattern-out-of-range',
      reason: 'Weekly minutes must be a whole number, zero or more.',
    }
  }

  const pattern = validatePattern(period.workPattern, period.minutesPerWeek)
  if (!pattern.ok) return pattern

  if (pattern.minutes === 0) {
    return {
      ok: false,
      code: 'no-working-days',
      reason: 'A contract must have at least one working day.',
    }
  }

  // Overlap is judged within a scope: two different clients may each hold an
  // open-ended period without either conflicting, because neither speaks for the
  // other's hours (0003 CT1, 0013 K4).
  const conflict = existing.find(
    (other) => other.clientId === period.clientId && overlaps(period, other),
  )
  if (conflict) {
    return {
      ok: false,
      code: 'overlaps-existing',
      reason:
        'This contract overlaps one already set for this client. Close the current one ' +
        'before opening a new one.',
    }
  }

  return { ok: true }
}

/**
 * Validate a work pattern on its own (0003 CT2–CT5).
 *
 * The sum check is the load-bearing one: the pattern is the stored form, and
 * `minutesPerWeek` is what the user typed. If they disagree the app cannot know which
 * is authoritative, so it refuses rather than quietly preferring one (0003 CT3).
 */
export function validatePattern(
  pattern: readonly DayPattern[],
  minutesPerWeek: number,
): ValidationResult & { minutes?: number } {
  if (pattern.length !== WEEKDAYS) {
    return {
      ok: false,
      code: 'pattern-incomplete',
      reason: 'A contract must cover all seven weekdays.',
    }
  }

  const seen = new Set<number>()
  let total = 0
  for (const entry of pattern) {
    if (!Number.isInteger(entry.weekday) || entry.weekday < 0 || entry.weekday >= WEEKDAYS) {
      return {
        ok: false,
        code: 'pattern-out-of-range',
        reason: 'A weekday must be between 0 (Monday) and 6 (Sunday).',
      }
    }
    if (seen.has(entry.weekday)) {
      return {
        ok: false,
        code: 'pattern-incomplete',
        reason: 'A weekday appears twice in the pattern.',
      }
    }
    seen.add(entry.weekday)

    if (!Number.isInteger(entry.minutes) || entry.minutes < 0 || entry.minutes > 1440) {
      return {
        ok: false,
        code: 'pattern-out-of-range',
        reason: 'Contracted minutes for a day must be between 0 and 1440.',
      }
    }
    total += entry.minutes
  }

  if (total !== minutesPerWeek) {
    return {
      ok: false,
      code: 'pattern-sum-mismatch',
      reason: `The days add up to ${total} minutes, but the week is set to ${minutesPerWeek}.`,
    }
  }

  return { ok: true, minutes: total }
}

/**
 * The even-split form shortcut (0003 CT7).
 *
 * Returns `null` when the week does not divide evenly, rather than a rounded figure:
 * 2,250 minutes over four days is 562.5, and rounding it would make the pattern stop
 * summing to `minutesPerWeek`, which is exactly the mismatch CT3 forbids (0003 CT8).
 * The caller must prompt for per-day overrides or explain that the split is uneven.
 */
export function evenSplitPattern(
  minutesPerWeek: number,
  workingDays: readonly number[],
): DayPattern[] | null {
  if (workingDays.length === 0) return null
  if (minutesPerWeek % workingDays.length !== 0) return null

  const perDay = minutesPerWeek / workingDays.length
  const pattern: DayPattern[] = []
  for (let weekday = 0; weekday < WEEKDAYS; weekday++) {
    const working = workingDays.includes(weekday)
    pattern.push({ weekday, minutes: working ? perDay : 0 })
  }
  return pattern
}

/**
 * The contract period covering a given day, for one client.
 *
 * Ranges are inclusive at both ends, so two periods that meet on the same date overlap
 * and are refused (0003 CT1). Open-ended means "until the end of time" (0003 CT1).
 */
export function contractPeriodContaining(
  periods: readonly ContractPeriod[],
  clientId: string,
  day: string,
): ContractPeriod | null {
  let found: ContractPeriod | null = null
  for (const period of periods) {
    if (period.clientId !== clientId) continue
    if (period.deletedAt !== null) continue
    if (
      period.effectiveFrom <= day &&
      (period.effectiveTo === null || day <= period.effectiveTo)
    ) {
      found = period
      break
    }
  }
  return found
}

/** Whether two periods for the same client overlap. */
export function overlaps(
  a: Pick<ContractPeriod, 'effectiveFrom' | 'effectiveTo'>,
  b: Pick<ContractPeriod, 'effectiveFrom' | 'effectiveTo'>,
): boolean {
  const aEnd = a.effectiveTo ?? '9999-12-31'
  const bEnd = b.effectiveTo ?? '9999-12-31'
  return a.effectiveFrom <= bEnd && b.effectiveFrom <= aEnd
}

/** The contract period in force on a given day for a client, or null (0013 K5). */
export function currentContractPeriod(
  periods: readonly ContractPeriod[],
  clientId: string,
  now: Date,
): ContractPeriod | null {
  return contractPeriodContaining(periods, clientId, localDateKey(now))
}

/** `YYYY-MM-DD` for the local calendar day, which is what a contract's dates use. */
export function localDateKey(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  // Reject dates that only exist because the month was too short, e.g. 2026-02-30.
  const parsed = new Date(year, month - 1, day)
  return (
    parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
  )
}
