import { useCallback, useMemo, useRef, useState } from 'react'
import { navigate } from '../../app/router'
import type { TimeEntry } from '../../domain/entries/types'
import { HOUR, MINUTE } from '../../domain/time/duration'
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
import { resolveCurrency, resolveRateMinor } from '../../domain/taxonomy/money'
import { useAppDefaultCurrency } from '../settings/useAppDefaultCurrency'

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
  // Whether the user has stated an end at all.
  //
  // 0004 ED1 requires every entry to be editable, "including a running one", and ED2
  // says editing `end` stops it. Those are only both true if saving *without* stating an
  // end leaves it running — otherwise the only way to fix a typo on a running entry is to
  // also state a duration, which stops it as a side effect, and a user who opened the
  // pencil to correct a note got "Enter how long this took" instead of their note saved.
  //
  // Seeded from the record — for a completed entry the duration is prefilled, so the
  // distinction only exists while the record is open-ended — and then stored rather than
  // derived, because it records what the user has *done* rather than what the record
  // currently says. Set when a field that can express an end is edited, and never cleared,
  // because going back to blank is not a statement that it is still running.
  const [endStated, setEndStated] = useState(() => entry !== undefined && entry.end !== null)

  const { projects, clients, tags, loading: taxonomyLoading } = useTaxonomy()
  const appDefaultCurrency = useAppDefaultCurrency()
  const [projectId, setProjectId] = useState<string | null>(entry?.projectId ?? null)
  const [tagIds, setTagIds] = useState<string[]>(entry?.tagIds ?? [])
  /**
   * A tag being created by the input right now, which the save has to wait for.
   *
   * Pressing Save blurs the tag field, and blur commits what was typed. The blur handler is
   * fire-and-forget, so the entry was written before the tag existed: the tag ended up in
   * the taxonomy attached to nothing, and the user had been told nothing. Awaiting this
   * before writing is the difference between "saved with the tag I typed" and a silent
   * loss plus an orphan.
   */
  const pendingTag = useRef<Promise<string[] | null> | null>(null)
  // The tag input hands over whatever it is creating; the ref is ours, not a prop it writes.
  const noteCommittingTag = useCallback((work: Promise<string[] | null>) => {
    pendingTag.current = work
  }, [])
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

  /**
   * What this save will actually write.
   *
   * `null` here is not the same as the `null` that means "this form is incomplete": it
   * means the entry is being saved while still running, which only an existing
   * open-ended entry is allowed to do.
   */
  const savingAsRunning =
    end === null && endStated === false && entry !== undefined && entry.end === null

  const durationPreview =
    start && end && end.getTime() > start.getTime() ? end.getTime() - start.getTime() : null

  /**
   * What the running entry has been going for, shown so the blank duration is not a
   * mystery while it is being edited. Only for an open-ended entry: for a completed one
   * the field is prefilled and this would duplicate it.
   */
  const runningFor =
    entry !== undefined && entry.end === null && start
      ? formatDuration(now.getTime() - start.getTime())
      : null

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!start || (end === null && !savingAsRunning)) {
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
        ...(end === null && !savingAsRunning
          ? [
              {
                field: 'end' as const,
                code: 'end_required',
                message: 'Enter how long this took.',
                severity: 'error' as const,
              },
            ]
          : []),
      ])
      return
    }

    // `now` rather than a fresh clock read: this is the instant the entry is judged
    // against and stamped with, and the form already receives it.
    const result = validateEntry({ start, end, note }, now, { running: savingAsRunning })
    setIssues(result.issues)
    if (!result.ok) return

    // Before the write, not after: the tag must exist and be in the ids for it to be
    // attached. Awaiting alone is not enough — `onChange` schedules a state update, so
    // `tagIds` is still the old value in this closure — hence the resolved selection is
    // used in place of it when there is one.
    let ids = tagIds
    if (pendingTag.current !== null) {
      const pending = pendingTag.current
      pendingTag.current = null
      ids = (await pending) ?? tagIds
    }

    setSubmitting(true)
    try {
      if (entry) {
        await updateEntry(
          entry.id,
          {
            start: start.toISOString(),
            // Null rather than the current instant: stating an end is what stops a
            // running entry (0004 ED2), and this save did not state one.
            end: end === null ? null : end.toISOString(),
            note,
            projectId,
            tagIds: ids,
            billable,
          },
          now,
        )
      } else {
        // Unreachable, and deliberately not a cast. `savingAsRunning` requires
        // `entry !== undefined`, so a new entry reaching here always has an end — and
        // TypeScript cannot see that through the boolean. Asserting it means that if the
        // invariant is ever broken, this fails loudly instead of writing `end: null` into
        // a manual entry and creating a second open-ended row, which 0003 E4 forbids.
        if (end === null) {
          throw new Error('a new manual entry must have an end')
        }
        await createManualEntry({ start, end, note, now, projectId, tagIds: ids, billable })
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

  // Both chains come from the domain, in the order the spec writes them down. This hint
  // used to resolve them inline with a hardcoded `USD` as the last resort, which meant
  // it ignored the app-wide default currency — the setting the user chose one screen
  // away in Settings — and could quote `£` about a rate that would be billed in `JPY`.
  // A rate and a currency resolved separately is how that happens, so `resolveRateMinor`
  // is called with no entry override: this is a new entry, and there is nothing to
  // override yet.
  const effectiveRate = resolveRateMinor({
    rateOverrideMinor: null,
    project,
    client,
  })
  const effectiveCurrency = resolveCurrency(project, client, appDefaultCurrency).code
  const billingHint =
    project === null
      ? null
      : effectiveRate === null
        ? `No rate set${client ? ` on ${client.name}` : ''}, so this is not billed unless you add a rate.`
        : `Billed at ${formatMinor(effectiveRate, effectiveCurrency)} per hour${
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
            onChange={(e) => {
              setDurationValue(e.target.value)
              // Naming a duration is stating an end, which is what stops a running entry
              // (0004 ED2). Setting it even for an invalid value is deliberate: the form
              // then reports what is wrong with the duration rather than silently
              // ignoring what was typed.
              setEndStated(true)
            }}
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
            onChange={(e) => {
              setEndValue(e.target.value)
              setEndStated(true)
            }}
          />
        </div>
      )}

      {durationPreview !== null && (
        <p className="hint" data-testid="duration-preview">
          That is {formatDuration(durationPreview, { seconds: true })}
          {durationPreview < HOUR && ` (${Math.round(durationPreview / MINUTE)} minutes)`}
        </p>
      )}

      {/* A blank duration on a running entry looks like a bug rather than a decision, so
          say what will happen. Without this the honest path — fix the note, leave it
          running — is indistinguishable from having forgotten to fill the field in. */}
      {savingAsRunning && runningFor !== null && (
        <p className="hint" data-testid="running-preview">
          Still running — {runningFor} so far. Enter a duration to stop it.
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
        onCommitting={noteCommittingTag}
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
