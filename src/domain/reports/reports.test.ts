import { describe, expect, it } from 'vitest'
import {
  billableSummary,
  breakdownBy,
  dailyTotals,
  durationInRange,
  prepareEntries,
  unbilledWork,
  weekOverWeek,
} from './report'
import type { ReportEntry } from './report'
import { billableAmountMinor, roundDurationToIncrement } from './rounding'
import { buildInvoice } from './invoice'
import { precedingRange, resolveRange } from './ranges'
import { filterEntries, findOverlaps, NO_FILTER } from './filters'
import type { TimeEntry } from '../entries/types'
import type { Client, Project } from '../taxonomy/types'

const NOW = new Date('2026-01-14T12:00:00.000Z')

const CLIENT: Client = {
  id: 'c1',
  name: 'Acme Ltd',
  colour: '#123456',
  defaultRateMinor: 10000,
  currency: 'GBP',
  archived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
}

const OTHER_CLIENT: Client = { ...CLIENT, id: 'c2', name: 'Globex', currency: 'EUR' }

/** A client with no rate, so its work is billable but has no monetary value. */
const RATE_LESS_CLIENT: Client = {
  ...CLIENT,
  id: 'c3',
  name: 'Initech',
  defaultRateMinor: null,
}

const PROJECT: Project = {
  id: 'p1',
  name: 'Website',
  clientId: 'c1',
  colour: '#abcdef',
  defaultRateMinor: null,
  currency: null,
  archived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
}

const OTHER_PROJECT: Project = { ...PROJECT, id: 'p2', name: 'Support', clientId: 'c2' }

const RATE_LESS_PROJECT: Project = { ...PROJECT, id: 'p3', name: 'Advisory', clientId: 'c3' }

const TAXONOMY = {
  projects: [PROJECT, OTHER_PROJECT, RATE_LESS_PROJECT],
  clients: [CLIENT, OTHER_CLIENT, RATE_LESS_CLIENT],
  defaultCurrency: 'GBP',
}

/** The first prepared entry, failing loudly rather than asserting a non-null. */
function first(prepared: readonly ReportEntry[]): ReportEntry {
  const row = prepared[0]
  if (row === undefined) throw new Error('expected a prepared entry')
  return row
}

function entry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'e1',
    projectId: 'p1',
    tagIds: [],
    start: '2026-01-05T09:00:00.000Z',
    end: '2026-01-05T11:00:00.000Z',
    note: '',
    billable: true,
    rateOverrideMinor: null,
    source: 'timer',
    createdAt: '2026-01-05T11:00:00.000Z',
    updatedAt: '2026-01-05T11:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

describe('rounding (0006 RD2, RD4)', () => {
  it('rounds to the nearest increment, half up', () => {
    // 22.5 minutes is exactly halfway between 15 and 30, and half up takes the larger.
    const ms = 22 * 60_000 + 30_000
    expect(roundDurationToIncrement(ms, 15)).toBe(30 * 60_000)
  })

  it('rounds down below the half', () => {
    expect(roundDurationToIncrement(22 * 60_000, 15)).toBe(15 * 60_000)
  })

  it('rounds the duration before multiplying by the rate (0006 RD4)', () => {
    // 22.5 minutes rounds to 30 minutes: 30/60 hours x 100.00 = 5000.
    const ms = 22 * 60_000 + 30_000
    expect(billableAmountMinor(ms, 15, 10000)).toBe(5000)
  })

  it('rounds the money to whole minor units, not to a fraction (0003 P3)', () => {
    // A rate that is not a multiple of four makes the amount fractional: a quarter of
    // an hour at 3,333 minor units is 833.25. Money is integer minor units, because a
    // float accumulates error across many additions and stops matching the sum of the
    // lines (0003 P3).
    expect(billableAmountMinor(15 * 60_000, 15, 3333)).toBe(833)
  })

  it('would give a different answer if the money were rounded instead', () => {
    // This is the failure RD4 exists to prevent: 22.5 min x 100/hr = 37.50, and
    // rounding that to whole pence gives 3750, which does not reconcile with a line
    // item that was rounded on its duration.
    const ms = 22 * 60_000 + 30_000
    expect(billableAmountMinor(ms, 15, 10000)).not.toBe(Math.round((ms / 3_600_000) * 10000))
  })
})

describe('ranges (0006 DR1–DR5)', () => {
  it('resolves today to a single day', () => {
    const range = resolveRange('today', NOW)
    expect(range?.from).toBe('2026-01-14')
    expect(range?.to).toBe('2026-01-14')
  })

  it('resolves this week to a calendar week, Monday to Sunday', () => {
    const range = resolveRange('this-week', NOW)
    expect(range?.from).toBe('2026-01-12')
    expect(range?.to).toBe('2026-01-18')
  })

  it('resolves the week differently when weeks start on Sunday', () => {
    const range = resolveRange('this-week', NOW, 'sunday')
    expect(range?.from).toBe('2026-01-11')
    expect(range?.to).toBe('2026-01-17')
  })

  it('resolves this month to the calendar month', () => {
    const range = resolveRange('this-month', NOW)
    expect(range?.from).toBe('2026-01-01')
    expect(range?.to).toBe('2026-01-31')
  })

  it('resolves last month to the calendar month before', () => {
    const range = resolveRange('last-month', NOW)
    expect(range?.from).toBe('2025-12-01')
    expect(range?.to).toBe('2025-12-31')
  })

  it('has no range for all-time', () => {
    expect(resolveRange('all-time', NOW)).toBeNull()
  })

  it('counts the preceding range in days, not milliseconds', () => {
    // 2026-03-01 to 2026-03-31 is 31 days, so the previous range is the 31 days
    // ending the day before — 2026-01-29 to 2026-02-28. A March range crossing the UK
    // DST change on 29 March is still 31 days, which dividing by 86,400,000 would
    // not give.
    const previous = precedingRange({ from: '2026-03-01', to: '2026-03-31' })
    expect(previous?.from).toBe('2026-01-29')
    expect(previous?.to).toBe('2026-02-28')
  })
})

describe('durationInRange (0006 DR5)', () => {
  it('clips an entry to the range in the default mode', () => {
    // An entry running 23:00 on the 5th to 01:00 on the 6th, against a range
    // covering only the 6th: one hour of it is inside the range.
    const prepared = prepareEntries(
      [entry({ start: '2026-01-05T23:00:00.000Z', end: '2026-01-06T01:00:00.000Z' })],
      TAXONOMY,
      NOW,
      15,
    )
    const duration = durationInRange(
      first(prepared),
      { from: '2026-01-06', to: '2026-01-06' },
      'clipped',
      NOW,
    )
    expect(duration).toBe(3_600_000)
  })

  it('counts the whole entry in overlap mode', () => {
    // The same entry: it touches the range, so the whole two hours count.
    const prepared = prepareEntries(
      [entry({ start: '2026-01-05T23:00:00.000Z', end: '2026-01-06T01:00:00.000Z' })],
      TAXONOMY,
      NOW,
      15,
    )
    const duration = durationInRange(
      first(prepared),
      { from: '2026-01-06', to: '2026-01-06' },
      'overlap',
      NOW,
    )
    expect(duration).toBe(2 * 3_600_000)
  })

  it('counts nothing for an entry outside the range', () => {
    const prepared = prepareEntries([entry()], TAXONOMY, NOW, 15)
    const duration = durationInRange(
      first(prepared),
      { from: '2026-01-06', to: '2026-01-06' },
      'overlap',
      NOW,
    )
    expect(duration).toBe(0)
  })
})

describe('breakdownBy (0006 R2, RP2)', () => {
  it('splits by project and reconciles with the total (0006 RP2)', () => {
    const entries = [
      entry({ id: 'e1', projectId: 'p1' }),
      entry({ id: 'e2', projectId: 'p1' }),
      entry({ id: 'e3', projectId: 'p2' }),
    ]
    const prepared = prepareEntries(entries, TAXONOMY, NOW, 15)
    const durations = prepared.map((item) => item.durationMs)

    const { groups, totalMs } = breakdownBy(prepared, 'project', durations)
    expect(totalMs).toBe(6 * 3_600_000)

    const sum = groups.reduce((total, group) => total + (group.totalMs ?? 0), 0)
    expect(sum).toBe(totalMs)
  })

  it('gives each group a percentage that sums to 100 (0006 RP2)', () => {
    const entries = [entry({ id: 'e1', projectId: 'p1' }), entry({ id: 'e2', projectId: 'p2' })]
    const prepared = prepareEntries(entries, TAXONOMY, NOW, 15)
    const durations = prepared.map((item) => item.durationMs)

    const { groups } = breakdownBy(prepared, 'project', durations)
    const sum = groups.reduce((total, group) => total + (group.percentage ?? 0), 0)
    expect(sum).toBeCloseTo(100, 5)
  })

  it('sorts by duration descending, with the unassigned group last', () => {
    const entries = [
      entry({ id: 'e1', projectId: 'p1' }),
      entry({ id: 'e2', projectId: 'p2' }),
      entry({ id: 'e3', projectId: null }),
    ]
    const prepared = prepareEntries(entries, TAXONOMY, NOW, 15)
    const durations = prepared.map((item) => item.durationMs)

    const { groups } = breakdownBy(prepared, 'project', durations)
    expect(groups[groups.length - 1]?.label).toBe('Unassigned')
  })

  it('splits by client, resolving through the project (0005 R3)', () => {
    const entries = [entry({ id: 'e1', projectId: 'p1' }), entry({ id: 'e2', projectId: 'p2' })]
    const prepared = prepareEntries(entries, TAXONOMY, NOW, 15)
    const durations = prepared.map((item) => item.durationMs)

    const { groups } = breakdownBy(prepared, 'client', durations)
    expect(groups.map((group) => group.label).sort()).toEqual(['Acme Ltd', 'Globex'])
  })
})

describe('dailyTotals (0006 R1, DT2)', () => {
  it('groups by local day', () => {
    const entries = [
      entry({ id: 'e1', start: '2026-01-05T09:00:00.000Z', end: '2026-01-05T10:00:00.000Z' }),
      entry({ id: 'e2', start: '2026-01-06T09:00:00.000Z', end: '2026-01-06T10:00:00.000Z' }),
    ]
    const prepared = prepareEntries(entries, TAXONOMY, NOW, 15)
    const durations = prepared.map((item) => item.durationMs)

    const days = dailyTotals(prepared, durations)
    expect(days).toHaveLength(2)
    expect(days[0]?.dayKey).toBe('2026-01-05')
    expect(days[0]?.totalMs).toBe(3_600_000)
  })
})

describe('billableSummary (0006 R6)', () => {
  it('separates billable from non-billable', () => {
    const entries = [entry({ id: 'e1', billable: true }), entry({ id: 'e2', billable: false })]
    const prepared = prepareEntries(entries, TAXONOMY, NOW, 15)
    const durations = prepared.map((item) => item.durationMs)

    const summary = billableSummary(
      prepared.map((item, index) => ({
        item,
        ms: durations[index] ?? null,
        billableMs: durations[index] ?? null,
      })),
    )
    // Minutes, like every other figure on the reports screen.
    expect(summary.billableMinutes).toBe(2 * 60)
    expect(summary.nonBillableMinutes).toBe(2 * 60)
    expect(summary.totalMinutes).toBe(4 * 60)
  })

  it('reports in minutes, not milliseconds', () => {
    // A unit error in a figure that is otherwise plausible is the worst kind: five
    // hours of work read as "300000h", which looks like a lifetime rather than a
    // typo. Every other figure on the reports screen is in minutes, and this one
    // has to agree with them.
    const entries = [
      entry({ id: 'e1', projectId: 'p1', billable: true }),
      entry({ id: 'e2', projectId: 'p1', billable: false }),
    ]
    const prepared = prepareEntries(entries, TAXONOMY, NOW, 15)
    const ranged = prepared.map((item) => ({
      item,
      ms: item.durationMs,
      billableMs: item.durationMs,
    }))

    const summary = billableSummary(ranged)
    // Two hours each.
    expect(summary.billableMinutes).toBe(120)
    expect(summary.nonBillableMinutes).toBe(120)
    expect(summary.totalMinutes).toBe(240)
  })

  it('keeps currencies apart rather than summing them (0003 CU2)', () => {
    const entries = [
      entry({ id: 'e1', projectId: 'p1', rateOverrideMinor: 10000 }),
      entry({ id: 'e2', projectId: 'p2', rateOverrideMinor: 5000 }),
    ]
    const prepared = prepareEntries(entries, TAXONOMY, NOW, 15)
    const durations = prepared.map((item) => item.durationMs)

    const summary = billableSummary(
      prepared.map((item, index) => ({
        item,
        ms: durations[index] ?? null,
        billableMs: durations[index] ?? null,
      })),
    )
    expect(summary.amountByCurrency.size).toBe(2)
  })
})

describe('unbilledWork (0006 R7)', () => {
  it('lists billable entries with no resolved rate', () => {
    const entries = [
      // p3's client has no rate, so this is billable work with no monetary value.
      entry({ id: 'e1', projectId: 'p3', rateOverrideMinor: null }),
      entry({ id: 'e2', projectId: 'p1', rateOverrideMinor: 10000 }),
      entry({ id: 'e3', projectId: 'p3', billable: false, rateOverrideMinor: null }),
    ]
    const prepared = prepareEntries(entries, TAXONOMY, NOW, 15)

    const unbilled = unbilledWork(prepared)
    expect(unbilled).toHaveLength(1)
    expect(unbilled[0]?.entry.id).toBe('e1')
  })
})

describe('weekOverWeek (0006 R5)', () => {
  it('reports a percentage change against the previous period', () => {
    const current = [entry({ id: 'e1' })]
    const previous = [entry({ id: 'e2' })]

    const rows = weekOverWeek(
      prepareEntries(current, TAXONOMY, NOW, 15),
      [3_600_000],
      prepareEntries(previous, TAXONOMY, NOW, 15),
      [7_200_000],
      'project',
    )

    const row = rows[0]
    expect(row?.deltaMs).toBe(-3_600_000)
    expect(row?.deltaPercent).toBe(-50)
  })

  it('reports no percentage when there was nothing before', () => {
    const rows = weekOverWeek(
      prepareEntries([entry({ id: 'e1' })], TAXONOMY, NOW, 15),
      [3_600_000],
      [],
      [],
      'project',
    )

    const row = rows[0]
    expect(row?.isNew).toBe(true)
    expect(row?.deltaPercent).toBeNull()
  })
})

describe('filterEntries (0004 L3)', () => {
  const entries = [
    entry({
      id: 'e1',
      projectId: 'p1',
      tagIds: ['t1'],
      billable: true,
      source: 'timer',
      note: 'alpha',
    }),
    entry({
      id: 'e2',
      projectId: 'p2',
      tagIds: ['t2'],
      billable: false,
      source: 'manual',
      note: 'beta',
    }),
    entry({
      id: 'e3',
      projectId: null,
      tagIds: [],
      billable: true,
      source: 'manual',
      note: '',
    }),
  ]
  const taxonomy = { projects: [PROJECT, OTHER_PROJECT], clients: [CLIENT, OTHER_CLIENT] }

  it('returns everything for an empty filter', () => {
    expect(filterEntries(entries, NO_FILTER, taxonomy)).toHaveLength(3)
  })

  it('filters by project', () => {
    const result = filterEntries(entries, { ...NO_FILTER, projectId: 'p1' }, taxonomy)
    expect(result.map((row) => row.id)).toEqual(['e1'])
  })

  it('filters by client, resolving through the project', () => {
    const result = filterEntries(entries, { ...NO_FILTER, clientId: 'c2' }, taxonomy)
    expect(result.map((row) => row.id)).toEqual(['e2'])
  })

  it('filters by billable state', () => {
    const result = filterEntries(entries, { ...NO_FILTER, billable: false }, taxonomy)
    expect(result.map((row) => row.id)).toEqual(['e2'])
  })

  it('filters by source', () => {
    const result = filterEntries(entries, { ...NO_FILTER, source: 'manual' }, taxonomy)
    expect(result.map((row) => row.id)).toEqual(['e2', 'e3'])
  })

  it('filters by free text in the note, case-insensitively', () => {
    const result = filterEntries(entries, { ...NO_FILTER, note: 'ALPH' }, taxonomy)
    expect(result.map((row) => row.id)).toEqual(['e1'])
  })

  it('requires every selected tag to be present', () => {
    const result = filterEntries(entries, { ...NO_FILTER, tagIds: ['t1', 't2'] }, taxonomy)
    expect(result).toHaveLength(0)
  })
})

describe('findOverlaps (0004 O3)', () => {
  it('marks entries that share any time', () => {
    const entries = [
      entry({ id: 'e1', start: '2026-01-05T09:00:00.000Z', end: '2026-01-05T11:00:00.000Z' }),
      entry({ id: 'e2', start: '2026-01-05T10:00:00.000Z', end: '2026-01-05T12:00:00.000Z' }),
      entry({ id: 'e3', start: '2026-01-05T13:00:00.000Z', end: '2026-01-05T14:00:00.000Z' }),
    ]

    const marked = findOverlaps(entries, NOW)
    expect(marked.entryIds.has('e1')).toBe(true)
    expect(marked.entryIds.has('e2')).toBe(true)
    expect(marked.entryIds.has('e3')).toBe(false)
  })

  it('marks nothing when the entries do not touch', () => {
    const entries = [
      entry({ id: 'e1', start: '2026-01-05T09:00:00.000Z', end: '2026-01-05T10:00:00.000Z' }),
      entry({ id: 'e2', start: '2026-01-05T10:00:00.000Z', end: '2026-01-05T11:00:00.000Z' }),
    ]

    // Touching at an endpoint is not overlapping: one ends exactly when the other starts.
    expect(findOverlaps(entries, NOW).entryIds.size).toBe(0)
  })
})

/**
 * The invoice (0006 I1–I6).
 *
 * The load-bearing property is that the line totals sum to the invoice total exactly
 * (0006 I2). It holds because the rounding is applied to the duration once, before
 * the rate is multiplied (0006 RD4) — rounding per line after the multiplication is
 * what breaks it.
 */
describe('the invoice (0006 I1–I6)', () => {
  it('sums its line totals to the total exactly', () => {
    const entries = [
      entry({ id: 'e1', projectId: 'p1', rateOverrideMinor: 10000 }),
      entry({ id: 'e2', projectId: 'p1', rateOverrideMinor: 10000 }),
      entry({ id: 'e3', projectId: 'p2', rateOverrideMinor: 10000 }),
    ]
    const prepared = prepareEntries(entries, TAXONOMY, NOW, 15)
    const durations = prepared.map((item) => item.durationMs)

    const invoice = buildInvoice('Acme Ltd', prepared, durations, 15)
    const lineSum = invoice.lines.reduce((total, line) => total + line.totalMinor, 0)
    const subtotalSum = invoice.subtotals.reduce((total, row) => total + row.totalMinor, 0)
    expect(lineSum).toBe(subtotalSum)
  })

  it('shows the rate actually applied, not the project default (0006 I3)', () => {
    const entries = [
      // p1's client bills at £100/h; this entry overrides to £75/h.
      entry({ id: 'e1', projectId: 'p1', rateOverrideMinor: 7500 }),
    ]
    const prepared = prepareEntries(entries, TAXONOMY, NOW, 15)
    const durations = prepared.map((item) => item.durationMs)

    const invoice = buildInvoice('Acme Ltd', prepared, durations, 15)
    expect(invoice.lines[0]?.rateMinorPerHour).toBe(7500)
  })

  it('leaves out work that is not billable, and work with no rate', () => {
    const entries = [
      entry({ id: 'e1', projectId: 'p1', rateOverrideMinor: 10000 }),
      entry({ id: 'e2', projectId: 'p1', billable: false, rateOverrideMinor: 10000 }),
      // p3's client has no rate, so this is billable with no money in it.
      entry({ id: 'e3', projectId: 'p3', rateOverrideMinor: null }),
    ]
    const prepared = prepareEntries(entries, TAXONOMY, NOW, 15)
    const durations = prepared.map((item) => item.durationMs)

    const invoice = buildInvoice('Acme Ltd', prepared, durations, 15)
    expect(invoice.entryCount).toBe(1)
  })

  it('keeps currencies apart rather than summing them (0006 I4, 0003 CU2)', () => {
    const entries = [
      entry({ id: 'e1', projectId: 'p1', rateOverrideMinor: 10000 }),
      entry({ id: 'e2', projectId: 'p2', rateOverrideMinor: 5000 }),
    ]
    const prepared = prepareEntries(entries, TAXONOMY, NOW, 15)
    const durations = prepared.map((item) => item.durationMs)

    const invoice = buildInvoice('Acme Ltd', prepared, durations, 15)
    expect(invoice.subtotals.length).toBe(2)
  })

  it('is reproducible: the same data yields the same invoice (0006 I5)', () => {
    const entries = [entry({ id: 'e1', projectId: 'p1', rateOverrideMinor: 10000 })]
    const prepared = prepareEntries(entries, TAXONOMY, NOW, 15)
    const durations = prepared.map((item) => item.durationMs)

    const first = buildInvoice('Acme Ltd', prepared, durations, 15)
    const second = buildInvoice('Acme Ltd', prepared, durations, 15)
    expect(second).toEqual(first)
  })
})
