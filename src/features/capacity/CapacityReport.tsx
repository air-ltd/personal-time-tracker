import { useMemo } from 'react'
import { useContracts } from './useContracts'
import { expectedMinutesByWeek, trackedMinutesByWeek } from '../../domain/capacity/expected'
import {
  billableUtilisation,
  formatUtilisation,
  utilisation,
} from '../../domain/capacity/utilisation'
import { formatMinutes } from '../../domain/time/duration'
import type { RangedEntry } from '../../domain/reports/report'
import type { DateRange } from '../../domain/reports/ranges'
import type { Client } from '../../domain/taxonomy/types'

/**
 * Expected against actual (0013 CR2, CR3).
 *
 * The comparison the whole capacity feature exists for: of the hours expected on a
 * client, how many were delivered.
 *
 * Every figure is computed at read time from the entries and the contract (0013 CP1),
 * so an edit to either is reflected immediately — and a contract edit rewrites history,
 * which is why the panel says so rather than hiding it (0013 K7).
 *
 * The range and the prepared entries are passed in rather than read here, so that this
 * panel and the entry-only reports below it agree about what an entry's duration is.
 * Two reports computing it separately is how a breakdown stops reconciling with its
 * total (0006 RP2).
 */
export interface CapacityReportProps {
  /** The instant a running entry's elapsed time is measured against. */
  now: Date
  range: DateRange
  /**
   * The entries in the range, with what each contributed.
   *
   * The range is what makes the two sides of the comparison agree. The expected hours
   * are for the period, so the tracked hours have to be for the same period — summing
   * every entry the client has ever had would compare a lifetime against one week.
   */
  ranged: readonly RangedEntry[]
  /** The clients, so a row can be named rather than identified. */
  clients: readonly Client[]
}

export function CapacityReport({ now, range, ranged, clients }: CapacityReportProps) {
  const nameOf = useMemo(() => {
    const byId = new Map(clients.map((client) => [client.id, client.name]))
    return (id: string) => byId.get(id) ?? id
  }, [clients])

  const { periods, loading } = useContracts()

  const rows = useMemo(() => {
    /*
     * Every client that has either a contract or some time tracked.
     *
     * The union, not just the clients with entries. A client you expect to spend
     * twenty hours a week on, and have spent nothing on, is exactly the row the
     * report exists to show — and leaving it out makes "no time tracked" look
     * identical to "no expectation set".
     */
    const clientIds = new Set<string>()
    for (const { item } of ranged) {
      if (item.clientId !== null) clientIds.add(item.clientId)
    }
    for (const period of periods) {
      if (period.deletedAt === null) clientIds.add(period.clientId)
    }

    return [...clientIds].map((clientId) => {
      // Only what fell inside the period, so the tracked figure and the expected
      // figure are about the same period.
      const clientEntries = ranged.filter(({ item }) => item.clientId === clientId)
      const workedMs = clientEntries.reduce((total, entry) => total + (entry.ms ?? 0), 0)
      const billableMs = clientEntries.reduce(
        (total, entry) => total + (entry.billableMs ?? 0),
        0,
      )
      /*
       * Converted to minutes, because that is the unit the capacity domain works in:
       * `expectedMinutes` returns minutes and the utilisation ratio divides one by the
       * other. Passing milliseconds would have produced a figure thousands of times too
       * large, and it would still have looked like a plausible number.
       *
       * The billable figure is the sum of the *rounded* durations, so it is the same
       * number an invoice line would show rather than a second, differently-rounded
       * version of the hours worked (0006 RD3).
       */
      const worked = {
        minutes: Math.round(workedMs / 60_000),
        billableMinutes: Math.round(billableMs / 60_000),
      }
      const figure = utilisation(range.from, range.to, clientId, periods, worked)
      // 0013 CR3 asks for hour *and* billable utilisation. The billable one is a
      // different question — it is the share of the expected hours that was billable
      // — and it is the one that answers "was the billable work enough?".
      const billable = billableUtilisation(range.from, range.to, clientId, periods, worked)
      return { clientId, figure, billable }
    })
  }, [range, ranged, periods])

  /*
   * Each week, with what was expected and what was done.
   *
   * The two are paired deliberately. A week that shows only what was expected reads
   * as a total, and a total sitting next to the period's totals is a number about a
   * different thing — which is how "a single week" came to be compared against the
   * whole period.
   */
  const weeks = useMemo(() => {
    return [...new Set(rows.map((row) => row.clientId))].map((clientId) => {
      const clientEntries = ranged
        .filter(({ item }) => item.clientId === clientId)
        .map(({ item }) => {
          const start = Date.parse(item.entry.start)
          const end = item.entry.end === null ? now.getTime() : Date.parse(item.entry.end)
          return { startMs: start, endMs: end }
        })
        .filter((span) => Number.isFinite(span.startMs) && Number.isFinite(span.endMs))

      return {
        clientId,
        expected: expectedMinutesByWeek(range.from, range.to, clientId, periods),
        tracked: trackedMinutesByWeek(clientEntries, range.from, range.to),
      }
    })
  }, [range, rows, periods, ranged, now])

  if (loading) return <p className="hint">Loading expected hours…</p>

  if (rows.length === 0) {
    return (
      <section className="panel" aria-labelledby="capacity-heading">
        <h2 id="capacity-heading">Expected against actual</h2>
        <p className="hint">
          No client has expected hours yet. Set them in Settings, and this will compare them
          against what has been tracked.
        </p>
      </section>
    )
  }

  return (
    <section className="panel" aria-labelledby="capacity-heading">
      <h2 id="capacity-heading">Expected against actual</h2>

      <table className="capacity-table">
        <caption className="visually-hidden">
          Expected hours against tracked hours, per client
        </caption>
        <thead>
          <tr>
            <th scope="col">Client</th>
            <th scope="col">Expected</th>
            <th scope="col">Tracked</th>
            <th scope="col">Difference</th>
            <th scope="col">Utilisation</th>
            <th scope="col">Billable</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ clientId, figure, billable }) => (
            <tr key={clientId}>
              <th scope="row">{nameOf(clientId)}</th>
              <td>{figure.expected === null ? '—' : formatMinutes(figure.expected)}</td>
              <td>{formatMinutes(figure.worked)}</td>
              <td>{figure.delta === null ? '—' : formatMinutes(figure.delta)}</td>
              <td>{formatUtilisation(figure.percent)}</td>
              <td>{formatUtilisation(billable.percent)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/*
        Per week, because a contract is expressed in weeks and a month-long total hides
        which week went short (0013 CR2).
      */}
      <div className="capacity-weeks">
        {weeks.map(({ clientId, expected, tracked }) => (
          <div key={clientId} className="capacity-week-group">
            <h3>{nameOf(clientId)}</h3>
            {expected.size === 0 ? (
              <p className="hint">Nothing in this period.</p>
            ) : (
              <table className="capacity-table">
                <caption className="visually-hidden">
                  Expected and tracked hours by week, for {nameOf(clientId)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Week of</th>
                    <th scope="col">Expected</th>
                    <th scope="col">Tracked</th>
                    <th scope="col">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {[...expected.entries()].map(([week, value]) => {
                    const done = tracked.get(week) ?? 0
                    const expectedMinutes = value.minutes
                    const difference = expectedMinutes === null ? null : done - expectedMinutes
                    return (
                      <tr key={week}>
                        <th scope="row">{week}</th>
                        <td>
                          {expectedMinutes === null ? '—' : formatMinutes(expectedMinutes)}
                        </td>
                        <td>{formatMinutes(Math.round(done))}</td>
                        <td>
                          {difference === null ? '—' : formatMinutes(Math.round(difference))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>

      <p className="hint">
        Expected hours are computed from the current contract, so changing a contract changes
        these figures for earlier periods too.
      </p>
    </section>
  )
}
