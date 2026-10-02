/**
 * Local calendar-day arithmetic (0006 DT1–DT3).
 *
 * Every function here constructs boundaries from local date components rather than
 * adding milliseconds. That is what makes DST correct: a local day is not always
 * 86,400,000 ms, so `dayStart + 86400000` lands at 01:00 or 23:00 on a transition
 * day and every downstream total is an hour out.
 */

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

/** Local `YYYY-MM-DD`, used to group and label days. */
export function dayKey(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

/** Midnight at the start of the given local day. */
export function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0)
}

/**
 * Midnight `days` after the given local day.
 *
 * Uses the Date constructor's normalisation of out-of-range components, which is
 * DST-safe precisely because the result is re-resolved in local time.
 */
export function addLocalDays(value: Date, days: number): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days, 0, 0, 0, 0)
}

/** Half-open `[start, end)` window for a local day, per 0006 DT2. */
export function localDayBounds(key: string): { start: Date; end: Date } {
  const match = DAY_KEY.exec(key)
  if (!match) throw new Error(`Invalid day key: ${key}`)
  const start = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0)
  return { start, end: addLocalDays(start, 1) }
}

/** Milliseconds in the local day identified by `key`. 23 or 25 on transitions. */
export function localDayLengthMs(key: string): number {
  const { start, end } = localDayBounds(key)
  return durationOf(start, end)
}

function durationOf(start: Date, end: Date): number {
  return end.getTime() - start.getTime()
}

/**
 * Split `[start, end)` into per-day milliseconds, keyed by `dayKey`.
 *
 * Each entry contributes only the portion inside each day, so an entry spanning
 * local midnight is neither double-counted nor dropped. This is the whole reason
 * totals cannot be computed as `range * minutesPerDay` (0006 DT2, 0013 CP-A1).
 */
export function bucketMsByDay(start: Date, end: Date): Map<string, number> {
  const buckets = new Map<string, number>()
  if (end.getTime() <= start.getTime()) return buckets

  let dayStart = startOfLocalDay(start)
  while (dayStart.getTime() < end.getTime()) {
    const dayEnd = addLocalDays(dayStart, 1)

    const overlapStart = Math.max(start.getTime(), dayStart.getTime())
    const overlapEnd = Math.min(end.getTime(), dayEnd.getTime())
    if (overlapEnd > overlapStart) {
      const key = dayKey(dayStart)
      buckets.set(key, (buckets.get(key) ?? 0) + (overlapEnd - overlapStart))
    }

    dayStart = dayEnd
  }
  return buckets
}

/** Every local day key touched by `[start, end)`, in ascending order. */
export function dayKeysInRange(start: Date, end: Date): string[] {
  return [...bucketMsByDay(start, end).keys()]
}

export function isValidDayKey(value: string): boolean {
  return DAY_KEY.test(value)
}
