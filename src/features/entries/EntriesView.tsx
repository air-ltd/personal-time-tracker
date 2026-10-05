import { useMemo, useState } from 'react'
import { useEntries } from '../entries/useEntries'
import { useTaxonomy } from '../taxonomy/useTaxonomy'
import { EntryList } from '../entries/EntryList'
import { EntrySummary, PeriodControl } from '../entries/EntrySummary'
import { useTimer } from '../timer/useTimer'
import { useEntryPeriod } from '../entries/useEntryPeriod'
import { ChevronIcon } from '../../app/Icons'

/**
 * The entries card (items 21, 22, 25 and 28).
 *
 * Item 25 moved the client filter out of here and into the timer card, because the two were
 * asking the same question twice: the user identifies a client by pressing its timer
 * button, and then had to say the same name again in a dropdown. The timer card is where
 * the clients already are, so that is where the selection lives; `clientId` arrives here as
 * a prop and this card has no opinion about how it was chosen.
 *
 * What is left here is what belongs to the entries: the period (moved up into the header
 * row, per item 25) and the collapse control. Neither is about choosing a client, and both
 * are about the entries, so they sit with them.
 */
export interface EntriesViewProps {
  now: Date
  /** The client to show, or null for all. Null is also what a running timer overrides. */
  selectedClientId: string | null
}

export function EntriesView({ now, selectedClientId }: EntriesViewProps) {
  const { entries, loading } = useEntries()
  const { projects, clients } = useTaxonomy()
  const { running } = useTimer()
  const [period, setPeriod] = useEntryPeriod()
  const [collapsed, setCollapsed] = useState(false)

  const projectById = useMemo(() => new Map(projects.map((row) => [row.id, row])), [projects])

  /**
   * The client the running timer belongs to, or null.
   *
   * Resolved through the project so it agrees with the timer card's own rule for which line
   * is active. A timer with no project — uncategorised, or a client whose project is
   * missing — belongs to no client and filters nothing.
   */
  const runningClientId = useMemo(() => {
    if (running?.projectId == null) return null
    return projectById.get(running.projectId)?.clientId ?? null
  }, [running, projectById])

  // A running timer wins over the selection: it is an assertion about the current hour, and
  // the control that made the selection says so rather than letting the list change quietly.
  const clientId = runningClientId ?? selectedClientId

  const visible = useMemo(
    () =>
      entries.filter((entry) => {
        if (clientId === null) return true
        if (entry.projectId === null) return false
        return projectById.get(entry.projectId)?.clientId === clientId
      }),
    [entries, clientId, projectById],
  )

  const selectedName =
    clientId === null ? null : (clients.find((client) => client.id === clientId)?.name ?? null)

  return (
    <div className="panel">
      <div className="panel-header entries-header">
        <h2>Entries</h2>

        {/*
          Which client is showing, in the header rather than on a line of its own.

          It was below the header, where it read as a note about the list rather than as
          part of the card's own state — and it cost a row of height on a card whose heading
          already says what the card is.

          Kept visible when collapsed: it is still true, and a collapsed card is exactly the
          case where "what am I looking at" is the question being asked.
        */}
        {selectedName !== null && (
          <p className="entries-filter-note" data-testid="entries-filter-note">
            Showing {selectedName}.{runningClientId !== null && ' A timer is running for it.'}
          </p>
        )}

        {/*
          The controls are pinned to the third grid column (item 34).

          With the heading, the note and the controls sharing one flex row, showing the
          filter note pushed the period selector sideways — so the control the user is about
          to press moved because of something they did to a *different* control, on a
          different card. A fixed column means its position depends only on the window.
        */}
        <div className="entries-header-controls">
          {/* Item 25: the period belongs with the entries it changes. */}
          <PeriodControl value={period} onChange={setPeriod} />

          <button
            type="button"
            className="button entries-collapse"
            aria-expanded={!collapsed}
            aria-controls="entries-body"
            onClick={() => setCollapsed((value) => !value)}
            data-testid="entries-collapse"
          >
            {/*
              Rotated rather than swapped for a different glyph, so the control looks the
              same before and after and the affordance is the direction it will move.
            */}
            <ChevronIcon />
            <span className="visually-hidden">
              {collapsed ? 'Expand entries' : 'Collapse entries'}
            </span>
          </button>
        </div>
      </div>

      {/*
        Collapsed keeps the header and the totals, not everything. A collapsed card that
        hides the figures too is the one place the user can be sure of glancing at.
      */}
      <div id="entries-body" hidden={collapsed}>
        {/*
          Nothing recorded at all is stated once, whatever the period: an empty summary reads
          as "nothing in this period", which is a different and more alarming claim than "no
          work recorded yet" (0007 FB-3).
        */}
        {entries.length === 0 && !loading ? (
          <p className="hint" data-testid="empty-state">
            No entries yet. Start the timer above, or add one by hand.
          </p>
        ) : period === 'all' ? (
          /*
           * All-entries keeps the list rather than summarising: a total for everything is
           * the same number the list already ends with, and the list is what you act on.
           */
          <EntryList now={now} entries={visible} />
        ) : (
          <EntrySummary
            now={now}
            entries={visible}
            projects={projects}
            clients={clients}
            period={period}
          />
        )}
      </div>

      {!collapsed && loading && <p className="hint">Loading…</p>}
    </div>
  )
}
