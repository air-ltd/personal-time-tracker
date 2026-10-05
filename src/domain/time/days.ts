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

/**
 * Half-open `[start, end)` window for the local week containing `key`, starting Monday.
 *
 * Constructed from local components rather than by adding milliseconds, for the same DST
 * reason as `localDayBounds`: a week is not always 604,800,000 ms.
 */
export function localWeekBounds(key: string): { start: Date; end: Date } {
  const start = startOfLocalDay(localDayBounds(key).start)
  // `getDay()` is 0 for Sunday, so Monday-based weeks need Sunday mapped to 7 rather than
  // 0 — otherwise a Sunday would report itself as the *previous* week's last day and
  // every week would be eight days long.
  const weekday = start.getDay() === 0 ? 7 : start.getDay()
  const monday = addLocalDays(start, 1 - weekday)
  return { start: monday, end: addLocalDays(monday, 7) }
}

/** The Monday of the local week containing `value`, as a day key. */
export function weekKey(value: Date): string {
  return dayKey(localWeekBounds(dayKey(value)).start)
}

/**
 * The same thing from a day key, or `null` when the key is not one.
 *
 * Kept beside `weekKey` rather than re-derived by each caller: grouping a day summary into
 * weeks needs it, and a private copy of the conversion in the summary module was a third
 * spelling of the same idea. The `null` is for keys that came from outside — a corrupt
 * grouping key — because `weekKey` cannot express "not a day key".
 */
export function weekKeyFromDayKey(key: string): string | null {
  if (!isValidDayKey(key)) return null
  return dayKey(localWeekBounds(key).start)
}
