import { useMemo, useState } from 'react'
import { navigate } from '../../app/router'
import type { TimeEntry } from '../../domain/entries/types'
import {
  formatDuration,
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
import { useTaxonomy } from '../taxonomy/useTaxonomy'
import { TagInput } from '../taxonomy/TagInput'
import { formatMinor } from '../../domain/taxonomy/currencies'

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
  /**
   * The instant to validate against and to stamp the entry with.
   *
   * Passed in rather than read from the clock (0002 A2) so validation is testable: the
   * future-start and long-entry rules are relative to now, and a test that cannot fix
   * "now" can only test them by being slow or by being wrong.
   */
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

  const { projects, clients, tags, loading: taxonomyLoading } = useTaxonomy()
  const [projectId, setProjectId] = useState<string | null>(entry?.projectId ?? null)
  const [tagIds, setTagIds] = useState<string[]>(entry?.tagIds ?? [])
  // P5: a project with a default rate implies billable work, so the checkbox starts
  // ticked for it. Held separately from the project so it can still be turned off for a
  // one-off piece of unbilled work on a normally-billable project.
  const [billable, setBillable] = useState(entry?.billable ?? false)
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null)

  const project = projects.find((row) => row.id === projectId) ?? null
  const client = project ? (clients.find((row) => row.id === project.clientId) ?? null) : null

  function chooseProject(id: string | null): void {
    setProjectId(id)
    // P5 applies to a new entry only: re-tick billable when moving onto a rated project,
    // but never overwrite what an existing entry already recorded.
    if (entry === undefined) {
      const chosen = projects.find((row) => row.id === id) ?? null
      setBillable(chosen?.defaultRateMinor !== null && chosen !== null)
    }
  }

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

    // `now` rather than a fresh clock read: this is the instant the entry is judged
    // against and stamped with, and the form already receives it.
    const result = validateEntry({ start, end, note }, now)
    setIssues(result.issues)
    if (!result.ok) return

    setSubmitting(true)
    try {
      if (entry) {
        await updateEntry(
          entry.id,
          {
            start: start.toISOString(),
            end: end.toISOString(),
            note,
            projectId,
            tagIds,
            billable,
          },
          now,
        )
      } else {
        await createManualEntry({ start, end, note, now, projectId, tagIds, billable })
      }
      navigate('/')
    } finally {
      setSubmitting(false)
    }
  }

  // A project whose client has been deleted still has to be selectable, or an existing
  // entry becomes unsaveable the moment a client is removed.
  const orphanedProjects = projects.filter(
    (row) => row.clientId === null || clients.every((row2) => row2.id !== row.clientId),
  )

  const effectiveRate = project?.defaultRateMinor ?? client?.defaultRateMinor ?? null
  const effectiveCurrency = project?.currency ?? client?.currency ?? null
  const billingHint =
    project === null
      ? null
      : effectiveRate === null
        ? `No rate set${client ? ` on ${client.name}` : ''}, so this is not billed unless you add a rate.`
        : `Billed at ${formatMinor(effectiveRate, effectiveCurrency ?? 'USD')} per hour${
            client ? ` (${client.name}’s rate)` : ''
          }.`

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
          That is {formatDuration(durationPreview, { seconds: true })}
          {durationPreview < 3_600_000 && ` (${Math.round(durationPreview / 60000)} minutes)`}
        </p>
      )}

      <div className="field">
        <label htmlFor="entry-project">Project</label>
        <select
          id="entry-project"
          value={projectId ?? ''}
          onChange={(event) =>
            chooseProject(event.target.value === '' ? null : event.target.value)
          }
        >
          {/*
            U1/U2: uncategorised is a real, labelled state rather than an absent selection,
            and the option says plainly what it is, so a missing project cannot be
            mistaken for a deliberate choice of no work.
          */}
          <option value="">No project — uncategorised</option>
          {!taxonomyLoading &&
            clients.map((owner) => {
              const owned = projects.filter((row) => row.clientId === owner.id)
              if (owned.length === 0) return null
              return (
                // N2: projects and clients appear together here, so the client is named in
                // the group heading rather than being implied by order or colour.
                <optgroup key={owner.id} label={owner.name}>
                  {owned.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.archived ? `${row.name} (archived)` : row.name}
                    </option>
                  ))}
                </optgroup>
              )
            })}
          {!taxonomyLoading && orphanedProjects.length > 0 && (
            <optgroup label="No client">
              {orphanedProjects.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.archived ? `${row.name} (archived)` : row.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {billingHint !== null && (
          <p className="hint" data-testid="billing-hint">
            {billingHint}
          </p>
        )}
      </div>

      <TagInput
        tags={tags}
        selected={tagIds}
        onChange={setTagIds}
        now={now}
        report={(problem) =>
          setTaxonomyError(problem instanceof Error ? problem.message : String(problem))
        }
      />

      <div className="field">
        <label htmlFor="entry-billable">
          <input
            id="entry-billable"
            type="checkbox"
            checked={billable}
            onChange={(event) => setBillable(event.target.checked)}
          />{' '}
          Billable
        </label>
      </div>

      <div className="field">
        <label htmlFor="entry-note">Note</label>
        <textarea
          id="entry-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {taxonomyError !== null && (
        <div className="alert alert-error" role="alert" data-testid="taxonomy-error">
          <p>{taxonomyError}</p>
        </div>
      )}

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
        {/*
          Item 33: editing an entry focuses Save, because the overwhelmingly common reason
          to be on this screen is finishing the entry that was just stopped.

          Not on "Add entry" for a new entry, and the difference is deliberate. A new entry
          has no work in it yet — the times are empty — so Save would either fail
          validation immediately or, worse, save an entry with nothing in it. Focusing a
          control that cannot yet succeed is worse than focusing nothing.
        */}
        <button
          type="submit"
          className="button button-primary"
          disabled={submitting}
          autoFocus={entry !== undefined}
          data-testid="entry-submit"
        >
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
