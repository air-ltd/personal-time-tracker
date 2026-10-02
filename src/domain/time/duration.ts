import type { TimeEntry } from '../entries/types'

/**
 * Duration is always derived from timestamps (0004 D1).
 *
 * There is deliberately no accumulating counter anywhere in this codebase. A
 * stored counter cannot survive a reload and drifts the moment a tick is missed;
 * a wall-clock span is simply `end - start`.
 */
export function durationMs(start: Date, end: Date): number {
  return end.getTime() - start.getTime()
}

/**
 * Duration of an entry. A running entry's duration depends on `now`, which is
 * why it is a parameter rather than read from the clock (0002 A2).
 *
 * Returns null for a completed entry whose end precedes its start, so a
 * corrupt record renders as unknown rather than as a negative duration.
 */
export function entryDurationMs(entry: TimeEntry, now: Date): number | null {
  const start = Date.parse(entry.start)
  if (Number.isNaN(start)) return null
  if (entry.end === null) return durationMs(new Date(start), now)
  const end = Date.parse(entry.end)
  if (Number.isNaN(end)) return null
  const ms = end - start
  return ms < 0 ? null : ms
}

const MINUTE = 60_000

/**
 * Shared duration formatting (0008 F1–F3).
 *
 * One function for the UI and both CSV writers, so a row showing `1h 30m` cannot
 * disagree with a cell showing `1:30:00`. Hours accumulate past a day rather
 * than rolling into days, because report contexts sum hours.
 *
 * Sub-minute spans show seconds rather than `0m`: rounding 45 seconds to zero
 * makes a real entry look like a mistake (0006 RD1).
 */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  const negative = ms < 0
  const abs = Math.abs(ms)

  let out: string
  if (abs === 0) {
    out = '0m'
  } else if (abs < MINUTE) {
    out = `${Math.round(abs / 1000)}s`
  } else {
    const totalMinutes = Math.round(abs / MINUTE)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    if (hours === 0) out = `${minutes}m`
    else if (minutes === 0) out = `${hours}h`
    else out = `${hours}h ${minutes}m`
  }
  return negative ? `-${out}` : out
}

/** Wall-clock time in the viewer's locale, for range display (0006 DT5). */
export function formatClock(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

/** Wall-clock date in the viewer's locale, for day group headings. */
export function formatDayHeading(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(value)
}

/** `YYYY-MM-DDTHH:mm` in local time, the value format `datetime-local` expects. */
export function toLocalInputValue(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
    `T${pad(value.getHours())}:${pad(value.getMinutes())}`
  )
}

/**
 * Parse a `datetime-local` value as local wall-clock time (0006 DT7).
 *
 * A bare `2026-10-03` has no zone, so interpreting it as UTC would shift the day
 * for most of the world. `new Date(string)` treats a datetime-local string as
 * local, which is what the user meant.
 */
export function fromLocalInputValue(value: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** `HH:mm` for a duration-first input (0004 M3). */
export function toDurationInputValue(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / MINUTE))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}`
}

/**
 * Parse `HH:mm` into milliseconds. Accepts `90` as 90 minutes, since `90` is what
 * a person types for an hour and a half and a colon-less value is common.
 */
export function fromDurationInputValue(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(trimmed)
  if (match) {
    const hours = Number(match[1])
    const minutes = Number(match[2])
    return (hours * 60 + minutes) * MINUTE
  }
  if (/^\d{1,4}$/.test(trimmed)) {
    return Number(trimmed) * MINUTE
  }
  return null
}
