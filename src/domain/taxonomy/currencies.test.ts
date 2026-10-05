import { describe, expect, it } from 'vitest'
import {
  CURRENCY_CODES,
  currencyLabel,
  currencyName,
  currencyOptions,
  formatMinor,
  isKnownCurrency,
  majorStringToMinor,
  minorToMajorString,
  parseRateMinor,
} from './currencies'
import { minorUnitExponent } from './money'

/**
 * Currency presentation and conversion (0003 CU1, CU5; 0005 P7).
 *
 * The separator tests carry the weight here. "1,250" means one thousand two hundred
 * fifty dollars and is a malformed amount in yen, so no amount of "be liberal in what
 * you accept" gets a single answer — the currency's exponent has to settle it. Getting
 * that wrong understates a rate by a factor of a thousand, which is the kind of error
 * that survives review because the number still looks like a number.
 */

describe('currency list', () => {
  it('offers real ISO 4217 codes from the runtime', () => {
    // Not a hardcoded list, so the assertion is membership rather than a length: the
    // runtime decides which currencies it can format.
    for (const code of ['GBP', 'USD', 'EUR', 'JPY', 'KWD']) {
      expect(CURRENCY_CODES).toContain(code)
    }
  })

  it('presents each currency by name rather than by code (0005 P7)', () => {
    const name = currencyName('GBP')
    expect(name).not.toBe('GBP')
    expect(name).toMatch(/pound/i)
    expect(currencyLabel('GBP')).toContain('GBP')
    expect(currencyLabel('GBP')).toContain(name)
  })

  it('sorts options by name so a currency is findable without its code', () => {
    const options = currencyOptions()
    expect(options.length).toBe(CURRENCY_CODES.length)
    const names = options.map((o) => o.name)
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names)
  })

  it('gives every option a label carrying both code and name', () => {
    for (const option of currencyOptions()) {
      expect(option.label).toContain(option.code)
      expect(option.label.length).toBeGreaterThan(option.code.length)
    }
  })

  it('does not invent a name for a code the runtime does not know', () => {
    // A code restored from a backup on an unusual runtime must still display. Echoing
    // the input back is CLDR's own convention for unknown codes.
    expect(currencyName('ZZZ')).toBe('ZZZ')
    expect(currencyLabel('ZZZ')).toBe('ZZZ')
  })

  it('normalises case when checking a code', () => {
    expect(isKnownCurrency('gbp')).toBe(true)
    expect(isKnownCurrency(' GBP ')).toBe(true)
    expect(isKnownCurrency('ZZZ')).toBe(false)
  })
})

describe('formatMinor', () => {
  it('formats two-decimal currencies in their own minor unit (0003 CU1)', () => {
    // 1100 minor units is £11.00, not £1100 and not £0.011.
    expect(formatMinor(1100, 'GBP')).toMatch(/11\.00/)
  })

  it('treats JPY as having no minor unit', () => {
    expect(minorUnitExponent('JPY')).toBe(0)
    expect(formatMinor(1100, 'JPY')).toMatch(/1,?100/)
    expect(formatMinor(1100, 'JPY')).not.toMatch(/\.00/)
  })

  it('treats KWD as having three minor units', () => {
    expect(minorUnitExponent('KWD')).toBe(3)
    expect(formatMinor(1100, 'KWD')).toMatch(/1\.100/)
  })

  it('keeps zero-decimal currencies from showing decimals', () => {
    expect(formatMinor(500, 'CLP')).not.toMatch(/\./)
  })

  it('falls back rather than throwing on a currency Intl cannot format', () => {
    // A settings page must not be taken down by a stored code the runtime rejects.
    expect(() => formatMinor(1000, 'not-a-code')).not.toThrow()
    expect(formatMinor(1000, 'not-a-code')).toContain('not-a-code'.toUpperCase())
  })

  it('round-trips through the plain input representation', () => {
    for (const [code, minor] of [
      ['USD', 1100],
      ['JPY', 1100],
      ['KWD', 1100],
    ] as const) {
      expect(majorStringToMinor(minorToMajorString(minor, code), code)).toBe(minor)
    }
  })
})

describe('majorStringToMinor', () => {
  it('parses a plain decimal', () => {
    expect(majorStringToMinor('11.00', 'GBP')).toBe(1100)
    expect(majorStringToMinor('0.5', 'USD')).toBe(50)
  })

  it('treats a single trailing separator as grouping in a two-decimal currency', () => {
    // Three digits after the separator is more than USD's minor unit can hold, so the
    // comma groups thousands rather than sitting after a decimal point.
    expect(majorStringToMinor('1,250', 'USD')).toBe(125_000)
    expect(majorStringToMinor('1,250', 'GBP')).toBe(125_000)
  })

  it('treats the same text as a decimal in a zero-decimal currency', () => {
    // This is the ambiguity the exponent exists to resolve: JPY has no minor unit, so
    // "1,250" cannot mean 1.25 and must mean 1250.
    expect(majorStringToMinor('1,250', 'JPY')).toBe(1250)
  })

  it('honours a European decimal comma with a thousands separator', () => {
    expect(majorStringToMinor('1.250,50', 'EUR')).toBe(125_050)
    expect(majorStringToMinor('1,250.50', 'GBP')).toBe(125_050)
  })

  it('ignores repeated separators as grouping', () => {
    expect(majorStringToMinor('1,234,567', 'USD')).toBe(123_456_700)
  })

  it('ignores currency symbols, codes and spaces', () => {
    expect(majorStringToMinor(' £1,100.00 ', 'GBP')).toBe(110_000)
    expect(majorStringToMinor('1250 GBP', 'GBP')).toBe(125_000)
    expect(majorStringToMinor('1 250,50', 'EUR')).toBe(125_050)
  })

  it('rounds extra precision half-up rather than rejecting it', () => {
    // JPY has no minor unit, so the first dropped digit decides the whole rounding:
    // 10.5 rounds away from zero and 10.4 does not.
    expect(majorStringToMinor('10.5', 'JPY')).toBe(11)
    expect(majorStringToMinor('10.4', 'JPY')).toBe(10)
    expect(majorStringToMinor('10.5678', 'KWD')).toBe(10_568)
    expect(majorStringToMinor('10.5674', 'KWD')).toBe(10_567)
  })

  it('handles a negative amount, which a rate may not be but an amount may', () => {
    expect(majorStringToMinor('-2.50', 'USD')).toBe(-250)
  })

  it('returns null for text that is not a number', () => {
    for (const value of ['', '   ', 'abc', '-', '+', '.']) {
      expect(majorStringToMinor(value, 'USD')).toBeNull()
    }
  })

  it('accepts a bare integer', () => {
    expect(majorStringToMinor('42', 'GBP')).toBe(4200)
    expect(majorStringToMinor('42', 'JPY')).toBe(42)
  })
})

describe('parseRateMinor', () => {
  it('rejects a negative rate (0003 E5)', () => {
    // A negative rate is a billing error rather than a figure anyone means, so this is
    // refused rather than stored and reported on later.
    expect(parseRateMinor('-5.00', 'GBP')).toBeNull()
  })

  it('rejects text that is not a number rather than storing zero', () => {
    expect(parseRateMinor('abc', 'GBP')).toBeNull()
    expect(parseRateMinor('', 'GBP')).toBeNull()
  })

  it('accepts zero, which means no rate rather than no value', () => {
    expect(parseRateMinor('0', 'GBP')).toBe(0)
  })
})
