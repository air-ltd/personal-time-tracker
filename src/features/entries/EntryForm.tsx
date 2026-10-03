import { useMemo, useState } from 'react'
import { navigate } from '../../app/router'
import type { TimeEntry } from '../../domain/entries/types'
import {
  fromDurationInputValue,
  fromLocalInputValue,
  toDurationInputValue,
  toLocalInputValue,
} from '../../domain/time/duration'
import {
  blockingIssues,
  validateEntry,
  type ValidationIssue,
} from '../../domain/entries/validate'
import { createManualEntry, updateEntry } from '../../storage/entriesRepo'

/**
 * Create or edit a completed entry.
 *
 * Duration-first is the default input (0004 M3): "about three hours, starting after
 * lunch" is how people recall work, and asking for an end time first invites an
 * error. An explicit end time remains available because some entries are known by
 * their end.
 */
type InputMode = 'duration' | 'end'

export interface EntryFormProps {
  /** Absent for a new entry. */
  entry?: TimeEntry
  now: Date
  onDelete?: (entry: TimeEntry) => void
}

export function EntryForm({ entry, now, onDelete }: EntryFormProps) {
  const [startValue, setStartValue] = useState(() =>
    toLocalInputValue(entry ? new Date(entry.start) : now),
  )
  const [mode, setMode] = useState<InputMode>('duration')
  const [durationValue, setDurationValue] = useState(() =>
    entry && entry.end !== null
      ? toDurationInputValue(new Date(entry.end).getTime() - new Date(entry.start).getTime())
      : '',
  )
  const [endValue, setEndValue] = useState(() =>
    entry && entry.end !== null ? toLocalInputValue(new Date(entry.end)) : '',
  )
  const [note, setNote] = useState(entry?.note ?? '')
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [submitting, setSubmitting] = useState(false)

  const start = useMemo(() => fromLocalInputValue(startValue), [startValue])

  const end = useMemo(() => {
    if (!start) return null
    if (mode === 'duration') {
      const ms = fromDurationInputValue(durationValue)
      if (ms === null) return null
      return new Date(start.getTime() + ms)
    }
    const parsed = fromLocalInputValue(endValue)
    if (!parsed) return null
    // 0004 V1: an end at or before the start is reported by validation, not by
    // silently nudging the value, so the user sees the real number.
    return parsed.getTime() <= start.getTime() ? null : parsed
  }, [start, mode, durationValue, endValue])

  const durationPreview =
    start && end && end.getTime() > start.getTime() ? end.getTime() - start.getTime() : null

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!start || !end) {
      setIssues([
        ...(start
          ? []
          : [
              {
                field: 'start' as const,
                code: 'start_required',
                message: 'Enter a start time.',
                severity: 'error' as const,
              },
            ]),
        ...(end
          ? []
          : [
              {
                field: 'end' as const,
                code: 'end_required',
                message: 'Enter how long this took.',
                severity: 'error' as const,
              },
            ]),
      ])
      return
    }

    const result = validateEntry({ start, end, note }, new Date())
    setIssues(result.issues)
    if (!result.ok) return

    setSubmitting(true)
    try {
      if (entry) {
        await updateEntry(
          entry.id,
          { start: start.toISOString(), end: end.toISOString(), note },
          new Date(),
        )
      } else {
        await createManualEntry({ start, end, note, now: new Date() })
      }
      navigate('/')
    } finally {
      setSubmitting(false)
    }
  }

  const errors = blockingIssues(issues)
  const warnings = issues.filter((i) => i.severity === 'warning')

  return (
    <form
      className="panel entry-form"
      onSubmit={(event) => void onSubmit(event)}
      aria-labelledby="entry-form-heading"
    >
      <h2 id="entry-form-heading">{entry ? 'Edit entry' : 'Add entry'}</h2>

      <div className="field">
        <label htmlFor="entry-start">Start</label>
        <input
          id="entry-start"
          type="datetime-local"
          value={startValue}
          onChange={(e) => setStartValue(e.target.value)}
          required
        />
      </div>

      <fieldset className="field">
        <legend>How long is it?</legend>
        <div className="radio-row">
          <label htmlFor="mode-duration">
            <input
              id="mode-duration"
              type="radio"
              name="mode"
              checked={mode === 'duration'}
              onChange={() => setMode('duration')}
            />{' '}
            Enter a duration
          </label>
          <label htmlFor="mode-end">
            <input
              id="mode-end"
              type="radio"
              name="mode"
              checked={mode === 'end'}
              onChange={() => setMode('end')}
            />{' '}
            Enter an end time
          </label>
        </div>
      </fieldset>

      {mode === 'duration' ? (
        <div className="field">
          <label htmlFor="entry-duration">Duration</label>
          <input
            id="entry-duration"
            type="text"
            inputMode="numeric"
            placeholder="1:30 or 90"
            value={durationValue}
            onChange={(e) => setDurationValue(e.target.value)}
            aria-describedby="duration-hint"
          />
          <p id="duration-hint" className="hint">
            Hours and minutes, or just minutes. 90 means 90 minutes.
          </p>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="entry-end">End</label>
          <input
            id="entry-end"
            type="datetime-local"
            value={endValue}
            onChange={(e) => setEndValue(e.target.value)}
          />
        </div>
      )}

      {durationPreview !== null && (
        <p className="hint" data-testid="duration-preview">
          That is {Math.round(durationPreview / 60000)} minutes.
        </p>
      )}

      <div className="field">
        <label htmlFor="entry-note">Note</label>
        <textarea
          id="entry-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {errors.length > 0 && (
        <div className="alert alert-error" role="alert" data-testid="form-errors">
          <p className="visually-hidden">Cannot save yet</p>
          <ul>
            {errors.map((issue) => (
              <li key={`${issue.code}-${issue.field}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="alert alert-warning" data-testid="form-warnings">
          <ul>
            {warnings.map((issue) => (
              <li key={`${issue.code}-${issue.field}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="button-row">
        <button type="submit" className="button button-primary" disabled={submitting}>
          {entry ? 'Save changes' : 'Add entry'}
        </button>
        <a className="button" href="#/">
          Cancel
        </a>
        {entry && onDelete && (
          <button
            type="button"
            className="button button-danger"
            onClick={() => onDelete(entry)}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  )
}
