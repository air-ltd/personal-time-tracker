import { useMemo, useState } from 'react'
import {
  billableSummary,
  breakdownBy,
  dailyTotals,
  durationInRange,
  unbilledWork,
  type ReportEntry,
} from '../../domain/reports/report'
import type { DateRange, RangeMode } from '../../domain/reports/ranges'
import { formatMinutes } from '../../domain/time/duration'

/**
 * The entry-only reports (0006 R1–R7).
 *
 * Every figure is derived from the entries at the moment the page is drawn, with
 * nothing persisted (0006 RP1) and no rollups (0006 P2).
 *
 * The breakdowns reconcile with their total by construction: the groups come from a
 * partition of the entries, so their sum *is* the total rather than something to be
 * checked afterwards (0006 RP2).
 */
export interface EntryReportsProps {
  now: Date
  range: DateRange
  prepared: readonly ReportEntry[]
}

type Dimension = 'project' | 'client' | 'tag'

const DIMENSION_LABELS: Record<Dimension, string> = {
  project: 'By project',
  client: 'By client',
  tag: 'By tag',
}

export function EntryReports({ now, range, prepared }: EntryReportsProps) {
  const [dimension, setDimension] = useState<Dimension>('project')
  const [mode, setMode] = useState<RangeMode>('clipped')

  /*
   * The durations each entry contributes to this range.
   *
   * `clipped` counts only the time inside the range; `overlap` counts the whole entry
   * when any part of it touches the range (0006 DR5). They are different questions —
   * "how much time did I work in this week" against "which entries touched this week" —
   * and the default is the first, because a total that includes time from outside the
   * range is not a total of the range.
   */
  const durations = useMemo(
    () => prepared.map((item) => durationInRange(item, range, mode, now)),
    [prepared, range, mode, now],
  )

  /*
   * The entries that count, and the duration each one contributes.
   *
   * Kept as two parallel arrays rather than filtering the durations and looking the
   * entry up again: the two must stay in step, and keeping them together is what stops
   * a duration being attributed to the wrong entry.
   */
  const kept = useMemo(() => {
    const entries: ReportEntry[] = []
    const keptDurations: (number | null)[] = []
    prepared.forEach((item, index) => {
      const duration = durations[index] ?? null
      if (duration === null || duration <= 0) return
      entries.push(item)
      keptDurations.push(duration)
    })
    return { entries, durations: keptDurations }
  }, [prepared, durations])

  const breakdown = useMemo(
    () => breakdownBy(kept.entries, dimension, kept.durations),
    [kept, dimension],
  )

  const days = useMemo(() => dailyTotals(kept.entries, kept.durations), [kept])
  const billable = useMemo(() => billableSummary(kept.entries, kept.durations), [kept])
  const unbilled = useMemo(() => unbilledWork(kept.entries), [kept])

  return (
    <section className="panel" aria-labelledby="entry-reports-heading">
      <h2 id="entry-reports-heading">Time tracked</h2>

      <div className="field">
        <label htmlFor="report-mode">How to count</label>
        <select
          id="report-mode"
          value={mode}
          onChange={(event) => setMode(event.target.value as RangeMode)}
        >
          <option value="clipped">Only the time inside the period</option>
          <option value="overlap">Whole entries that overlap the period</option>
        </select>
        <p className="hint">
          An entry that runs past the edge of the period is counted either by the part that
          falls inside it, or by all of it.
        </p>
      </div>

      <div className="field">
        <label htmlFor="report-dimension">Break down by</label>
        <select
          id="report-dimension"
          value={dimension}
          onChange={(event) => setDimension(event.target.value as Dimension)}
        >
          <option value="project">Project</option>
          <option value="client">Client</option>
          <option value="tag">Tag</option>
        </select>
      </div>

      {kept.entries.length === 0 ? (
        <p className="hint">Nothing was tracked in this period.</p>
      ) : (
        <>
          <table className="capacity-table">
            <caption className="visually-hidden">
              {DIMENSION_LABELS[dimension]}, for the selected period
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Time</th>
                <th scope="col">Share</th>
                <th scope="col">Entries</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.groups.map((group) => (
                <tr key={group.key}>
                  <th scope="row">{group.label}</th>
                  <td>
                    {group.totalMs === null
                      ? '—'
                      : formatMinutes(Math.round(group.totalMs / 60_000))}
                  </td>
                  <td>{group.percentage === null ? '—' : `${group.percentage.toFixed(1)}%`}</td>
                  <td>{group.entryCount}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td>
                  {breakdown.totalMs === null
                    ? '—'
                    : formatMinutes(Math.round(breakdown.totalMs / 60_000))}
                </td>
                <td>100.0%</td>
                <td>{kept.entries.length}</td>
              </tr>
            </tfoot>
          </table>

          {/*
            The billable summary, and the unbilled work.

            Kept apart from the breakdown above because they are different kinds of
            figure: one is a share of a total and the other is a list of things that
            need attention (0006 IE3).
          */}
          <h3>Billable</h3>
          <ul className="capacity-week-list">
            <li>
              <span>Billable time</span>
              <span>
                {billable.billableMs === null ? '—' : formatMinutes(billable.billableMs)}
              </span>
            </li>
            <li>
              <span>Non-billable time</span>
              <span>
                {billable.nonBillableMs === null ? '—' : formatMinutes(billable.nonBillableMs)}
              </span>
            </li>
          </ul>

          {unbilled.length > 0 && (
            <>
              <h3>Billable but has no rate</h3>
              <p className="hint">
                These are billable but worth nothing until a rate is set — either on the entry,
                or on its project or client.
              </p>
              <ul className="capacity-week-list">
                {unbilled.map((row) => (
                  <li key={row.entry.id}>
                    <span>
                      {row.projectName} — {row.clientName}
                    </span>
                    <span>{formatMinutes(Math.round(row.durationMs / 60_000))}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {days.length > 0 && (
            <>
              <h3>By day</h3>
              <ul className="capacity-week-list">
                {days.map((day) => (
                  <li key={day.dayKey}>
                    <span>{day.dayKey}</span>
                    <span>
                      {day.totalMs === null
                        ? '—'
                        : formatMinutes(Math.round(day.totalMs / 60_000))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}
