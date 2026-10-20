import { useMemo, useState } from 'react'
import {
  billableSummary,
  breakdownBy,
  dailyTotals,
  unbilledWork,
  type ReportEntry,
} from '../../domain/reports/report'
import type { RangeMode } from '../../domain/reports/ranges'
import { formatMinutes } from '../../domain/time/duration'
import { PALETTE } from '../../domain/taxonomy/colour'
import { ChartFrame } from './charts/ChartFrame'
import { BarChart } from './charts/BarChart'
import { ShareBar } from './charts/ShareBar'

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
  prepared: readonly ReportEntry[]
  /**
   * How much each entry contributes to the range, already clipped.
   *
   * Passed in rather than computed here, because the invoice needs the same
   * durations — and two reports over different periods would be two answers to one
   * question.
   */
  durations: readonly (number | null)[]
  mode: RangeMode
  onModeChange: (mode: RangeMode) => void
}

type Dimension = 'project' | 'client' | 'tag'

const DIMENSION_LABELS: Record<Dimension, string> = {
  project: 'By project',
  client: 'By client',
  tag: 'By tag',
}

export function EntryReports({ prepared, durations, mode, onModeChange }: EntryReportsProps) {
  const [dimension, setDimension] = useState<Dimension>('project')

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
          onChange={(event) => onModeChange(event.target.value as RangeMode)}
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
            need attention (0013 IE3).
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

          {/*
            The charts, each in a frame that carries a table with the same figures
            (0006 C3). The table is not a description of the chart: it is the chart,
            written out, and it is what a reader who cannot see the bars reads.
          */}
          <ChartFrame
            title="Time by day"
            description="How much was tracked on each day of this period."
            empty={days.length === 0}
            table={
              <table className="capacity-table">
                <caption className="visually-hidden">Time tracked per day</caption>
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr key={day.dayKey}>
                      <th scope="row">{day.dayKey}</th>
                      <td>
                        {day.totalMs === null
                          ? '—'
                          : formatMinutes(Math.round(day.totalMs / 60_000))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <BarChart
              title="Time by day"
              format={(minutes) => formatMinutes(minutes)}
              data={days.map((day, index) => ({
                // The day, shortened to the month and day: a full date on an axis is
                // too wide for the label to be read.
                label: day.dayKey.slice(5),
                minutes: day.totalMs === null ? 0 : Math.round(day.totalMs / 60_000),
                // The shared palette, in order (0002 CH3). A chart that defines its own
                // colours would mean a colour means two things.
                colour: PALETTE[index % PALETTE.length] ?? PALETTE[0],
              }))}
            />
          </ChartFrame>

          <ChartFrame
            title="Where the time went"
            description={`How this period's time was shared between each ${dimension}.`}
            empty={breakdown.groups.length === 0}
            table={
              <table className="capacity-table">
                <caption className="visually-hidden">Time by {dimension}</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Share</th>
                    <th scope="col">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.groups.map((group) => (
                    <tr key={group.key}>
                      <th scope="row">{group.label}</th>
                      <td>
                        {group.percentage === null ? '—' : `${group.percentage.toFixed(1)}%`}
                      </td>
                      <td>
                        {group.totalMs === null
                          ? '—'
                          : formatMinutes(Math.round(group.totalMs / 60_000))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <ShareBar
              title="Where the time went"
              format={(percentage) => `${percentage.toFixed(1)}%`}
              data={breakdown.groups.map((group, index) => ({
                label: group.label,
                percentage: group.percentage ?? 0,
                colour: PALETTE[index % PALETTE.length] ?? PALETTE[0],
              }))}
            />
          </ChartFrame>
        </>
      )}
    </section>
  )
}
