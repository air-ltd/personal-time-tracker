/**
 * Utilisation (0013 §Utilisation).
 *
 * The comparison the whole feature exists for: of the hours expected on a client, how
 * many were delivered.
 *
 * The two failure modes this file exists to prevent are a division by zero and a
 * silent 100%. An uncovered range is *unknown*, and unknown renders as `—` (0013
 * CP-A6). A range that is genuinely fully worked renders as 100%, and the two must not
 * look alike.
 */

import { expectedMinutes, type ExpectedHours } from './expected'
import type { ContractPeriod } from './types'

export interface Utilisation {
  /**
   * Percentage to one decimal place, or `null` when the denominator is unknown or zero.
   *
   * Derived from unrounded inputs (0013 CP-A5) and never clamped: billing more than
   * contracted hours is normal and profitable, not an error (0013 CP-A7).
   */
  percent: number | null
  /** Expected minutes in the range, or null when unknown. */
  expected: number | null
  /** Minutes actually worked against the client in the range. */
  worked: number
  /** Minutes worked minus minutes expected, or null when the expectation is unknown. */
  delta: number | null
  /** Days in the range that no contract covered. */
  unknownDays: number
}

/** Minutes worked, from a caller's own figure. */
export interface WorkedMinutes {
  /** Total worked minutes for the client in the range. */
  minutes: number
  /** Worked minutes that resolved to a billable rate, already rounded (0006 RD2). */
  billableMinutes: number
}

/**
 * Utilisation of a client's expected hours against the time worked for it.
 *
 * `worked` must already be scoped to the client: time tracked against a client-less
 * project — the leave project, for instance — belongs to no client and must not appear
 * in any client's utilisation (0013 CP2).
 */
export function utilisation(
  from: string,
  to: string,
  clientId: string,
  periods: readonly ContractPeriod[],
  worked: WorkedMinutes,
): Utilisation {
  const expected: ExpectedHours = expectedMinutes(from, to, clientId, periods)
  const available = expected.minutes

  if (available === null || available === 0) {
    return {
      percent: null,
      expected: available,
      worked: worked.minutes,
      delta: null,
      unknownDays: expected.unknownDays,
    }
  }

  return {
    percent: roundToOneDecimal((worked.minutes / available) * 100),
    expected: available,
    worked: worked.minutes,
    delta: worked.minutes - available,
    unknownDays: expected.unknownDays,
  }
}

/**
 * Billable utilisation, over the same denominator.
 *
 * The numerator is already rounded per 0006 RD2, so this is the ratio of billable
 * time to expected time — not a second rounding of the hour ratio.
 */
export function billableUtilisation(
  from: string,
  to: string,
  clientId: string,
  periods: readonly ContractPeriod[],
  worked: WorkedMinutes,
): Utilisation {
  const expected: ExpectedHours = expectedMinutes(from, to, clientId, periods)
  const available = expected.minutes

  if (available === null || available === 0) {
    return {
      percent: null,
      expected: available,
      worked: worked.billableMinutes,
      delta: null,
      unknownDays: expected.unknownDays,
    }
  }

  return {
    percent: roundToOneDecimal((worked.billableMinutes / available) * 100),
    expected: available,
    worked: worked.billableMinutes,
    delta: worked.billableMinutes - available,
    unknownDays: expected.unknownDays,
  }
}

/**
 * Render a utilisation figure.
 *
 * `—` for unknown, because that is what "no contract covers this range" means and it
 * must not be confused with zero (0013 CP-A6). The em dash is the character the spec
 * names, not a placeholder chosen for looks.
 */
export function formatUtilisation(percent: number | null): string {
  if (percent === null) return '—'
  return `${percent.toFixed(1)}%`
}

/**
 * Round to one decimal place, half away from zero.
 *
 * `toFixed` is used rather than a hand-rolled rounding, because the hand-rolled ones
 * are where 62.05 becomes 62.0 instead of 62.1. `toFixed` on a number that is already
 * close to a tenth is exact enough for a displayed percentage, and the value is derived
 * from unrounded inputs either way (0013 CP-A5).
 */
function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}
