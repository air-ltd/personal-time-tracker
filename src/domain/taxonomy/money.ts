import type { Client, Project } from './types'

/**
 * Rate and currency resolution (0003, 0005 P5–P8).
 *
 * Both are ordered lookups where the order *is* the rule, so they are written out
 * explicitly rather than collapsed into a generic "first non-null" helper. A reader
 * should be able to check the chain against the spec without simulating it.
 *
 * Currency conversion is a non-goal (0003 CU3): no rates are fetched or stored, and a
 * user billing in two currencies sees two figures. That is the honest answer without a
 * rate source, and it is why the resolved currency is carried alongside every amount
 * rather than assumed.
 */

/** What an entry resolves to for money, given its project and client. */
export interface MoneyContext {
  /** The entry's own override, which always wins (0003 rate resolution). */
  rateOverrideMinor: number | null
  project: Project | null
  client: Client | null
}

/**
 * Hourly rate in minor units, or null when nothing applies.
 *
 * Order: entry override, then project, then the project's client. Null at the end means
 * the entry still contributes billable hours but has no monetary value, which is a
 * legitimate state rather than a missing one.
 */
export function resolveRateMinor(context: MoneyContext): number | null {
  if (context.rateOverrideMinor !== null) return context.rateOverrideMinor
  if (context.project?.defaultRateMinor != null) return context.project.defaultRateMinor
  if (context.client?.defaultRateMinor != null) return context.client.defaultRateMinor
  return null
}

/** Whether new entries for this project should default to billable (0005 P5). */
export function projectDefaultsToBillable(project: Project | null): boolean {
  return project?.defaultRateMinor != null
}

/** Where a resolved currency came from, so the UI can explain it. */
export type CurrencySource = 'project' | 'client' | 'app-default' | 'fallback'

export interface CurrencyResolution {
  code: string
  source: CurrencySource
}

/** The last resort when nothing is configured anywhere (0003 currency resolution). */
export const FALLBACK_CURRENCY = 'USD'

/**
 * Resolve a currency.
 *
 * Order: project override, then client, then the app-wide default, then USD. The source
 * is returned alongside the code because a project overriding its client is the case
 * 0005 P6 exists for, and it is invisible without being told.
 *
 * The parameters are narrowed to the one field this function reads. That is not
 * convenience: three call sites have a currency but no record yet — a project form
 * mid-edit, a client picker before the row exists — and typing them as `Project` and
 * `Client` would force each of those to either cast or, worse, reimplement the chain
 * with a different fallback. The narrowing is what keeps `resolveCurrency` the only
 * place the order is written down.
 */
export function resolveCurrency(
  project: { currency: string | null } | null,
  client: { currency: string | null } | null,
  appDefault: string | null,
): CurrencyResolution {
  if (project?.currency) return { code: project.currency, source: 'project' }
  if (client?.currency) return { code: client.currency, source: 'client' }
  if (appDefault) return { code: appDefault, source: 'app-default' }
  return { code: FALLBACK_CURRENCY, source: 'fallback' }
}

/**
 * Split amounts by currency.
 *
 * 0003 CU2 forbids totalling across currencies: GBP plus JPY is not a number. Grouping
 * first is what makes that impossible to do by accident downstream.
 */
export function groupByCurrency(
  amounts: readonly { currency: string; minor: number }[],
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const amount of amounts) {
    totals.set(amount.currency, (totals.get(amount.currency) ?? 0) + amount.minor)
  }
  return totals
}

/**
 * Minor units per major unit, for display.
 *
 * Most currencies have two decimals, but not all: JPY has none and KWD has three.
 * Getting this wrong misreports every amount in that currency by a factor of ten or a
 * hundred, so it is a table rather than an assumption (0003 CU1).
 */
const MINOR_UNIT_EXPONENTS: Record<string, number> = {
  BHD: 3,
  CLP: 0,
  JOD: 3,
  JPY: 0,
  KWD: 3,
  OMR: 3,
  TND: 3,
}

export function minorUnitExponent(currency: string): number {
  return MINOR_UNIT_EXPONENTS[currency.toUpperCase()] ?? 2
}
