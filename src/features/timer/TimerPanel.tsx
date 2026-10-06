import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUnloadWarning } from '../timer/useUnloadWarning'
import { useTaxonomy } from '../taxonomy/useTaxonomy'
import { defaultProjectForClient } from '../../storage/taxonomyRepo'
import { ClientForm } from '../taxonomy/ClientForm'
import { entryDurationMs, formatDuration } from '../../domain/time/duration'
import { useEntries } from '../entries/useEntries'
import type { TimerState } from '../timer/useTimer'
import type { Client, Project } from '../../domain/taxonomy/types'
import { AddToHeading } from '../../app/AddToHeading'

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

/**
 * A stable default for an optional callback.
 *
 * It used to be a `const noop = () => {}` inside the component, which is a new function on
 * every render. That reached `ClientList` as a fresh prop each time — harmless only because
 * nothing downstream was memoised. A module constant is referentially stable, which is what
 * a default prop should be.
 */
const NOOP = () => {}

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

  /**
   * Project to owning client, computed once for the whole panel.
   *
   * Both consumers need it and they must not be able to disagree: the totals below and the
   * running timer's line in the header are the same question asked twice. They were once
   * answered two different ways — totals through this map, the header through the
   * default-project rule — and a timer started against a client's second project was
   * attributed to one and displayed against the other.
   */
  const projectToClient = useMemo(
    () => new Map(projects.map((row) => [row.id, row.clientId])),
    [projects],
  )

  /*
   * Time tracked per client, summed over every project that client owns.
   *
   * Computed here rather than per row so each client is a plain lookup. Entries whose
   * project is missing or deleted contribute to nobody: there is no client to attribute
   * them to, and guessing one would put time somewhere the user did not put it.
   */
  const totals = useMemo(() => {
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
  }, [entries, projectToClient, now])

  // Anything caught is rendered as text. Handing an `Error` straight to JSX renders
  // "[object Error]", which tells the user nothing about what failed.
  const reportError = useCallback((problem: unknown) => {
    setError(problem instanceof Error ? problem.message : String(problem))
  }, [])

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
      <AddToHeading
        headingId="timer-heading"
        heading="Timer"
        addLabel="New client"
        onAdd={() => setEditingId('')}
        className="panel-header"
        testId="timer-new-client"
      />

      <ClientList
        editingId={editingId}
        onEdit={setEditingId}
        clients={clients}
        now={now}
        timer={timer}
        totals={totals}
        projectToClient={projectToClient}
        projects={projects}
        onStopped={onStopped}
        onSaved={onClientsChanged}
        onError={reportError}
        reminder={reminder}
        selectedClientId={selectedClientId ?? null}
        onSelectClient={onSelectClient ?? NOOP}
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
  projectToClient,
  projects: projectsProp,
}: {
  /** Typed as the real record, so looking one up here is type-checked. */
  clients: Client[]
  now: Date
  timer: TimerState
  totals: Map<string, number>
  /** Project to owning client — the same map the totals use. */
  projectToClient: Map<string, string | null>
  /**
   * Every project in the taxonomy, passed purely so the default-project read below can be
   * keyed on project changes. A client's default is its oldest project (item 12), so
   * adding or deleting one leaves every client id untouched.
   */
  projects: readonly Project[]
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
  // A stop is in flight, so the button cannot be pressed a second time.
  const [stopping, setStopping] = useState(false)
  /**
   * What the effect below is keyed on: the clients *and* their projects.
   *
   * Clients alone were not enough. A client's default project is its oldest project (item
   * 12), so adding or deleting a project changes no client id — the map went stale and
   * Start kept filing time against the project it had read before, while the taxonomy
   * showed something else. The comment below justifies skipping *object* churn, which is a
   * different thing from skipping *data* changes.
   */
  const ids = clients.map((client) => client.id).join(',')
  const projectIds = projectsProp.map((project) => project.id).join(',')

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
  }, [ids, projectIds]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Which client's line the running timer belongs to.
   *
   * Through the running entry's **project**, mapped to that project's client — not through
   * the default-project rule the Start button uses. Matching on the default project meant a
   * timer started against a client's second project resolved to nobody and rendered in the
   * orphan row under the wording "a timer with no client has no line of its own", while the
   * totals above attributed the same work to the client correctly. The header and the
   * totals disagreed about who the work belonged to.
   *
   * The project-to-client map is the one already computed for the totals; reusing it is why
   * the two cannot drift apart again.
   */
  const activeClientId = useMemo(() => {
    const projectId = running?.projectId
    if (projectId == null) return null
    // A project that has been deleted has no client to name, and inventing one would put
    // the time somewhere the user did not put it.
    return projectToClient.get(projectId) ?? null
  }, [running, projectToClient])

  /*
   * Archived clients are not offered a timer (0005 X4).
   *
   * `useTaxonomy` deliberately loads archived records and leaves filtering to the view, and
   * this was the view that never filtered. Offering to start work against a client the user
   * has finished with is how entries end up filed under a client they thought they had
   * closed off.
   *
   * The running timer's own client is exempt. Without that, archiving a client while one of
   * its timers ran made the row vanish from under the user and the timer reappear in the
   * orphan row saying it had no client — while it plainly did, and the user had just
   * archived it themselves. The exemption covers that one client and only while a timer runs
   * against it, so it cannot become a way to start new timers for archived clients.
   */
  const visibleClients = useMemo(
    () => clients.filter((client) => !client.archived || client.id === activeClientId),
    [clients, activeClientId],
  )

  /*
   * The entry just created by stopping, so the panel can point at it (item 48).
   *
   * Stopping used to navigate to the form itself. The entry exists either way — the timer
   * wrote it — so the only thing navigation added was taking the screen away from the timer
   * card, on the theory that classification is freshest immediately (0001 US2). The intent
   * was right and the mechanism was wrong: the user had just pressed Stop, and the screen
   * changing under them is the opposite of staying in control. So the offer to classify is
   * made here instead, where they are, and it expires when the next timer starts.
   */
  const [justStopped, setJustStopped] = useState<string | null>(null)

  async function handleStop(): Promise<void> {
    // Two clicks in one render pass both reach here, and two `stopTimer` calls race: the
    // second reads an entry the first has already ended. The button is also the only thing
    // between the user and that, so it is disabled below while this is in flight.
    if (!running || stopping) return
    setStopping(true)
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
    } finally {
      setStopping(false)
    }
    try {
      setJustStopped(running.id)
      await onStopped(running.id)
    } catch (problem) {
      // The entry *was* written here; only the navigation failed. Say so rather than
      // letting the user think their stop was lost and stop it again.
      reportError(problem)
    }
  }

  return (
    <div className="timer-clients">
      {/*
        Ahead of the empty-client branch, not inside the list. It first rendered inside the
        list, which meant it did not appear at all until the user had set up a client — so
        the person most likely to be stopping their very first timer was the one person who
        never saw the offer to classify it.
      */}
      {visibleClients.length === 0 ? (
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
          {visibleClients.map((client) => {
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
                  {/*
                    No "running" badge (SPECS/todo.md item 42). The ticking elapsed figure on
                    this row already says it, and saying it twice meant the badge was read
                    before the number: the user had to read a word to learn what the digits
                    beside it were for.

                    What the badge carried that the number does not is *which* client, and
                    that is unchanged — the row keeps `aria-current` and the active class, so
                    the state is still conveyed to a screen reader and still drives the
                    highlight. Only the visible duplicate word goes.
                  */}
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
                        disabled={stopping}
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
                        onClick={() => {
                          setJustStopped(null)
                          start(projectId ?? null)
                        }}
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
              disabled={stopping}
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
        Below the list, not above it (SPECS/todo.md item 49).

        Above, pressing Stop added a line of text and pushed *every* client row down the
        card by 47px — so the second client you were aiming at moved while the button was
        being pressed. The browser suite measures it: idle rows at y=170 and y=213, stopped
        at y=217 and y=261.

        A notice about something you just did belongs under the thing you just did. Nothing
        above the list can shift, and the panel simply grows downward.
      */}
      {justStopped !== null && (
        <p className="hint" data-testid="just-stopped">
          Saved as uncategorised.{' '}
          <a href={`#/entries/${justStopped}`}>Add a project, tags or a note</a> if you want to.
        </p>
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

      {/*
        Three states, not two, and the third is the one that used to be missing.

        `editingId` is `undefined` for "not editing", `''` for "creating", and an id
        otherwise. The id was resolved with `clients.find`, and `ClientForm` treats
        `client === undefined` as *create* — so a client deleted from another tab or by a
        sync made the lookup miss, the form rendered in create mode, and pressing Save
        wrote a brand-new client instead of reporting that the original was gone. The user
        would see their client reappear with a new id and its history detached from it.

        So a miss is resolved here and stated, rather than being passed down as `undefined`
        and reinterpreted.
      */}
      {editingId !== undefined &&
        (() => {
          if (editingId === '') {
            return (
              <ClientForm
                client={undefined}
                takenColours={clients.map((row) => row.colour)}
                now={now}
                onDone={() => onEdit(undefined)}
                onSaved={onSaved}
                report={onError}
              />
            )
          }
          const editing = clients.find((row) => row.id === editingId)
          if (editing === undefined) {
            return (
              <p className="alert alert-error" role="alert" data-testid="client-gone">
                That client no longer exists — it was deleted, perhaps on another device.
                Nothing was changed.
              </p>
            )
          }
          return (
            <ClientForm
              client={editing}
              takenColours={clients.map((row) => row.colour)}
              now={now}
              onDone={() => onEdit(undefined)}
              onSaved={onSaved}
              report={onError}
            />
          )
        })()}
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
