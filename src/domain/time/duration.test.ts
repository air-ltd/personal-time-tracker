import { describe, expect, it } from 'vitest'
import {
  entryDurationMs,
  formatDuration,
  fromDurationInputValue,
  fromLocalInputValue,
  toDurationInputValue,
  toLocalInputValue,
} from './duration'
import type { TimeEntry } from '../entries/types'

const HOUR = 3_600_000
const SECOND = 1000
const MINUTE = 60_000

function entry(partial: Partial<TimeEntry>): TimeEntry {
  return {
    id: 'e1',
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
    ...partial,
  }
}

describe('entryDurationMs', () => {
  it('computes a completed span', () => {
    expect(entryDurationMs(entry({}), new Date('2026-10-13T23:00:00Z'))).toBe(HOUR)
  })

  // 0004 D1: a running entry's duration depends on now, so it cannot be stored.
  it('computes a running span against the supplied now', () => {
    expect(entryDurationMs(entry({ end: null }), new Date('2026-10-13T11:30:00Z'))).toBe(
      2.5 * HOUR,
    )
  })

  it('returns null for a corrupt span rather than a negative duration', () => {
    expect(
      entryDurationMs(
        entry({ start: '2026-10-13T10:00:00.000Z', end: '2026-10-13T09:00:00.000Z' }),
        new Date(),
      ),
    ).toBeNull()
  })

  it('returns null for an unparseable timestamp', () => {
    expect(entryDurationMs(entry({ start: 'nonsense' }), new Date())).toBeNull()
  })
})

describe('formatDuration', () => {
  // 0008 F1: one formatter for UI and CSV, so the two cannot disagree.
  it.each([
    [0, '0m'],
    [30_000, '30s'],
    [45 * 1000, '45s'],
    [MINUTE, '1m'],
    [90 * MINUTE, '1h 30m'],
    [HOUR, '1h'],
    [2 * HOUR + 30 * MINUTE, '2h 30m'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })

  // 0008 F2: hours accumulate past a day in report contexts.
  it('accumulates hours beyond 24 rather than rolling into days', () => {
    expect(formatDuration(26 * HOUR)).toBe('26h')
    expect(formatDuration(26 * HOUR + 15 * MINUTE)).toBe('26h 15m')
  })

  // 0006 RD1 / 0008 F3: a real sub-minute span must not read as zero.
  it('never renders a non-zero span as 0m', () => {
    expect(formatDuration(1000)).not.toBe('0m')
    expect(formatDuration(59_000)).toBe('59s')
  })

  it('rounds rather than truncating, rolling minutes into hours', () => {
    expect(formatDuration(89 * MINUTE + 40_000)).toBe('1h 30m')
  })

  it('shows an unknown duration as an em dash, not zero', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(null, { seconds: true })).toBe('—')
  })

  // SPECS/todo.md items 1 and 4: second-level precision where the user watches a
  // timer or is about to save a duration.
  describe('second precision', () => {
    it.each([
      [0, '0:00:00'],
      [1000, '0:00:01'],
      [45_000, '0:00:45'],
      [60_000, '0:01:00'],
      [90_000, '0:01:30'],
      [3_600_000, '1:00:00'],
      [3_723_000, '1:02:03'],
      [26 * 3_600_000, '26:00:00'],
    ])('formats %ims as %s', (ms, expected) => {
      expect(formatDuration(ms, { seconds: true })).toBe(expected)
    })

    it('is unaffected by the compact form, which stays for reports', () => {
      expect(formatDuration(3_723_000)).toBe('1h 2m')
    })

    it('rounds to the nearest second', () => {
      expect(formatDuration(1499, { seconds: true })).toBe('0:00:01')
      expect(formatDuration(1500, { seconds: true })).toBe('0:00:02')
    })
  })
})

describe('duration input', () => {
  it('formats to HH:mm', () => {
    expect(toDurationInputValue(90 * MINUTE)).toBe('01:30')
    expect(toDurationInputValue(HOUR)).toBe('01:00')
    expect(toDurationInputValue(0)).toBe('00:00')
  })

  // 0004 M3: "90" is what someone types for an hour and a half.
  it('parses HH:mm', () => {
    expect(fromDurationInputValue('01:30')).toBe(90 * MINUTE)
    expect(fromDurationInputValue('0:05')).toBe(5 * MINUTE)
  })

  it('parses a bare number as minutes', () => {
    expect(fromDurationInputValue('90')).toBe(90 * MINUTE)
    expect(fromDurationInputValue(' 45 ')).toBe(45 * MINUTE)
  })

  it('rejects nonsense rather than guessing', () => {
    expect(fromDurationInputValue('')).toBeNull()
    expect(fromDurationInputValue('abc')).toBeNull()
    expect(fromDurationInputValue('1:99')).toBeNull()
    expect(fromDurationInputValue('-5')).toBeNull()
  })

  it('round-trips', () => {
    for (const minutes of [0, 1, 59, 60, 61, 600, 1570]) {
      expect(fromDurationInputValue(toDurationInputValue(minutes * MINUTE))).toBe(
        minutes * MINUTE,
      )
    }
  })

  /*
   * Seconds (item 30).
   *
   * A stopped timer is very often under a minute, and rounding that to "00:00" on the edit
   * page invites saving an entry of no length at all. So the field carries seconds when
   * there are any — and the round-trip has to hold for them, or editing and saving an
   * untouched short entry would silently change its length.
   */
  describe('seconds', () => {
    it('shows seconds when the duration has any', () => {
      expect(toDurationInputValue(25 * SECOND)).toBe('00:00:25')
      expect(toDurationInputValue(90 * MINUTE + 5 * SECOND)).toBe('01:30:05')
    })

    it('leaves them out when there are none, so the common case is unchanged', () => {
      expect(toDurationInputValue(90 * MINUTE)).toBe('01:30')
      expect(toDurationInputValue(0)).toBe('00:00')
    })

    it('never renders a short entry as zero', () => {
      // The specific failure this fixes: 25 seconds used to become "00:00".
      expect(toDurationInputValue(25 * SECOND)).not.toBe('00:00')
      expect(fromDurationInputValue(toDurationInputValue(25 * SECOND))).toBe(25 * SECOND)
    })

    it('parses HH:mm:ss', () => {
      expect(fromDurationInputValue('00:00:25')).toBe(25 * SECOND)
      expect(fromDurationInputValue('1:30:05')).toBe(90 * MINUTE + 5 * SECOND)
    })

    it('round-trips sub-minute durations exactly', () => {
      for (const seconds of [1, 9, 25, 59]) {
        expect(fromDurationInputValue(toDurationInputValue(seconds * SECOND))).toBe(
          seconds * SECOND,
        )
      }
    })

    it('still rejects out-of-range seconds rather than carrying them', () => {
      expect(fromDurationInputValue('00:00:99')).toBeNull()
    })
  })
})

describe('local input values', () => {
  it('formats to a datetime-local value', () => {
    expect(toLocalInputValue(new Date(2026, 9, 13, 9, 5, 0))).toBe('2026-10-13T09:05')
  })

  // 0006 DT7: a bare value is local wall-clock, never UTC.
  it('parses a datetime-local value as local time', () => {
    const parsed = fromLocalInputValue('2026-10-13T09:05')
    expect(parsed).not.toBeNull()
    expect(parsed?.getHours()).toBe(9)
    expect(parsed?.getDate()).toBe(13)
  })

  it('returns null for empty or invalid input', () => {
    expect(fromLocalInputValue('')).toBeNull()
    expect(fromLocalInputValue('not-a-date')).toBeNull()
  })
})
