import { minorUnitExponent } from './money'

/**
 * Currency presentation and money conversion (0003 CU1, CU5; 0005 P7).
 *
 * The list of currencies comes from the runtime's own CLDR data via
 * `Intl.supportedValuesOf('currency')`, and the names come from `Intl.DisplayNames`.
 * That is deliberate rather than a hardcoded table: a hand-typed list of ISO 4217
 * codes is a claim nobody checks, and it goes stale silently as currencies are added,
 * renamed and withdrawn. Asking the runtime means the picker offers exactly what this
 * browser can actually format, and the names read as currencies rather than as codes.
 *
 * The obvious objection is that this file's own argument condemns `money.ts`'s
 * `MINOR_UNIT_EXPONENTS`, which *is* a hand-typed ISO table. It is the one exception, and
 * it is unavoidable rather than inconsistent: no `Intl` API reports how many minor units
 * a currency has, so JPY having none and KWD having three cannot be asked for at runtime.
 * It is small, it is pinned by a test, and getting it wrong misreports every amount in that
 * currency by a factor of ten or a hundred.
 *
 * Both Intl APIs are read through narrow wrappers with fallbacks, because a missing
 * `Intl.supportedValuesOf` must degrade to a usable single-currency picker rather than
 * throw on a settings page.
 */

export interface CurrencyOption {
  code: string
  /** Display name, e.g. "British Pound". Never the bare code where a name exists. */
  name: string
  /** What the select shows: "GBP — British Pound" (0005 P7). */
  label: string
}

/**
 * Minimal fallback for a runtime without `Intl.supportedValuesOf`.
 *
 * Chosen as currencies in common use rather than an attempt at the full list, because
 * a short list of real codes is useful and an invented long list would not be. Anything
 * stored that is absent here still resolves for display — only the picker's options are
 * reduced.
 */
const FALLBACK_CODES = [
  'AUD',
  'CAD',
  'CHF',
  'EUR',
  'GBP',
  'HKD',
  'INR',
  'JPY',
  'NZD',
  'SEK',
  'SGD',
  'USD',
  'ZAR',
]

function supportedCodes(): string[] {
  // Presence checked rather than assumed: this is a browser app, and an older engine
  // reaching Phase 4 should still work with fewer currencies listed.
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[]
  }
  const codes = intl.supportedValuesOf?.('currency')
  return codes && codes.length > 0 ? codes : FALLBACK_CODES
}

/** Every currency code this runtime can format, uppercase and deduplicated. */
export const CURRENCY_CODES: readonly string[] = Object.freeze(
  [...new Set(supportedCodes().map((code) => code.toUpperCase()))].sort(),
)

let displayNames: Intl.DisplayNames | null = null

function names(): Intl.DisplayNames | null {
  if (displayNames) return displayNames
  const ctor = (Intl as typeof Intl & { DisplayNames?: typeof Intl.DisplayNames }).DisplayNames
  if (!ctor) return null
  try {
    displayNames = new ctor(['en'], { type: 'currency' })
    return displayNames
  } catch {
    // Some engines accept `type: 'currency'` only partially and throw on construction.
    // A picker of bare codes still works; the spec asks for names, so this is
    // recorded as a fallback rather than treated as equivalent.
    return null
  }
}

/**
 * The currency's display name, or the code when the runtime cannot supply one.
 *
 * Never throws for an unknown code: a code restored from a backup on an older browser
 * still has to display, and the code alone is meaningful.
 */
export function currencyName(code: string): string {
  const upper = code.toUpperCase()
  try {
    const name = names()?.of(upper)
    // CLDR returns the input unchanged for codes it does not recognise.
    if (name && name !== upper) return name
  } catch {
    // Fall through to the code.
  }
  return upper
}

export function currencyLabel(code: string): string {
  const upper = code.toUpperCase()
  const name = currencyName(upper)
  return name === upper ? upper : `${upper} — ${name}`
}

/**
 * Select options, sorted by currency name.
 *
 * Sorted by name rather than by code because 0005 P7 asks for the picker to be
 * navigable without knowing codes: "Pound Sterling" has to be findable, and a code
 * ordering puts every Pound at G. Codes are kept in the label so a user who does know
 * one can match it.
 */
export function currencyOptions(): CurrencyOption[] {
  return CURRENCY_CODES.map((code) => ({
    code,
    name: currencyName(code),
    label: currencyLabel(code),
  })).sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))
}

/** Whether a code is one this app will offer. Unknown codes still display. */
export function isKnownCurrency(code: string): boolean {
  return CURRENCY_CODES.includes(code.trim().toUpperCase())
}

/**
 * Format an amount held in minor units (0003 CU1, CU5).
 *
 * The exponent comes from the currency rather than being assumed to be 2, because JPY
 * has no minor unit and KWD has three: dividing both by 100 misreports every amount by
 * a factor of a hundred or ten. `Intl.NumberFormat` does the formatting, so symbol
 * placement and separators follow the browser's locale (CU5).
 */
export function formatMinor(minor: number, code: string): string {
  const exponent = minorUnitExponent(code)
  const amount = minor / 10 ** exponent
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code.toUpperCase(),
      // Forced to the currency's own exponent rather than inferred, so KWD shows three
      // decimals and JPY none even when the value happens to be short.
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(amount)
  } catch {
    // An unrecognised code makes `Intl.NumberFormat` throw. A rate display must not be
    // able to take down the settings page, so fall back to the code and the raw amount.
    return `${code.toUpperCase()} ${amount.toFixed(exponent)}`
  }
}

/** An amount in minor units with no currency formatting, for number inputs. */
export function minorToMajorString(minor: number, code: string): string {
  const exponent = minorUnitExponent(code)
  return (minor / 10 ** exponent).toFixed(exponent)
}

/**
 * Parse a typed major-unit amount into minor units.
 *
 * Returns null when the text is not a number, so a caller can reject it rather than
 * silently storing zero — which would look like a real rate of nothing.
 *
 * Separator handling is the fiddly part, and the currency's own exponent is what
 * settles it: "1,250" in USD is one thousand two hundred fifty, but in JPY the same
 * text is a malformed amount because JPY has no minor unit. Guessing by "last
 * separator is decimal" gets both wrong.
 */
export function majorStringToMinor(value: string, code: string): number | null {
  const exponent = minorUnitExponent(code)

  // Strip everything that cannot be part of a number: currency symbols, ISO codes,
  // spaces including non-breaking and narrow no-break, and apostrophe grouping.
  const cleaned = value.replace(/[^\d.,\-+]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '+') return null

  const negative = cleaned.startsWith('-')
  const digitsOnly = cleaned.replace(/^\+/, '').replace(/-/g, '')

  const lastDot = digitsOnly.lastIndexOf('.')
  const lastComma = digitsOnly.lastIndexOf(',')
  let decimalAt = -1

  if (lastDot !== -1 && lastComma !== -1) {
    // Both present: the rightmost is the decimal separator, the other groups digits.
    decimalAt = Math.max(lastDot, lastComma)
  } else {
    const only = Math.max(lastDot, lastComma)
    if (only !== -1) {
      const occurrences = digitsOnly.split(digitsOnly[only] as string).length - 1
      const after = digitsOnly.length - only - 1
      /*
       * More than one separator can only be grouping.
       *
       * A single one is a decimal point when the digits after it fit the currency's
       * minor unit — or when they cannot be a group at all, since grouping is always in
       * threes. The second clause is what reads "10.5" as ten and a half in yen: JPY
       * has no minor unit so the exponent cannot decide it, but "5" is not a group of
       * three, so it is not grouping either.
       */
      const looksGrouped = after !== 0 && after % 3 === 0
      decimalAt = occurrences === 1 && (after <= exponent || !looksGrouped) ? only : -1
    }
  }

  let whole = digitsOnly
  let fraction = ''
  if (decimalAt !== -1) {
    whole = digitsOnly.slice(0, decimalAt)
    fraction = digitsOnly.slice(decimalAt + 1)
  }
  const grouping = whole.replace(/[.,]/g, '')
  if (grouping === '' && fraction === '') return null

  // More precision than the currency has is rounded, half-up, rather than rejected:
  // typing 10.50 for a zero-decimal currency is a reasonable thing to do, and refusing
  // it helps nobody. Integer arithmetic below keeps the rounding exact.
  // `|| '0'` rather than a plain parseInt: for a zero-decimal currency the kept
  // fraction is the empty string, and `parseInt('')` is NaN — which would turn every
  // JPY amount into NaN and then into a stored null.
  const padded = (fraction + '0'.repeat(exponent)).slice(0, exponent)
  const keptMinor = Number.parseInt(padded || '0', 10)
  const nextDigit = Number.parseInt(fraction[exponent] ?? '0', 10)
  const roundedMinor = keptMinor + (nextDigit >= 5 ? 1 : 0)

  const scaledWhole = Number.parseInt(grouping === '' ? '0' : grouping, 10) * 10 ** exponent
  const total = scaledWhole + roundedMinor
  return negative ? -total : total
}

/**
 * Parse a rate the user typed, in major units per hour.
 *
 * Non-negative because 0003 E5 requires `rateOverrideMinor` to be non-negative, and a
 * negative rate is a billing error rather than a figure anyone means.
 */
export function parseRateMinor(value: string, code: string): number | null {
  const minor = majorStringToMinor(value, code)
  if (minor === null || minor < 0) return null
  return minor
}
