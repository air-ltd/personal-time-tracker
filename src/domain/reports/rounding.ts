/**
 * Billable rounding (0006 RD1–RD5).
 *
 * The rounding policy is one setting applied to every billable figure (0006 RD3), and
 * the increment is stored rather than hard-coded so that exposing a control for it later
 * is a UI change and not a migration (0006 RD2.1).
 *
 * The order of operations is the load-bearing part (0006 RD4): round the duration to
 * the increment, and *only then* multiply by the rate. Rounding after the multiplication
 * is what makes an invoice's line items stop summing to its total, and the invoice
 * total has to equal the sum of its lines (0006 I2).
 */

/** The default increment, in minutes (0006 RD2). */
export const DEFAULT_INCREMENT_MINUTES = 15

/**
 * Round a duration to the nearest whole increment, half up.
 *
 * Half up rather than half to even, because 22.5 minutes of billable time is 23 to
 * somebody checking an invoice by hand, and "even" would make the same 22.5 round
 * differently depending on which row it was — 22.5 to 22, 37.5 to 38 — which reads as
 * an error even when it is not (0006 RD4).
 *
 * Returns milliseconds. Integer arithmetic throughout: the increment is a whole number
 * of minutes, so the result is a whole number of minutes too.
 */
export function roundDurationToIncrement(ms: number, incrementMinutes: number): number {
  if (incrementMinutes <= 0) return ms
  const incrementMs = incrementMinutes * 60_000
  return Math.round(ms / incrementMs) * incrementMs
}

/**
 * The billable duration of an entry, in milliseconds.
 *
 * This is the value a rate is multiplied by (0006 RD4). It is *not* stored: rounding is
 * applied at the edge of a report, never to stored data, so changing the increment
 * changes the figures computed from the entries and nothing else (0006 RD2.2).
 */
export function billableDurationMs(ms: number, incrementMinutes: number): number {
  return roundDurationToIncrement(ms, incrementMinutes)
}

/**
 * The monetary value of a duration, in minor units.
 *
 * The duration is rounded *before* the multiplication, which is what makes an invoice's
 * lines sum to its total (0006 RD4, I2). Doing it the other way round — multiplying
 * first and rounding the money — produces lines that do not reconcile, and that is
 * the failure 0014's silent-failure list names.
 */
export function billableAmountMinor(
  ms: number,
  incrementMinutes: number,
  rateMinorPerHour: number,
): number {
  const roundedMs = billableDurationMs(ms, incrementMinutes)
  // Milliseconds to hours, as a fraction. The rate is per hour, so the duration has to
  // be converted before the multiplication, and the conversion has to keep its
  // fraction: 1,800,000 ms is exactly 0.5 hours, and `1800000 / 3600000` is 0.5
  // exactly in binary floating point, so this does not drift.
  return Math.round((roundedMs / 3_600_000) * rateMinorPerHour)
}

/**
 * Whether a rounded duration differs from the raw one, and by how much.
 *
 * The app must show both where they differ (0006 RD5): a billable figure that quietly
 * differs from the time actually worked is the kind of number that makes an invoice
 * look wrong, and the only way to settle it is to see both.
 */
export interface RoundingDifference {
  rawMs: number
  roundedMs: number
  /** True when rounding changed the duration. */
  differs: boolean
}

export function roundingDifference(ms: number, incrementMinutes: number): RoundingDifference {
  const roundedMs = billableDurationMs(ms, incrementMinutes)
  return { rawMs: ms, roundedMs, differs: roundedMs !== ms }
}
