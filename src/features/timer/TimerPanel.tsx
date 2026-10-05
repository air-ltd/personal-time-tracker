import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUnloadWarning } from '../timer/useUnloadWarning'
import { useTaxonomy } from '../taxonomy/useTaxonomy'
import { defaultProjectForClient } from '../../storage/taxonomyRepo'
import { ClientForm } from '../taxonomy/ClientForm'
import { entryDurationMs, formatDuration } from '../../domain/time/duration'
import { useEntries } from '../entries/useEntries'
import type { TimerState } from '../timer/useTimer'
import type { Client } from '../../domain/taxonomy/types'
import { PlusIcon } from '../../app/Icons'

/**
 * Timer panel: the one thing a user touches most often.
 *
 * Stopping hands the entry id back so the caller can route to the detail form,
 * where classification happens while the work is still fresh (0001 US2). That
 * keeps this panel a single-purpose control.
 *
 * The timer state is owned by the caller rather than created here, so the whole
 * app shares one subscription and one derived elapsed value.
 */
export interface TimerPanelProps {
  timer: TimerState
  /**
   * Called after the entry has been written, not before.
   *
   * The write is asynchronous, so navigating first races it: the edit route reads the
   * entry back immediately, finds nothing, and renders "Entry not found" — and because
   * the id does not change, the load never runs again and the message sticks even though
   * the entry was saved a moment later.
   */
  onStopped: (id: string) => void | Promise<void>
  /** Stamps the "now" a new client is created with, so a test can fix it. */
  now: Date
  /** Notified after a client is created or edited here, so the caller can refresh. */
  onClientsChanged?: (() => void) | undefined
  /**
   * The client whose entries are shown (item 25).
   *
   * Held by the app rather than here, because the timer card is where the selection is
   * made and the entries card is where it takes effect.
   */
  selectedClientId?: string | null | undefined
  onSelectClient?: ((clientId: string | null) => void) | undefined
}

export function TimerPanel({
  timer,
  onStopped,
  now,
  onClientsChanged,
  selectedClientId,
  onSelectClient,
}: TimerPanelProps) {
  const { running } = timer
  const { dismissed, dismiss } = useUnloadWarning({
    active: running !== null,
    // Resetting the dismissal per timer implements 0004 W6: "don't remind me"
    // applies to this session, not to every session afterwards.
    sessionKey: running?.id ?? null,
  })

  const { clients, projects } = useTaxonomy()
  const { entries } = useEntries()
  const [error, setError] = useState<string | null>(null)
  // `undefined` is "not editing", the empty string is "creating a new one", and anything
  // else is the id being edited. Held here rather than in `ClientList` because the button
  // that opens it sits in the panel header (item 32).
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined)

  /*
   * Time tracked per client, summed over every project that client owns.
   *
   * Computed here rather than per row so each client is a plain lookup. Entries whose
   * project is missing or deleted contribute to nobody: there is no client to attribute
   * them to, and guessing one would put time somewhere the user did not put it.
   */
  const totals = useMemo(() => {
    const projectToClient = new Map(projects.map((row) => [row.id, row.clientId]))
    const sum = new Map<string, number>()
    for (const entry of entries) {
      const clientId =
        entry.projectId === null ? null : (projectToClient.get(entry.projectId) ?? null)
      if (clientId === null || clientId === undefined) continue
      // A corrupt timestamp contributes nothing rather than poisoning the total with NaN.
      const duration = entryDurationMs(entry, now) ?? 0
      sum.set(clientId, (sum.get(clientId) ?? 0) + duration)
    }
    return sum
  }, [entries, projects, now])

  // Anything caught is rendered as text. Handing an `Error` straight to JSX renders
  // "[object Error]", which tells the user nothing about what failed.
  const reportError = useCallback((problem: unknown) => {
    setError(problem instanceof Error ? problem.message : String(problem))
  }, [])

  const noop = () => {}

  const reminder = dismissed ? null : (
    <>
      Closing this tab keeps the timer running.{' '}
      <button type="button" className="link-button" onClick={dismiss}>
        Don&apos;t remind me
      </button>
    </>
  )

  return (
    <section className="panel timer-panel" aria-labelledby="timer-heading">
      {/*
        Item 32: the add button shares the heading's line. It used to sit alone in a row of
        its own above the list, which cost a whole row of height on the card the user looks
        at most often, for a button that is about the list below it.
      */}
      <div className="panel-header timer-panel-header">
        <h2 id="timer-heading">Timer</h2>
        <button
          type="button"
          className="button timer-add-client"
          onClick={() => setEditingId('')}
          aria-label="New client"
          title="New client"
          data-testid="timer-new-client"
        >
          <PlusIcon />
        </button>
      </div>

      <ClientList
        editingId={editingId}
        onEdit={setEditingId}
        clients={clients}
        now={now}
        timer={timer}
        totals={totals}
        onStopped={onStopped}
        onSaved={onClientsChanged}
        onError={reportError}
        reminder={reminder}
        selectedClientId={selectedClientId ?? null}
        onSelectClient={onSelectClient ?? noop}
      />

      {/* Both channels land in the same place: this panel's own failures (a rejected stop,
          a client form that would not save) and the hook's (a start or discard refused).
          The user pressed a button either way, so they get told. */}
      {(error ?? timer.error) !== null && (
        <p className="alert alert-error" role="alert" data-testid="timer-client-error">
          {error ?? timer.error}
        </p>
      )}
    </section>
  )
}

/**
 * The client list, and the whole of the panel's body (items 12, 16 and 19).
 *
 * One list, always rendered, rather than an idle view swapped for a running one. Item 19
 * asks that starting a timer not significantly change the layout: if the panel grows a
 * countdown and loses the client rows, everything below it moves, which is disorienting
 * at exactly the moment the user is starting something. So the running state is expressed
 * *on the client's own line* — its count-up, and Stop in place of Start — and the other
 * rows stay where they were.
 *
 * "No timer running" is not shown when idle (item 19): with no timer there is nothing to
 * report, and the list already says there is nothing running by having no count-up on any
 * line.
 */
function ClientList({
  clients,
  now,
  timer,
  totals,
  onStopped,
  onSaved,
  onError,
  reminder,
  selectedClientId,
  onSelectClient,
  editingId,
  onEdit,
}: {
  /** Typed as the real record, so looking one up here is type-checked. */
  clients: Client[]
  now: Date
  timer: TimerState
  totals: Map<string, number>
  /** Called after the entry is written, so the caller can route to the form (0001 US2). */
  onStopped: (id: string) => void | Promise<void>
  onSaved?: (() => void) | undefined
  onError: (problem: unknown) => void
  /** The unload reminder, owned by the panel because it owns the dismissal. */
  reminder: React.ReactNode
  /** The client whose entries are being shown, or null for all (item 25). */
  selectedClientId: string | null
  /** Selecting is deliberately not starting a timer. */
  onSelectClient: (clientId: string | null) => void
  /** `''` is "creating a new one"; `undefined` is "not editing" (item 32). */
  editingId: string | null | undefined
  onEdit: (next: string | null | undefined) => void
}) {
  const { running, elapsedMs, start, stop, discard } = timer
  const [defaultProjects, setDefaultProjects] = useState<Map<string, string | null> | null>(
    null,
  )
  const ids = clients.map((client) => client.id).join(',')

  useEffect(() => {
    let cancelled = false
    void Promise.all(
      clients.map(async (client) => {
        const project = await defaultProjectForClient(client.id)
        return [client.id, project?.id ?? null] as const
      }),
    ).then((pairs) => {
      if (!cancelled) setDefaultProjects(new Map(pairs))
    })
    return () => {
      cancelled = true
    }
    // Keyed on the ids rather than the objects: `useTaxonomy` hands back a fresh array
    // whenever anything in the taxonomy changes, and re-reading every project on any
    // change would be a storage read per keystroke elsewhere on the page.
  }, [ids]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Which client's line the running timer belongs to.
   *
   * Resolved through the same default-project rule as the Start button, so the line that
   * counts up is the line that would have started it. An uncategorised timer belongs to no
   * client, which is why a timer with no project still has to be stoppable somewhere.
   */
  const activeClientId = useMemo(() => {
    if (running?.projectId == null) return null
    return (
      clients.find((client) => defaultProjects?.get(client.id) === running.projectId)?.id ??
      null
    )
  }, [running, clients, defaultProjects])

  async function handleStop(): Promise<void> {
    if (!running) return
    // Awaited before navigating: the write is asynchronous, and navigating first races the
    // read the edit route immediately performs.
    //
    // Caught because both halves can reject and the consequences differ. If `stop()`
    // fails the entry is not written, `onStopped` never runs, and the user is left on a
    // panel showing a timer that did not stop — which reads as the app having lost their
    // hour. This component already has `reportError` for exactly this and it was not wired
    // to this path; an unhandled rejection also fails a whole test file on an error nothing
    // displays.
    try {
      await stop()
    } catch (problem) {
      reportError(problem)
      return
    }
    try {
      await onStopped(running.id)
    } catch (problem) {
      // The entry *was* written here; only the navigation failed. Say so rather than
      // letting the user think their stop was lost and stop it again.
      reportError(problem)
    }
  }

  return (
    <div className="timer-clients">
      {clients.length === 0 ? (
        <>
          <p className="hint">
            Add a client and its button will start a timer against that client automatically.
          </p>
          {running === null && (
            <button
              type="button"
              className="button button-primary"
              onClick={() => start(null)}
              data-testid="start-uncategorised"
            >
              Start
            </button>
          )}
        </>
      ) : (
        <ul className="timer-client-list">
          {clients.map((client) => {
            const projectId = defaultProjects?.get(client.id) ?? null
            const active = running !== null && client.id === activeClientId
            return (
              <li
                key={client.id}
                className={`timer-client-row${active ? ' timer-client-row-active' : ''}`}
                aria-current={active ? 'true' : undefined}
              >
                {/*
                  The name is a button because it is the selection (item 25): the client is
                  identified here, by pressing its line, so asking the user to pick the same
                  client again from a dropdown on another card was the same question twice.
                  Toggling it off returns to "all clients", which is why this is a toggle
                  and not a radio.
                */}
                <button
                  type="button"
                  className="timer-client-name"
                  aria-pressed={selectedClientId === client.id}
                  onClick={() =>
                    onSelectClient(selectedClientId === client.id ? null : client.id)
                  }
                  data-testid={`select-client-${client.id}`}
                >
                  {client.name}
                  {active && <span className="badge badge-active">running</span>}
                </button>

                {/* The count-up lives on the client's line, not in a separate block. */}
                <span className="timer-client-live" data-testid={`client-live-${client.id}`}>
                  {active && elapsedMs !== null
                    ? formatDuration(elapsedMs, { seconds: true })
                    : formatDuration(totals.get(client.id) ?? 0)}
                </span>

                <span className="timer-client-actions">
                  {active ? (
                    <>
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => void handleStop()}
                        aria-label={`Stop the timer for ${client.name}`}
                      >
                        Stop
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={discard}
                        aria-label={`Discard the timer for ${client.name}`}
                      >
                        Discard
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="button button-primary"
                        /*
                         * Disabled while another client is running rather than hidden: one
                         * timer at a time (0004 T2), and a control that vanishes is a
                         * control whose position cannot be learned.
                         *
                         * Also disabled until the default projects have been read. This was
                         * a real bug found by a test that failed once in six runs: the
                         * lookup is asynchronous, and clicking Start before it resolved
                         * started the timer with no project at all — so the time was
                         * recorded uncategorised for a client that *does* have one. Nothing
                         * said so, and the entry was filed wrongly with no way to tell
                         * afterwards. Unclickable beats silently wrong.
                         */
                        disabled={running !== null || defaultProjects === null}
                        // A client with genuinely no project still starts a timer: the time
                        // is recorded uncategorised rather than refused, because refusing
                        // would lose the work.
                        onClick={() => start(projectId ?? null)}
                        aria-label={`Start a timer for ${client.name}`}
                      >
                        Start
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={() => onEdit(client.id)}
                        aria-pressed={editingId === client.id}
                        aria-label={`Edit client ${client.name}`}
                      >
                        Edit
                      </button>
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {/*
        A timer with no client has no line of its own, so it gets a row here rather than
        being unstoppable. Only reachable by starting before any client existed, or against
        a client whose project is missing.
      */}
      {running !== null && activeClientId === null && (
        <div className="timer-orphan" data-testid="timer-orphan">
          <span className="timer-elapsed" data-testid="timer-elapsed">
            <span className="visually-hidden">Elapsed </span>
            {elapsedMs !== null ? formatDuration(elapsedMs, { seconds: true }) : ''}
          </span>
          <span className="button-row">
            <button
              type="button"
              className="button button-primary"
              onClick={() => void handleStop()}
            >
              Stop
            </button>
            <button type="button" className="button" onClick={discard}>
              Discard
            </button>
          </span>
          {/* The reminder belongs with the controls whoever is watching them, whichever
              row that turned out to be. */}
          {reminder !== null && <p className="hint">{reminder}</p>}
        </div>
      )}

      {/*
        Only rendered while a timer runs, and only as the reminder — 0004 W1 wants the
        user to know a reload will not stop it. The count-up itself is on the client's line
        (item 19), so this does not repeat the number.
      */}
      {running !== null && activeClientId !== null && (
        <p className="hint">
          Started <time dateTime={running.start}>{formatStart(running.start)}</time>. {reminder}
        </p>
      )}

      {editingId !== undefined && (
        <ClientForm
          client={editingId === '' ? undefined : clients.find((row) => row.id === editingId)}
          takenColours={clients.map((row) => row.colour)}
          now={now}
          onDone={() => onEdit(undefined)}
          onSaved={onSaved}
          report={onError}
        />
      )}
    </div>
  )
}

function formatStart(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso))
}
