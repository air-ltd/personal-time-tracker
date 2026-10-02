import { describe, expect, it } from 'vitest'
import { groupEntriesByDay, sortEntriesForList } from './group'
import type { TimeEntry } from './types'

const HOUR = 3_600_000

function entry(overrides: Partial<TimeEntry> & { id: string }): TimeEntry {
  return {
    projectId: null,
    tagIds: [],
    start: '2026-10-13T09:00:00.000Z',
    end: '2026-10-13T10:00:00.000Z',
    note: '',
    billable: false,
    rateOverrideMinor: null,
    source: 'manual',
    createdAt: '2026-10-13T09:00:00.000Z',
    updatedAt: '2026-10-13T09:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

const NOW = new Date(2026, 9, 13, 20, 0, 0)

describe('groupEntriesByDay (0004 L1)', () => {
  it('groups by local day, newest first', () => {
    const groups = groupEntriesByDay(
      [
        entry({ id: 'a', start: '2026-10-12T09:00:00.000Z', end: '2026-10-12T10:00:00.000Z' }),
        entry({ id: 'b', start: '2026-10-13T09:00:00.000Z', end: '2026-10-13T10:00:00.000Z' }),
      ],
      NOW,
    )
    expect(groups.map((g) => g.key)).toEqual(['2026-10-13', '2026-10-12'])
  })

  it('sorts entries within a day newest first', () => {
    const groups = groupEntriesByDay(
      [
        entry({
          id: 'early',
          start: '2026-10-13T09:00:00.000Z',
          end: '2026-10-13T10:00:00.000Z',
        }),
        entry({
          id: 'late',
          start: '2026-10-13T17:00:00.000Z',
          end: '2026-10-13T18:00:00.000Z',
        }),
      ],
      NOW,
    )
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(['late', 'early'])
  })

  // 0006 RP2: the subtotal must equal the sum of the rows beneath it.
  it('sums the day subtotal from its entries', () => {
    const groups = groupEntriesByDay(
      [
        entry({ id: 'a', start: '2026-10-13T09:00:00.000Z', end: '2026-10-13T10:00:00.000Z' }),
        entry({ id: 'b', start: '2026-10-13T11:00:00.000Z', end: '2026-10-13T12:30:00.000Z' }),
      ],
      NOW,
    )
    expect(groups[0]?.totalMs).toBe(2.5 * HOUR)
  })

  // 0003 D2: soft-deleted entries appear in no report, list or chart.
  it('excludes soft-deleted entries entirely', () => {
    const groups = groupEntriesByDay(
      [
        entry({ id: 'a', deletedAt: '2026-10-13T19:00:00.000Z' }),
        entry({ id: 'b', start: '2026-10-13T11:00:00.000Z', end: '2026-10-13T12:00:00.000Z' }),
      ],
      NOW,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(['b'])
    expect(groups[0]?.totalMs).toBe(HOUR)
  })

  // 0004 O2: overlapping entries are both counted rather than clipped, so an
  // implausible day reads as an implausible number instead of a plausible lie.
  it('counts overlapping entries in full', () => {
    const groups = groupEntriesByDay(
      [
        entry({ id: 'a', start: '2026-10-13T09:00:00.000Z', end: '2026-10-13T13:00:00.000Z' }),
        entry({ id: 'b', start: '2026-10-13T12:00:00.000Z', end: '2026-10-13T16:00:00.000Z' }),
      ],
      NOW,
    )
    expect(groups[0]?.totalMs).toBe(8 * HOUR)
  })

  it('includes a running entry at its elapsed duration', () => {
    // `now` as an explicit instant, not a local Date constructor call: mixing the
    // two silently shifts by the UTC offset, which is how this assertion first
    // failed by an hour.
    const groups = groupEntriesByDay(
      [entry({ id: 'run', start: '2026-10-13T09:00:00.000Z', end: null })],
      new Date('2026-10-13T11:00:00.000Z'),
    )
    expect(groups[0]?.totalMs).toBe(2 * HOUR)
  })

  it('reports an unknown day total rather than a wrong one', () => {
    const groups = groupEntriesByDay(
      [
        entry({ id: 'ok', start: '2026-10-13T09:00:00.000Z', end: '2026-10-13T10:00:00.000Z' }),
        entry({
          id: 'bad',
          start: '2026-10-13T12:00:00.000Z',
          end: '2026-10-13T11:00:00.000Z',
        }),
      ],
      NOW,
    )
    expect(groups[0]?.totalMs).toBeNull()
  })

  it('anchors an unparseable start to createdAt rather than dropping the entry', () => {
    const groups = groupEntriesByDay(
      [entry({ id: 'bad', start: 'nonsense', createdAt: '2026-10-13T08:00:00.000Z' })],
      NOW,
    )
    expect(groups[0]?.key).toBe('2026-10-13')
  })

  it('returns nothing for no entries', () => {
    expect(groupEntriesByDay([], NOW)).toEqual([])
  })
})

describe('sortEntriesForList', () => {
  it('sorts newest first', () => {
    const sorted = sortEntriesForList([
      entry({ id: 'a', start: '2026-10-13T09:00:00.000Z' }),
      entry({ id: 'b', start: '2026-10-13T17:00:00.000Z' }),
    ])
    expect(sorted.map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('does not mutate the input', () => {
    const input = [
      entry({ id: 'a', start: '2026-10-13T09:00:00.000Z' }),
      entry({ id: 'b', start: '2026-10-13T17:00:00.000Z' }),
    ]
    sortEntriesForList(input)
    expect(input.map((e) => e.id)).toEqual(['a', 'b'])
  })
})
