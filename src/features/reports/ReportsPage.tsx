import { useEffect, useMemo, useState } from 'react'
import { CapacityReport } from '../capacity/CapacityReport'
import { EntryReports } from '../reports/EntryReports'
import { resolveRange, type RangePreset } from '../../domain/reports/ranges'
import { readRoundingIncrementMinutes, readWeekStart } from '../../storage/settingsRepo'
import { useRevision } from '../../storage/useRevision'
import { useEntries } from '../entries/useEntries'
import { useTaxonomy } from '../taxonomy/useTaxonomy'
import { prepareEntries } from '../../domain/reports/report'
import type { ReportEntry } from '../../domain/reports/report'

/**
 * The reports screen (0006, 0013).
 *
 * One range for the whole screen, because two range pickers on one page is a way of
 * showing two figures over different periods and calling them the same thing.
 *
 * The entries are prepared once and shared: every report below agrees about what an
 * entry's duration and rate are, which is what makes a breakdown reconcile with its
 * total (0006 RP2). Preparing them per report would be faster to write and would let
 * two figures quietly disagree.
 */
export interface ReportsPageProps {
  now: Date
}

export function ReportsPage({ now }: ReportsPageProps) {
  const { entries, loading: entriesLoading } = useEntries()
  const { projects, clients, loading: taxonomyLoading } = useTaxonomy()
  const revision = useRevision()

  const [preset, setPreset] = useState<RangePreset>('this-week')
  const [weekStart, setWeekStart] = useState<'monday' | 'sunday'>('monday')
  const [increment, setIncrement] = useState(15)
  const [loaded, setLoaded] = useState(false)

  // The settings are read once and re-read when the revision changes, rather than
  // being read on every render: a report that re-reads IndexedDB while the user is
  // reading it is a report that flickers.
  useEffect(() => {
    let cancelled = false
    void Promise.all([readWeekStart(), readRoundingIncrementMinutes()])
      .then(([start, minutes]) => {
        if (cancelled) return
        setWeekStart(start)
        setIncrement(minutes)
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  const range = useMemo(() => {
    const resolved = resolveRange(preset, now, weekStart)
    // `all-time` has no end, and this report is over a bounded period. It is not
    // offered as a preset here, so this is a guard rather than a branch.
    if (resolved === null || resolved.to === null) return null
    return { from: resolved.from, to: resolved.to }
  }, [preset, now, weekStart])

  const prepared = useMemo(
    () =>
      prepareEntries(entries, { projects, clients, defaultCurrency: 'USD' }, now, increment),
    [entries, projects, clients, now, increment],
  )

  if (entriesLoading || taxonomyLoading || !loaded) {
    return <p className="hint">Loading reports…</p>
  }

  return (
    <>
      <section className="panel" aria-labelledby="report-range-heading">
        <h2 id="report-range-heading">Reports</h2>
        <div className="field">
          <label htmlFor="report-range">Period</label>
          <select
            id="report-range"
            value={preset}
            onChange={(event) => setPreset(event.target.value as RangePreset)}
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="this-week">This week</option>
            <option value="last-week">Last week</option>
            <option value="this-month">This month</option>
            <option value="last-month">Last month</option>
            <option value="last-30-days">Last 30 days</option>
            <option value="last-90-days">Last 90 days</option>
          </select>
        </div>
        <p className="hint">
          Every figure below is for the same period, and every one is worked out from your
          entries when the page is drawn — nothing is stored and nothing goes stale.
        </p>
      </section>

      {range !== null && (
        <>
          <CapacityReport range={range} prepared={prepared} clients={clients} />
          <EntryReports now={now} range={range} prepared={prepared} />
        </>
      )}
    </>
  )
}

export type { ReportEntry }
