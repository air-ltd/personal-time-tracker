import { describe, expect, it } from 'vitest'
import {
  addLocalDays,
  bucketMsByDay,
  dayKey,
  dayKeysInRange,
  localDayBounds,
  localDayLengthMs,
  startOfLocalDay,
} from './days'

/**
 * Local-timezone is pinned to Europe/London in vite.config.ts (0006 DT3).
 *
 * Europe/London springs forward at 01:00 GMT on the last Sunday in March and
 * falls back at 02:00 BST on the last Sunday in October. The dates below are
 * those Sundays for 2026: 29 March and 25 October.
 */
const SPRING_FORWARD = '2026-03-29'
const AUTUMN_BACK = '2026-10-25'
const ORDINARY_DAY = '2026-10-13'

describe('startOfLocalDay / addLocalDays', () => {
  it('produces local midnight', () => {
    const start = startOfLocalDay(new Date(2026, 9, 13, 17, 45, 30, 250))
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
    expect(start.getSeconds()).toBe(0)
    expect(dayKey(start)).toBe('2026-10-13')
  })

  it('normalises out-of-range components rather than overflowing', () => {
    const end = addLocalDays(new Date(2026, 9, 31), 1)
    expect(dayKey(end)).toBe('2026-11-01')
  })
})

describe('localDayLengthMs', () => {
  it('is 24 hours on an ordinary day', () => {
    expect(localDayLengthMs(ORDINARY_DAY)).toBe(24 * 3_600_000)
  })

  // 0006 DT3. This is the assertion most likely to be silently worthless, so it
  // is stated as an exact hour count rather than a range.
  it('is 23 hours on a spring-forward day', () => {
    expect(localDayLengthMs(SPRING_FORWARD)).toBe(23 * 3_600_000)
  })

  it('is 25 hours on an autumn-back day', () => {
    expect(localDayLengthMs(AUTUMN_BACK)).toBe(25 * 3_600_000)
  })
})

describe('bucketMsByDay', () => {
  it('puts a single-day span entirely in that day', () => {
    const buckets = bucketMsByDay(
      new Date(2026, 9, 13, 9, 0, 0),
      new Date(2026, 9, 13, 17, 0, 0),
    )
    expect([...buckets]).toEqual([['2026-10-13', 8 * 3_600_000]])
  })

  // 0006 DT2: an entry crossing local midnight is split, not double-counted or
  // dropped.
  it('splits a span across local midnight and conserves total duration', () => {
    const start = new Date(2026, 9, 13, 22, 0, 0)
    const end = new Date(2026, 9, 14, 2, 0, 0)
    const buckets = bucketMsByDay(start, end)

    expect(buckets.get('2026-10-13')).toBe(2 * 3_600_000)
    expect(buckets.get('2026-10-14')).toBe(2 * 3_600_000)
    const total = [...buckets.values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(end.getTime() - start.getTime())
  })

  it('attributes the whole 23 hours of a spring-forward day to that day', () => {
    const { start, end } = localDayBounds(SPRING_FORWARD)
    const buckets = bucketMsByDay(start, end)
    expect([...buckets]).toEqual([[SPRING_FORWARD, 23 * 3_600_000]])
  })

  it('attributes the whole 25 hours of an autumn-back day to that day', () => {
    const { start, end } = localDayBounds(AUTUMN_BACK)
    const buckets = bucketMsByDay(start, end)
    expect([...buckets]).toEqual([[AUTUMN_BACK, 25 * 3_600_000]])
  })

  // The transition day is where a millisecond-arithmetic implementation goes
  // wrong. A span covering all of the spring-forward day must total 23 hours,
  // not 24.
  it('does not lose an hour across the spring-forward boundary', () => {
    const { start, end } = localDayBounds(SPRING_FORWARD)
    const buckets = bucketMsByDay(start, end)
    const total = [...buckets.values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(23 * 3_600_000)
    expect(total).not.toBe(24 * 3_600_000)
  })

  it('returns nothing for an empty or inverted span', () => {
    expect(bucketMsByDay(new Date(2026, 9, 13, 9), new Date(2026, 9, 13, 9)).size).toBe(0)
    expect(bucketMsByDay(new Date(2026, 9, 13, 9), new Date(2026, 9, 13, 8)).size).toBe(0)
  })

  it('handles a multi-day span in one pass', () => {
    const buckets = bucketMsByDay(
      new Date(2026, 9, 12, 23, 0, 0),
      new Date(2026, 9, 15, 1, 0, 0),
    )
    expect(dayKeysInRange(new Date(2026, 9, 12, 23), new Date(2026, 9, 15, 1))).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
    ])
    const total = [...buckets.values()].reduce((a, b) => a + b, 0)
    const expected = new Date(2026, 9, 15, 1).getTime() - new Date(2026, 9, 12, 23).getTime()
    expect(total).toBe(expected)
  })
})
