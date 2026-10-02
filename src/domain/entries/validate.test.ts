import { describe, expect, it } from 'vitest'
import { FUTURE_TOLERANCE_MS, MAX_ENTRY_MS, blockingIssues, validateEntry } from './validate'

const at = (h: number, m = 0): Date => new Date(2026, 9, 13, h, m, 0, 0)
const NOW = at(18, 0)

describe('validateEntry (0004 V1–V5)', () => {
  it('accepts a normal entry', () => {
    const result = validateEntry({ start: at(9), end: at(12), note: '' }, NOW)
    expect(result.ok).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  // V1 / 0003 E2
  it('rejects an end that is not after the start', () => {
    expect(validateEntry({ start: at(9), end: at(9), note: '' }, NOW).ok).toBe(false)
    expect(validateEntry({ start: at(9), end: at(8), note: '' }, NOW).ok).toBe(false)
  })

  // V2: a span over 24 hours is nearly always a typo or an abandoned timer.
  it('rejects an entry longer than 24 hours', () => {
    const result = validateEntry(
      { start: at(9), end: new Date(at(9).getTime() + MAX_ENTRY_MS + 1), note: '' },
      NOW,
    )
    expect(result.ok).toBe(false)
    expect(blockingIssues(result.issues).some((i) => i.code === 'duration_too_long')).toBe(true)
  })

  it('accepts exactly 24 hours', () => {
    const result = validateEntry(
      { start: at(9), end: new Date(at(9).getTime() + MAX_ENTRY_MS), note: '' },
      NOW,
    )
    expect(result.ok).toBe(true)
  })

  // V5: warn, do not block. A 13-hour day is unusual but legitimate.
  it('warns without blocking on a long-but-legal entry', () => {
    const result = validateEntry({ start: at(1), end: at(14), note: '' }, NOW)
    expect(result.ok).toBe(true)
    expect(result.issues.map((i) => i.code)).toContain('duration_long')
  })

  it('warns without blocking on a 13-hour entry', () => {
    const result = validateEntry({ start: at(1), end: at(14), note: '' }, NOW)
    expect(result.ok).toBe(true)
    expect(result.issues).toHaveLength(1)
  })

  // V3
  it('rejects a start in the future beyond the tolerance', () => {
    const future = new Date(NOW.getTime() + FUTURE_TOLERANCE_MS + 60_000)
    const result = validateEntry(
      { start: future, end: new Date(future.getTime() + HOUR), note: '' },
      NOW,
    )
    expect(result.ok).toBe(false)
    expect(blockingIssues(result.issues).some((i) => i.code === 'start_in_future')).toBe(true)
  })

  it('tolerates a small clock skew', () => {
    const skewed = new Date(NOW.getTime() + FUTURE_TOLERANCE_MS - 30_000)
    const result = validateEntry(
      { start: skewed, end: new Date(skewed.getTime() + 30 * 60_000), note: '' },
      NOW,
    )
    expect(result.ok).toBe(true)
  })

  it('rejects an over-long note', () => {
    const result = validateEntry({ start: at(9), end: at(10), note: 'x'.repeat(2001) }, NOW)
    expect(result.ok).toBe(false)
  })

  it('rejects invalid dates', () => {
    const result = validateEntry(
      { start: new Date('nope'), end: new Date('nope'), note: '' },
      NOW,
    )
    expect(result.ok).toBe(false)
  })
})

const HOUR = 3_600_000
