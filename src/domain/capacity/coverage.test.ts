import { describe, expect, it } from 'vitest'
import { billableUtilisation, formatUtilisation, utilisation } from './utilisation'
import {
  billableDurationMs,
  roundingDifference,
  roundDurationToIncrement,
} from '../reports/rounding'
import { resolveRange, precedingRange, weekBounds } from '../reports/ranges'
import { currentContractPeriod, localDateKey, overlaps } from './contract'
import { dayHeading } from '../entries/dayHeading'
import { formatDuration } from '../time/duration'
import type { ContractPeriod } from './types'

/**
 * The gaps the coverage review found in `domain/`.
 *
 * 0010 Q5 says coverage must be measured for `domain/` and must be high, because it
 * is pure and cheap to test. This file is the part of that the report screens are
 * not the right place for: the arithmetic itself, and the decisions that arithmetic
 * makes.
 *
 * Several of these functions were not called from anywhere, which the coverage
 * report showed as uncovered lines. Two of them turned out to implement a
 * requirement the screens did not show — billable utilisation (0013 CR3) and the raw
 * duration beside the rounded one (0006 RD5) — and both are now surfaced.
 */

function contract(overrides: Partial<ContractPeriod> = {}): ContractPeriod {
  return {
    id: 'p1',
    clientId: 'client-a',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    minutesPerWeek: 2400,
    workPattern: [
      { weekday: 0, minutes: 480 },
      { weekday: 1, minutes: 480 },
      { weekday: 2, minutes: 480 },
      { weekday: 3, minutes: 480 },
      { weekday: 4, minutes: 480 },
      { weekday: 5, minutes: 0 },
      { weekday: 6, minutes: 0 },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

describe('billable utilisation (0013 CR3)', () => {
  const periods = [contract()]

  it('is a share of the expected hours, like the hour one', () => {
    const worked = { minutes: 1200, billableMinutes: 900 }
    const hours = utilisation('2026-01-05', '2026-01-11', 'client-a', periods, worked)
    const billable = billableUtilisation(
      '2026-01-05',
      '2026-01-11',
      'client-a',
      periods,
      worked,
    )

    expect(hours.percent).toBe(50)
    expect(billable.percent).toBe(37.5)
  })

  it('is a dash when nothing is expected, because there is no share to have', () => {
    const result = billableUtilisation('2026-01-05', '2026-01-11', 'client-b', periods, {
      minutes: 600,
      billableMinutes: 600,
    })
    // No contract covers this client, so there is no expectation to have a share of.
    // The difference is still a number: 600 against 0 is 600.
    expect(result.percent).toBeNull()
    expect(result.expected).toBe(0)
    expect(result.delta).toBe(600)
    expect(result.worked).toBe(600)
  })

  it('shows more than a hundred per cent rather than capping it (0013 CP-A7)', () => {
    const result = billableUtilisation('2026-01-05', '2026-01-11', 'client-a', periods, {
      minutes: 3000,
      billableMinutes: 3000,
    })
    expect(result.percent).toBe(125)
  })
})

describe('the rounding difference (0006 RD5)', () => {
  it('reports the two figures and whether they differ', () => {
    // 22 minutes 30 seconds rounds to 30 minutes.
    const difference = roundingDifference(22 * 60_000 + 30_000, 15)
    expect(difference.rawMs).toBe(22 * 60_000 + 30_000)
    expect(difference.roundedMs).toBe(30 * 60_000)
    expect(difference.differs).toBe(true)
  })

  it('says they do not differ when rounding changed nothing', () => {
    const difference = roundingDifference(30 * 60_000, 15)
    expect(difference.differs).toBe(false)
  })
})

describe('rounding, at the edges', () => {
  it('leaves a duration alone when the increment is not positive', () => {
    // A zero increment would divide by zero, and a negative one would round the
    // wrong way. Neither is reachable from the settings, but neither should be able
    // to produce a nonsense figure.
    expect(roundDurationToIncrement(1000, 0)).toBe(1000)
    expect(roundDurationToIncrement(1000, -15)).toBe(1000)
  })

  it('rounds a duration of zero to zero', () => {
    expect(billableDurationMs(0, 15)).toBe(0)
  })
})

describe('formatUtilisation', () => {
  it('renders unknown as a dash rather than a number', () => {
    expect(formatUtilisation(null)).toBe('—')
  })

  it('renders a figure to one decimal place', () => {
    expect(formatUtilisation(37.5)).toBe('37.5%')
    expect(formatUtilisation(100)).toBe('100.0%')
  })
})

describe('the range presets (0006 DR1)', () => {
  // A Wednesday, so a week boundary is not the same day as the range's start.
  const now = new Date(2026, 0, 14, 12, 0, 0)

  it('resolves each preset to a range', () => {
    expect(resolveRange('today', now)?.from).toBe('2026-01-14')
    expect(resolveRange('yesterday', now)?.from).toBe('2026-01-13')
    expect(resolveRange('this-week', now)?.from).toBe('2026-01-12')
    expect(resolveRange('last-week', now)?.from).toBe('2026-01-05')
    expect(resolveRange('this-month', now)?.from).toBe('2026-01-01')
    expect(resolveRange('this-month', now)?.to).toBe('2026-01-31')
    expect(resolveRange('last-month', now)?.from).toBe('2025-12-01')
    expect(resolveRange('last-month', now)?.to).toBe('2025-12-31')
    expect(resolveRange('last-30-days', now)?.from).toBe('2025-12-16')
    expect(resolveRange('last-90-days', now)?.from).toBe('2025-10-17')
  })

  it('has no range for all-time, and for a custom range with no dates', () => {
    expect(resolveRange('all-time', now)).toBeNull()
    expect(resolveRange('custom', now)).toBeNull()
  })

  it('uses a custom range when it is given one', () => {
    const range = resolveRange('custom', now, 'monday', {
      from: '2026-02-01',
      to: '2026-02-28',
    })
    expect(range?.from).toBe('2026-02-01')
    expect(range?.to).toBe('2026-02-28')
  })

  it('starts a Sunday week on a Sunday', () => {
    const range = resolveRange('this-week', now, 'sunday')
    expect(range?.from).toBe('2026-01-11')
    expect(range?.to).toBe('2026-01-17')
  })
})

describe('the preceding range (0006 R5)', () => {
  it('is the same number of days, immediately before', () => {
    const previous = precedingRange({ from: '2026-01-01', to: '2026-01-07' })
    expect(previous?.from).toBe('2025-12-25')
    expect(previous?.to).toBe('2025-12-31')
  })

  it('is null for a range that ends before it starts', () => {
    expect(precedingRange({ from: '2026-01-07', to: '2026-01-01' })).toBeNull()
  })
})

describe('weekBounds', () => {
  it('finds the Monday of the week a day falls in', () => {
    expect(localDateKey(weekBounds(new Date(2026, 0, 14)))).toBe('2026-01-12')
  })

  it('finds the Sunday of the week when weeks start on Sunday', () => {
    expect(localDateKey(weekBounds(new Date(2026, 0, 14), 'sunday'))).toBe('2026-01-11')
  })
})

describe('currentContractPeriod', () => {
  it('finds the period in force today', () => {
    const periods = [contract({ effectiveFrom: '2026-01-01', effectiveTo: null })]
    expect(currentContractPeriod(periods, 'client-a', new Date(2026, 5, 1))).not.toBeNull()
  })

  it('is null when no period covers today', () => {
    const periods = [contract({ effectiveFrom: '2026-01-01', effectiveTo: '2026-01-31' })]
    expect(currentContractPeriod(periods, 'client-a', new Date(2026, 5, 1))).toBeNull()
  })
})

describe('overlaps', () => {
  it('treats an open-ended period as running to the end of time', () => {
    expect(
      overlaps(
        { effectiveFrom: '2026-01-01', effectiveTo: null },
        { effectiveFrom: '2030-01-01', effectiveTo: null },
      ),
    ).toBe(true)
  })
})

describe('a day heading that cannot be formatted', () => {
  it('falls back to the key rather than throwing', () => {
    // A key the formatter cannot make sense of — a corrupt one from a backup.
    // The heading is a label, and a label that is the key is better than a crash.
    expect(dayHeading('not-a-day')).toBe('not-a-day')
  })
})

describe('a duration with seconds', () => {
  it('shows the seconds when asked for them', () => {
    expect(formatDuration(90_000, { seconds: true })).toBe('0:01:30')
  })
})
