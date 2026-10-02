import type { EntryDraft } from './types'

/**
 * Entry validation (0004 V1–V5).
 *
 * Validation is separated from storage and from the form so the same rules apply
 * to timer output, manual entry, and any future import path.
 */

export const MAX_ENTRY_MS = 24 * 60 * 60 * 1000
export const LONG_ENTRY_MS = 12 * 60 * 60 * 1000
/** Small tolerance to absorb clock skew (0004 V3). */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000
export const MAX_NOTE_LENGTH = 2000

export type Severity = 'error' | 'warning'

export interface ValidationIssue {
  field: 'start' | 'end' | 'note'
  code: string
  message: string
  severity: Severity
}

export interface ValidatedEntry {
  ok: boolean
  issues: ValidationIssue[]
}

/**
 * Check an entry's shape against the rules.
 *
 * `now` is a parameter so tests pin time (0002 A2). Warnings do not block saving:
 * a 13-hour entry is usually legitimate, whereas a 25-hour one is nearly always a
 * typo or an unattended timer.
 */
export function validateEntry(
  input: { start: Date; end: Date; note: string },
  now: Date,
): ValidatedEntry {
  const issues: ValidationIssue[] = []
  const { start, end } = input

  if (Number.isNaN(start.getTime())) {
    issues.push({
      field: 'start',
      code: 'start_invalid',
      message: 'Start is not a valid time.',
      severity: 'error',
    })
  }
  if (Number.isNaN(end.getTime())) {
    issues.push({
      field: 'end',
      code: 'end_invalid',
      message: 'End is not a valid time.',
      severity: 'error',
    })
  }

  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    const ms = end.getTime() - start.getTime()

    // 0004 V1 / 0003 E2: end must be strictly after start.
    if (ms <= 0) {
      issues.push({
        field: 'end',
        code: 'end_not_after_start',
        message: 'End must be after start.',
        severity: 'error',
      })
    } else if (ms > MAX_ENTRY_MS) {
      // 0004 V2
      issues.push({
        field: 'end',
        code: 'duration_too_long',
        message: `An entry cannot be longer than 24 hours. This one is ${(ms / 3_600_000).toFixed(1)} hours, which usually means a typo or a timer left running.`,
        severity: 'error',
      })
    } else if (ms > LONG_ENTRY_MS) {
      // 0004 V5: warn, do not block.
      issues.push({
        field: 'end',
        code: 'duration_long',
        message: `That is a ${(ms / 3_600_000).toFixed(1)}-hour entry. Save it only if the time really is right.`,
        severity: 'warning',
      })
    }
  }

  // 0004 V3
  if (!Number.isNaN(start.getTime()) && start.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    issues.push({
      field: 'start',
      code: 'start_in_future',
      message: 'Start is in the future.',
      severity: 'error',
    })
  }

  if (input.note.length > MAX_NOTE_LENGTH) {
    issues.push({
      field: 'note',
      code: 'note_too_long',
      message: `Note is limited to ${MAX_NOTE_LENGTH} characters.`,
      severity: 'error',
    })
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues }
}

export function blockingIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((i) => i.severity === 'error')
}

export function draftFrom(input: { start: Date; end: Date; note: string }): EntryDraft {
  return { start: input.start, end: input.end, note: input.note }
}
