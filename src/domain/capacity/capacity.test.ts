import { describe, expect, it } from 'vitest'
import {
  contractPeriodContaining,
  evenSplitPattern,
  overlaps,
  validateContractPeriod,
  validatePattern,
} from './contract'
import { expectedMinutes, expectedMinutesByWeek, expectedMinutesForDay } from './expected'
import { formatUtilisation, utilisation } from './utilisation'
import type { ContractPeriod, DayPattern } from './types'

/**
 * A 40-hour Monday-to-Friday contract: 480 minutes each weekday, 0 at the weekend.
 */
const MON_FRI_40H: DayPattern[] = [
  { weekday: 0, minutes: 480 },
  { weekday: 1, minutes: 480 },
  { weekday: 2, minutes: 480 },
  { weekday: 3, minutes: 480 },
  { weekday: 4, minutes: 480 },
  { weekday: 5, minutes: 0 },
  { weekday: 6, minutes: 0 },
]

/**
 * A 37.5-hour contract: Mon-Thu 480, Fri 300. The case the spec uses to reject
 * `minutesPerWeek / 7` (0013 K2, CP-A1).
 */
const MON_THU_480_FRI_300: DayPattern[] = [
  { weekday: 0, minutes: 480 },
  { weekday: 1, minutes: 480 },
  { weekday: 2, minutes: 480 },
  { weekday: 3, minutes: 480 },
  { weekday: 4, minutes: 300 },
  { weekday: 5, minutes: 0 },
  { weekday: 6, minutes: 0 },
]

function period(overrides: Partial<ContractPeriod> = {}): ContractPeriod {
  return {
    id: 'p1',
    clientId: 'client-a',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    minutesPerWeek: 2400,
    workPattern: MON_FRI_40H,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

describe('validateContractPeriod', () => {
  it('accepts a well-formed contract', () => {
    const result = validateContractPeriod(period(), [])
    expect(result.ok).toBe(true)
  })

  it('requires a client (0003 CT9)', () => {
    const result = validateContractPeriod(period({ clientId: '  ' }), [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('client-required')
  })

  it('rejects a contract with no working days (0003 CT6)', () => {
    const result = validateContractPeriod(
      period({
        minutesPerWeek: 0,
        workPattern: MON_FRI_40H.map((entry) => ({ ...entry, minutes: 0 })),
      }),
      [],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('no-working-days')
  })

  it('rejects a pattern that does not sum to minutesPerWeek (0003 CT3)', () => {
    const result = validateContractPeriod(
      period({ minutesPerWeek: 2250, workPattern: MON_THU_480_FRI_300 }),
      [],
    )
    // 4 x 480 + 300 = 2220, which is not 2250.
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('pattern-sum-mismatch')
  })

  it('rejects a contract ending before it starts', () => {
    const result = validateContractPeriod(
      period({ effectiveFrom: '2026-02-01', effectiveTo: '2026-01-01' }),
      [],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('date-range-invalid')
  })

  it('rejects a date that does not exist', () => {
    const result = validateContractPeriod(period({ effectiveFrom: '2026-02-30' }), [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('date-range-invalid')
  })

  it('rejects a contract overlapping another for the same client (0003 CT1)', () => {
    const existing = [
      period({ id: 'other', effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' }),
    ]
    const result = validateContractPeriod(
      period({ effectiveFrom: '2026-03-01', effectiveTo: '2026-09-30' }),
      existing,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('overlaps-existing')
  })

  it('allows two clients to hold open-ended periods at once (0003 CT1, 0013 K4)', () => {
    const existing = [period({ id: 'other', clientId: 'client-b' })]
    const result = validateContractPeriod(period(), existing)
    expect(result.ok).toBe(true)
  })

  it('allows a contract to start the day the previous one ends', () => {
    const existing = [
      period({ id: 'other', effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31' }),
    ]
    const result = validateContractPeriod(
      period({ effectiveFrom: '2026-04-01', effectiveTo: '2026-12-31' }),
      existing,
    )
    expect(result.ok).toBe(true)
  })
})

describe('validatePattern', () => {
  it('requires all seven weekdays exactly once (0003 CT2)', () => {
    const result = validatePattern(MON_FRI_40H.slice(0, 6), 2400)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('pattern-incomplete')
  })

  it('rejects a duplicate weekday', () => {
    const duplicated = MON_FRI_40H.map((entry, index) =>
      index === 1 ? { ...entry, weekday: 0 } : entry,
    )
    const result = validatePattern(duplicated, 2400)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('pattern-incomplete')
  })

  it('rejects minutes over 1440 (0003 CT4)', () => {
    const result = validatePattern(
      MON_FRI_40H.map((entry, index) => (index === 0 ? { ...entry, minutes: 1441 } : entry)),
      2400,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('pattern-out-of-range')
  })
})

describe('evenSplitPattern', () => {
  it('splits evenly when the week divides (0003 CT7)', () => {
    const pattern = evenSplitPattern(2400, [0, 1, 2, 3, 4])
    expect(pattern).not.toBeNull()
    const working = pattern?.filter((entry) => entry.minutes > 0) ?? []
    expect(working).toHaveLength(5)
    expect(working.every((entry) => entry.minutes === 480)).toBe(true)
    // The weekend is present with zero minutes, not omitted: the stored form covers
    // all seven weekdays (0003 CT2).
    expect(pattern).toHaveLength(7)
    expect(pattern?.find((entry) => entry.weekday === 5)?.minutes).toBe(0)
  })

  it('refuses to round an uneven split (0003 CT8)', () => {
    // 2,250 over four days is 562.5, and rounding it would break the sum.
    expect(evenSplitPattern(2250, [0, 1, 2, 3])).toBeNull()
  })

  it('refuses an empty working-day set', () => {
    expect(evenSplitPattern(2400, [])).toBeNull()
  })
})

describe('overlaps', () => {
  it('treats an open-ended period as running to the end of time', () => {
    expect(
      overlaps(
        { effectiveFrom: '2026-01-01', effectiveTo: null },
        {
          effectiveFrom: '2030-01-01',
          effectiveTo: null,
        },
      ),
    ).toBe(true)
  })

  it('treats touching endpoints as overlapping, because dates are inclusive', () => {
    expect(
      overlaps(
        { effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31' },
        { effectiveFrom: '2026-03-31', effectiveTo: '2026-06-30' },
      ),
    ).toBe(true)
  })
})

describe('expectedMinutes', () => {
  const periods = [period()]

  it('yields exactly 2,400 expected minutes for a 40-hour Mon-Fri week (0013 gate)', () => {
    // 2026-01-05 is a Monday. The week runs to Sunday 2026-01-11.
    const result = expectedMinutes('2026-01-05', '2026-01-11', 'client-a', periods)
    expect(result.minutes).toBe(2400)
    expect(result.unknownDays).toBe(0)
  })

  it('does not divide the week by seven (0013 CP-A1, K2)', () => {
    const uneven = [period({ minutesPerWeek: 2220, workPattern: MON_THU_480_FRI_300 })]
    const result = expectedMinutes('2026-01-05', '2026-01-11', 'client-a', uneven)
    expect(result.minutes).toBe(2220)
    expect(result.minutes).not.toBe(2220 / 7)
  })

  it('counts a weekend day as zero expected minutes', () => {
    expect(expectedMinutesForDay(periods, 'client-a', '2026-01-10')).toBe(0)
  })

  it('reports an uncovered day as unknown, not zero (0013 K5)', () => {
    const bounded = [period({ effectiveTo: '2026-12-31' })]
    expect(expectedMinutesForDay(bounded, 'client-a', '2027-01-04')).toBeNull()
  })

  it('makes the whole range unknown when any day is uncovered (0013 K5)', () => {
    const bounded = [period({ effectiveTo: '2026-12-31' })]
    const result = expectedMinutes('2026-01-05', '2026-01-11', 'client-a', bounded)
    expect(result.minutes).toBe(2400)

    // A range that runs past the end of the contract is partly unknown.
    const partly = expectedMinutes('2026-01-05', '2027-01-18', 'client-a', bounded)
    expect(partly.minutes).toBeNull()
    expect(partly.unknownDays).toBeGreaterThan(0)
  })

  it('attributes each portion of a range to its own contract (0013 CP-A3)', () => {
    const two = [
      period({ id: 'first', effectiveFrom: '2026-01-01', effectiveTo: '2026-01-07' }),
      period({
        id: 'second',
        effectiveFrom: '2026-01-08',
        effectiveTo: null,
        minutesPerWeek: 2220,
        workPattern: MON_THU_480_FRI_300,
      }),
    ]
    // 2026-01-05 Mon through 2026-01-11 Sun. The first contract covers Mon-Wed at
    // 480 each; the second covers Thu at 480 and Fri at 300; the weekend is zero.
    // 3 x 480 + 480 + 300 = 2220.
    const result = expectedMinutes('2026-01-05', '2026-01-11', 'client-a', two)
    expect(result.minutes).toBe(2220)
  })

  it('keeps two clients apart', () => {
    const result = expectedMinutes('2026-01-05', '2026-01-11', 'client-b', periods)
    expect(result.minutes).toBeNull()
  })

  it('ignores a tombstoned contract (0012 M6)', () => {
    const deleted = [period({ deletedAt: '2026-01-01T00:00:00.000Z' })]
    const result = expectedMinutes('2026-01-05', '2026-01-11', 'client-a', deleted)
    expect(result.minutes).toBeNull()
  })
})

describe('expectedMinutesByWeek', () => {
  it('splits a range into weeks', () => {
    const periods = [period()]
    const weeks = expectedMinutesByWeek('2026-01-05', '2026-01-18', 'client-a', periods)
    expect(weeks.size).toBe(2)
    expect([...weeks.values()].map((value) => value.minutes)).toEqual([2400, 2400])
  })

  it('groups Sunday into the preceding week when weeks start on Monday', () => {
    const periods = [period()]
    const weeks = expectedMinutesByWeek('2026-01-11', '2026-01-11', 'client-a', periods)
    expect([...weeks.keys()]).toEqual(['2026-01-05'])
  })

  it('groups Sunday into its own week when weeks start on Sunday (0006 DR3)', () => {
    const periods = [period()]
    const weeks = expectedMinutesByWeek(
      '2026-01-11',
      '2026-01-11',
      'client-a',
      periods,
      'sunday',
    )
    expect([...weeks.keys()]).toEqual(['2026-01-11'])
  })
})

describe('utilisation', () => {
  const periods = [period()]

  it('renders an uncovered range as unknown, not zero (0013 CP-A6)', () => {
    const result = utilisation('2026-01-05', '2026-01-11', 'client-b', periods, {
      minutes: 0,
      billableMinutes: 0,
    })
    expect(result.percent).toBeNull()
    expect(formatUtilisation(result.percent)).toBe('—')
  })

  it('computes a percentage to one decimal place (0013 CP-A5)', () => {
    const result = utilisation('2026-01-05', '2026-01-11', 'client-a', periods, {
      minutes: 1800,
      billableMinutes: 1800,
    })
    expect(result.percent).toBe(75)
    expect(result.delta).toBe(-600)
  })

  it('shows over 100% exactly rather than capping it (0013 CP-A7)', () => {
    const result = utilisation('2026-01-05', '2026-01-11', 'client-a', periods, {
      minutes: 3000,
      billableMinutes: 3000,
    })
    expect(result.percent).toBe(125)
  })

  it('reports the delta as unknown when the expectation is unknown', () => {
    const result = utilisation('2026-01-05', '2026-01-11', 'client-b', periods, {
      minutes: 600,
      billableMinutes: 600,
    })
    expect(result.delta).toBeNull()
  })
})

describe('contractPeriodContaining', () => {
  it('matches a day inside the range', () => {
    const periods = [period({ effectiveFrom: '2026-01-01', effectiveTo: '2026-01-31' })]
    expect(contractPeriodContaining(periods, 'client-a', '2026-01-15')).not.toBeNull()
  })

  it('does not match a day outside the range', () => {
    const periods = [period({ effectiveFrom: '2026-01-01', effectiveTo: '2026-01-31' })]
    expect(contractPeriodContaining(periods, 'client-a', '2026-02-01')).toBeNull()
  })

  it('does not match another client', () => {
    const periods = [period()]
    expect(contractPeriodContaining(periods, 'client-b', '2026-01-15')).toBeNull()
  })
})
