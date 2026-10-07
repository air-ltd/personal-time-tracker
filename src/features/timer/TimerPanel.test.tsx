import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { TimerPanel } from './TimerPanel'
import { installTestDb } from '../../test/harness'
import {
  createClient,
  createClientWithDefaultProject,
  createProject,
  listProjects,
  setArchived,
} from '../../storage/taxonomyRepo'
import { createManualEntry, makeEntry, softDeleteEntry } from '../../storage/entriesRepo'
import type { TimerState } from './useTimer'
import type { Client, Project } from '../../domain/taxonomy/types'

/**
 * The timer panel's client list (items 12 and 16 of `SPECS/todo.md`).
 *
 * What matters here is which project the time lands on. Pressing "Start" for a client and
 * then finding the entry uncategorised would be worse than having no per-client buttons at
 * all, because the user would believe it was filed correctly.
 */

const NOW = new Date('2026-10-13T18:00:00.000Z')
const T0 = new Date('2026-10-13T09:00:00.000Z')

let user: UserEvent

beforeEach(() => {
  installTestDb()
  user = userEvent.setup()
})

/** A timer that records what it was asked to do, so the assertion can read it back. */
function timerHarness(): TimerState & { started: (string | null | undefined)[] } {
  const started: (string | null | undefined)[] = []
  return {
    started,
    running: null,
    elapsedMs: null,
    error: null,
    start: (projectId?: string | null) => started.push(projectId),
    stop: async () => {},
    discard: () => {},
  }
}

/**
 * Renders the panel, optionally with a client selected.
 *
 * `selectedClientId` is what item 61 keys the project list on, so the tests for it need to
 * be able to select one; the default of null is "all clients", which is every other test.
 */
function renderPanel(
  timer = timerHarness(),
  now = NOW,
  selectedClientId: string | null = null,
) {
  render(
    <TimerPanel
      timer={timer}
      onStopped={() => {}}
      now={now}
      selectedClientId={selectedClientId}
      onSelectClient={() => {}}
    />,
  )
  return timer
}

/** The list row for a client, located by its start button's accessible name. */
async function clientRow(name: string): Promise<HTMLElement> {
  const button = await screen.findByRole('button', { name: `Start a timer for ${name}` })
  const row = button.closest('li')
  if (row === null) throw new Error(`no row for client "${name}"`)
  return row
}

describe('starting a timer per client (item 12)', () => {
  it('records against that client’s default project', async () => {
    const { client, defaultProject } = await createClientWithDefaultProject({
      name: 'Acme Ltd',
      currency: 'GBP',
      now: NOW,
    })

    const timer = renderPanel()
    const row = await clientRow('Acme Ltd')
    const start = within(row).getByRole('button', { name: 'Start a timer for Acme Ltd' })
    // The default-project lookup is asynchronous, so the button is disabled until it
    // lands. Clicking before that filed the time uncategorised.
    await waitFor(() => {
      expect(start).toBeEnabled()
    })
    await user.click(start)

    expect(timer.started).toEqual([defaultProject.id])
    expect((await listProjects()).find((row2) => row2.id === defaultProject.id)?.clientId).toBe(
      client.id,
    )
  })

  it('creates a default project with each client', async () => {
    const acme = await createClientWithDefaultProject({
      name: 'Acme Ltd',
      currency: 'GBP',
      now: NOW,
    })
    const other = await createClientWithDefaultProject({
      name: 'Other Ltd',
      currency: 'EUR',
      now: NOW,
    })

    // One per client, and the *same* name for both: project names are unique within a
    // client, not across all projects (0005 P2, revised). That is what lets every client's
    // project list read the same way, and it is why a fixed name no longer needs
    // suffixing to avoid a spurious collision.
    const projects = await listProjects()
    expect(projects).toHaveLength(2)
    expect(projects.map((row) => row.name)).toEqual(['General', 'General'])
    expect(projects.find((row) => row.clientId === acme.client.id)?.name).toBe('General')
    expect(projects.find((row) => row.clientId === other.client.id)?.name).toBe('General')
  })

  it('adds a client from the timer panel', async () => {
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'New client' }))
    await user.type(screen.getByLabelText('Client name'), 'New Co')
    await user.click(screen.getByTestId('client-form-submit'))

    // The new client appears as its own row, ready to be started against.
    expect(await screen.findByText('New Co', { selector: '.timer-client-name' })).toBeVisible()
  })

  it('offers no Edit button on a client row (item 63)', async () => {
    // Editing a client moved to Settings. The card the user touches most often was carrying
    // a second, quieter action on every row, and removing it is what lets the action slot
    // hold one right-aligned control.
    await createClientWithDefaultProject({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    renderPanel()

    await screen.findByText('Acme Ltd', { selector: '.timer-client-name' })
    expect(screen.queryByRole('button', { name: /Edit client/ })).toBeNull()
  })

  it('still creates a client from the timer panel', async () => {
    // The heading's add button is untouched by item 63 — only the per-row Edit went.
    renderPanel()

    await user.click(screen.getByTestId('timer-new-client'))
    const field = screen.getByLabelText('Client name')
    await user.type(field, 'Fresh Co')
    await user.click(screen.getByTestId('client-form-submit'))

    expect(
      await screen.findByText('Fresh Co', { selector: '.timer-client-name' }),
    ).toBeVisible()
  })

  it('reports a rejected client rather than closing the form', async () => {
    await createClientWithDefaultProject({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'New client' }))
    await user.type(screen.getByLabelText('Client name'), 'acme ltd')
    await user.click(screen.getByTestId('client-form-submit'))

    expect(await screen.findByTestId('timer-client-error')).toHaveTextContent(/already exists/i)
  })
})

describe('layout (item 32)', () => {
  it('puts the add button on the same line as the Timer heading', () => {
    renderPanel()

    // Item 32: it used to sit alone in a row of its own above the list, costing a row of
    // height on the card the user looks at most often.
    const heading = screen.getByRole('heading', { name: 'Timer' })
    const header = heading.closest('div')
    if (header === null) throw new Error('no timer header')
    expect(within(header).getByRole('button', { name: 'New client' })).toBeInTheDocument()
    expect(screen.queryByTestId('timer-clients-header')).toBeNull()
  })

  it('still opens the client form from there', async () => {
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'New client' }))
    expect(await screen.findByLabelText('Client name')).toBeInTheDocument()
  })
})

/**
 * Which client's line a running timer belongs to.
 *
 * It was resolved by matching the running project against each client's *default* project,
 * while the totals beside it resolved project → client directly. A timer started against a
 * client's second project therefore counted towards that client in the total and rendered in
 * the orphan row under the wording "a timer with no client has no line of its own" — the
 * header and the totals disagreeing about who the work belonged to.
 *
 * The timer here is the harness, which does not actually run a cycle, so the running entry
 * is supplied directly rather than produced by pressing Start.
 */
describe('archived clients (0005 X4, todo 37)', () => {
  it('does not offer a timer for an archived client', async () => {
    // `useTaxonomy` loads archived records on purpose and leaves filtering to each view, and
    // TimerPanel was the one view that never filtered. Offering to start work against a
    // client the user has finished with is how entries end up filed under a client they
    // thought they had closed off.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Work', clientId: client.id, now: T0 })
    const timer = timerHarness()
    renderPanel(timer)

    await screen.findByRole('button', { name: 'Start a timer for Acme Ltd' })
    await setArchived('client', client.id, true, T0)

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Start a timer for Acme Ltd' })).toBeNull(),
    )
  })

  it('keeps a running client visible after it is archived', async () => {
    // The exemption that makes the filter safe. Without it, archiving a client mid-timer
    // made its row vanish and the timer reappear in the orphan row claiming it has no
    // client — while it plainly did, and the user had just archived it themselves.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    const project = await createProject({ name: 'Work', clientId: client.id, now: T0 })
    const timer = timerHarness()
    const onStopped = () => {}
    const view = render(<TimerPanel timer={timer} onStopped={onStopped} now={NOW} />)

    // Started by hand rather than by pressing Start, because the harness records what it
    // was asked to start but never becomes running — and it is the running state the
    // exemption keys on.
    const started = new Date('2026-10-13T09:00:00.000Z')
    timer.running = {
      id: 'running-1',
      projectId: project.id,
      tagIds: [],
      start: started.toISOString(),
      end: null,
      note: '',
      billable: false,
      rateOverrideMinor: null,
      source: 'timer',
      createdAt: started.toISOString(),
      updatedAt: started.toISOString(),
      deletedAt: null,
    }
    view.rerender(<TimerPanel timer={timer} onStopped={onStopped} now={NOW} />)

    await screen.findByRole('button', { name: 'Stop the timer for Acme Ltd' })

    await setArchived('client', client.id, true, T0)

    // Still there, still showing Stop — not orphaned, and not offering a new Start.
    expect(
      await screen.findByRole('button', { name: 'Stop the timer for Acme Ltd' }),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('timer-orphan')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start a timer for Acme Ltd' })).toBeNull()
  })
})

describe('the running client (SPECS/todo.md item 42)', () => {
  it('shows the ticking timer without a "running" badge', async () => {
    // The badge said "running" beside a figure that was already counting up, so the word
    // was read first and the number read as decoration. What the badge carried that the
    // number does not — which client — has to survive.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Work', clientId: client.id, now: T0 })
    const timer = timerHarness()
    const onStopped = () => {}
    const view = render(<TimerPanel timer={timer} onStopped={onStopped} now={NOW} />)

    const started = new Date('2026-10-13T09:00:00.000Z')
    const [project] = await listProjects({ clientId: client.id })
    if (project === undefined) throw new Error('the project should exist by now')
    timer.running = {
      id: 'running-1',
      projectId: project.id,
      tagIds: [],
      start: started.toISOString(),
      end: null,
      note: '',
      billable: false,
      rateOverrideMinor: null,
      source: 'timer',
      createdAt: started.toISOString(),
      updatedAt: started.toISOString(),
      deletedAt: null,
    }
    // The harness does not compute elapsed time, and the live figure falls back to the
    // client's running total when it is null — which is what makes this assertion about the
    // ticking number rather than about the fallback.
    timer.elapsedMs = 3_661_000
    view.rerender(<TimerPanel timer={timer} onStopped={onStopped} now={NOW} />)

    const row = await screen.findByRole('button', { name: 'Stop the timer for Acme Ltd' })
    const listRow = row.closest('li')
    if (listRow === null) throw new Error('no row for the running client')

    // No badge.
    expect(within(listRow).queryByText('running')).toBeNull()
    expect(listRow.querySelector('.badge-active')).toBeNull()
    // The figure that replaced it is still there and counting.
    expect(listRow.querySelector('.timer-client-live')?.textContent).toMatch(/\d+:\d{2}:\d{2}/)
    // And "which client" is still conveyed, for a screen reader and for the highlight.
    expect(listRow.getAttribute('aria-current')).toBe('true')
    // The active class is on the row, inside the item that also carries the projects.
    expect(listRow.querySelector('.timer-client-row')?.className).toContain(
      'timer-client-row-active',
    )
  })
})

describe('stopping a timer', () => {
  it('ignores a second press while the first stop is still writing', async () => {
    // A `stop` that has not resolved yet is the whole point: two clicks in one render pass
    // both see the timer as running, and two `stopTimer` calls race on the same entry. The
    // second read finds the entry the first already ended.
    let releaseStop: (() => void) | undefined
    const timer = timerHarness()
    timer.stop = () =>
      new Promise<void>((resolve) => {
        releaseStop = resolve
      })
    let stopped = 0
    const onStopped = () => void stopped++
    const view = render(<TimerPanel timer={timer} onStopped={onStopped} now={NOW} />)

    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    await createProject({ name: 'Work', clientId: client.id, now: NOW })
    const started = new Date('2026-10-13T09:00:00.000Z')
    const [project] = await listProjects({ clientId: client.id })
    if (project === undefined) throw new Error('the project should exist by now')
    timer.running = {
      id: 'running-1',
      projectId: project.id,
      tagIds: [],
      start: started.toISOString(),
      end: null,
      note: '',
      billable: false,
      rateOverrideMinor: null,
      source: 'timer',
      createdAt: started.toISOString(),
      updatedAt: started.toISOString(),
      deletedAt: null,
    }
    view.rerender(<TimerPanel timer={timer} onStopped={onStopped} now={NOW} />)

    const button = await screen.findByRole('button', { name: 'Stop the timer for Acme Ltd' })
    await userEvent.setup().dblClick(button)

    expect(button).toBeDisabled()
    releaseStop?.()
    await waitFor(() => expect(stopped).toBe(1))
  })
})

describe('attributing a running timer (0005 N2)', () => {
  it('finds the client through the running project, not through the default project', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    // Two projects, because "the default" is the oldest (item 12) — with only one, the
    // second would be the default and the test would prove nothing.
    await createProject({
      name: 'Default',
      clientId: client.id,
      now: new Date('2026-10-01T09:00:00.000Z'),
    })
    const other = await createProject({ name: 'Second', clientId: client.id, now: NOW })
    const started = new Date('2026-10-13T09:00:00.000Z')
    const timer = timerHarness()
    timer.running = {
      id: 'running-1',
      projectId: other.id,
      tagIds: [],
      start: started.toISOString(),
      end: null,
      note: '',
      billable: false,
      rateOverrideMinor: null,
      source: 'timer',
      createdAt: started.toISOString(),
      updatedAt: started.toISOString(),
      deletedAt: null,
    }

    renderPanel(timer)

    // Waited on the client's own control, not on the orphan: the taxonomy loads
    // asynchronously, so `findByTestId('timer-orphan')` would have matched the orphan
    // present in the very first render — before the projects the fix reads had arrived —
    // and answered for the wrong reason. A running row shows Stop rather than Start, so
    // this waits on the selection button instead.
    const select = await screen.findByTestId(`select-client-${client.id}`)
    await waitFor(() => {
      expect(screen.queryByTestId('timer-orphan')).toBeNull()
    })
    expect(select.closest('li')?.querySelector('.timer-client-row')?.className).toContain(
      'timer-client-row-active',
    )
  })

  it('still attributes a timer with no project to nobody', async () => {
    // Unchanged by the fix, and worth pinning: the orphan row exists for exactly this case.
    const timer = timerHarness()
    timer.running = {
      id: 'running-2',
      projectId: null,
      tagIds: [],
      start: new Date('2026-10-13T09:00:00.000Z').toISOString(),
      end: null,
      note: '',
      billable: false,
      rateOverrideMinor: null,
      source: 'timer',
      createdAt: new Date('2026-10-13T09:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-10-13T09:00:00.000Z').toISOString(),
      deletedAt: null,
    }

    renderPanel(timer)

    expect(await screen.findByTestId('timer-orphan')).toBeInTheDocument()
  })

  it('does not invent a client for a timer whose project has been deleted', async () => {
    const timer = timerHarness()
    timer.running = {
      id: 'running-3',
      projectId: 'a-project-that-no-longer-exists',
      tagIds: [],
      start: new Date('2026-10-13T09:00:00.000Z').toISOString(),
      end: null,
      note: '',
      billable: false,
      rateOverrideMinor: null,
      source: 'timer',
      createdAt: new Date('2026-10-13T09:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-10-13T09:00:00.000Z').toISOString(),
      deletedAt: null,
    }

    renderPanel(timer)

    // No client to name, so no client is named. Guessing one would put the time somewhere
    // the user did not put it. This is the case the orphan row exists for, and it must keep
    // rendering after the attribution fix.
    expect(await screen.findByTestId('timer-orphan')).toBeInTheDocument()
  })
})

describe('layout (item 16)', () => {
  it('offers no “no client” option once clients exist', async () => {
    // Item 16 asks for this explicitly. Uncategorised is still reachable from the manual
    // entry form, so nothing is lost — it just is not a button on the timer.
    await createClientWithDefaultProject({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    renderPanel()
    await screen.findByText('Acme Ltd', { selector: '.timer-client-name' })

    expect(screen.queryByTestId('start-uncategorised')).toBeNull()
  })

  it('still allows starting something when there are no clients at all', async () => {
    // Without this the panel would have no Start at all, and a timed entry could not be
    // recorded before any client existed.
    const timer = renderPanel()

    await user.click(screen.getByTestId('start-uncategorised'))

    expect(timer.started).toEqual([null])
  })

  it('puts the add button in the panel header', () => {
    renderPanel()

    // Item 24 removed the "Clients" heading, so the list header has nothing left in it.
    expect(screen.queryByText('Clients')).toBeNull()
  })

  it('puts each client on one line with its own controls', async () => {
    await createClientWithDefaultProject({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    renderPanel()

    const row = await clientRow('Acme Ltd')
    const start = within(row).getByRole('button', { name: 'Start a timer for Acme Ltd' })
    expect(start).toBeVisible()
    // Exactly one control in the action slot (item 63): the Start button, plus the reserved
    // discard space. The client's *name* is also a button — it is the entries filter (item
    // 25) — so the count is of the action slot rather than of the row.
    const actions = row.querySelector('.timer-client-actions')
    expect(within(actions as HTMLElement).getAllByRole('button')).toHaveLength(1)
    // Right-aligned by the slot's `margin-left: auto`, which is asserted in the browser
    // because jsdom has no layout.
    expect(row.querySelector('.timer-action-slot')).not.toBeNull()
    expect(row.querySelector('.timer-client-live')).not.toBeNull()
  })
})

describe('a client default project changing under the panel', () => {
  it('files against the new oldest project once one is added (8.12)', async () => {
    // A client's default project is its oldest (item 12), so adding a project changes no
    // client id. The read was keyed on client ids alone, so Start went on filing against
    // the project it had already read while the taxonomy showed a different one.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    const first = await createProject({
      name: 'First',
      clientId: client.id,
      now: T0,
    })
    const timer = timerHarness()
    renderPanel(timer)

    await user.click(await screen.findByRole('button', { name: 'Start a timer for Acme Ltd' }))
    await waitFor(() => expect(timer.started).toEqual([first.id]))

    // An *older* project arrives — by timestamp, not by insertion order — so it becomes the
    // default and the started project should change.
    await createProject({
      name: 'Older',
      clientId: client.id,
      now: new Date('2026-10-01T09:00:00.000Z'),
    })
    await waitFor(() => expect(timer.started).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: 'Start a timer for Acme Ltd' }))
    await waitFor(() => expect(timer.started).toHaveLength(2))
    expect(timer.started[1]).not.toBe(first.id)
  })
})

describe('time tracked per client (item 16)', () => {
  it('sums every project the client owns', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    await createProject({ name: 'General', clientId: client.id, now: NOW })
    await createProject({ name: 'Website', clientId: client.id, now: NOW })

    render(<TimerPanel timer={timerHarness()} onStopped={() => {}} now={NOW} />)
    await screen.findByText('Acme Ltd', { selector: '.timer-client-name' })
    expect(screen.getByTestId(`client-live-${client.id}`)).toHaveTextContent('0m')
  })

  it('adds up durations across that client’s projects', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    const general = await createProject({ name: 'General', clientId: client.id, now: NOW })
    const extra = await createProject({ name: 'Website', clientId: client.id, now: NOW })

    // 30 minutes on the default project plus 90 on another, so the total is only right if
    // it covers every project the client owns rather than only the default one.
    await createManualEntry({
      start: new Date('2026-10-13T09:00:00.000Z'),
      end: new Date('2026-10-13T09:30:00.000Z'),
      note: '',
      now: NOW,
      projectId: general.id,
    })
    await createManualEntry({
      start: new Date('2026-10-13T10:00:00.000Z'),
      end: new Date('2026-10-13T11:30:00.000Z'),
      note: '',
      now: NOW,
      projectId: extra.id,
    })

    render(<TimerPanel timer={timerHarness()} onStopped={() => {}} now={NOW} />)

    await waitFor(() => {
      expect(screen.getByTestId(`client-live-${client.id}`)).toHaveTextContent('2h')
    })
  })

  it('attributes uncategorised time to nobody', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    await createProject({ name: 'General', clientId: client.id, now: NOW })
    await createManualEntry({
      start: new Date('2026-10-13T09:00:00.000Z'),
      end: new Date('2026-10-13T10:00:00.000Z'),
      note: '',
      now: NOW,
    })

    render(<TimerPanel timer={timerHarness()} onStopped={() => {}} now={NOW} />)

    await waitFor(() => {
      expect(screen.getByTestId(`client-live-${client.id}`)).toHaveTextContent('0m')
    })
  })

  it('ignores a deleted entry, because it was never worked', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    const general = await createProject({ name: 'General', clientId: client.id, now: NOW })
    const stored = await createManualEntry({
      start: new Date('2026-10-13T09:00:00.000Z'),
      end: new Date('2026-10-13T10:00:00.000Z'),
      note: '',
      now: NOW,
      projectId: general.id,
    })
    await softDeleteEntry(stored.id, NOW)

    render(<TimerPanel timer={timerHarness()} onStopped={() => {}} now={NOW} />)

    await waitFor(() => {
      expect(screen.getByTestId(`client-live-${client.id}`)).toHaveTextContent('0m')
    })
  })
})

describe('projects under the selected client (item 61)', () => {
  /** The client's row, located the way the app locates it: by the name button. */
  async function clientItem(name: string): Promise<HTMLElement> {
    const item = (await screen.findByText(name, { selector: '.timer-client-name' })).closest(
      'li',
    )
    if (!item) throw new Error(`no client item for "${name}"`)
    return item
  }

  it('shows the selected client’s projects, each with a Start button', async () => {
    const { client, defaultProject } = await createClientWithDefaultProject({
      name: 'Acme Ltd',
      currency: 'GBP',
      now: NOW,
    })
    const website = await createProject({ name: 'Website', clientId: client.id, now: NOW })

    renderPanel(timerHarness(), NOW, client.id)

    const item = await clientItem('Acme Ltd')
    // Both the default project and the second one, because the list is the client's projects
    // rather than "everything but the default".
    expect(within(item).getByText(defaultProject.name, { selector: '.timer-project-name' }))
    expect(within(item).getByText('Website', { selector: '.timer-project-name' })).toBeVisible()
    expect(
      within(item).getByRole('button', { name: 'Start a timer for Website' }),
    ).toBeInTheDocument()
    expect(website.id).not.toBe(defaultProject.id)
  })

  it('starts a timer for that project, not the client’s default', async () => {
    const { client } = await createClientWithDefaultProject({
      name: 'Acme Ltd',
      currency: 'GBP',
      now: NOW,
    })
    const website = await createProject({ name: 'Website', clientId: client.id, now: NOW })

    const timer = renderPanel(timerHarness(), NOW, client.id)
    await clientItem('Acme Ltd')
    await user.click(screen.getByRole('button', { name: 'Start a timer for Website' }))

    // The whole point of the per-project buttons: the time is filed against the project that
    // was pressed, which the client's own Start button could not do.
    expect(timer.started).toEqual([website.id])
  })

  it('shows no project list for a client that is not selected', async () => {
    const { client } = await createClientWithDefaultProject({
      name: 'Acme Ltd',
      currency: 'GBP',
      now: NOW,
    })
    await createProject({ name: 'Website', clientId: client.id, now: NOW })

    renderPanel(timerHarness(), NOW, null)

    await clientItem('Acme Ltd')
    // The card is the most-used surface in the app; a project list under every client would
    // make it a wall. Selection is what narrows it.
    expect(screen.queryByText('Website', { selector: '.timer-project-name' })).toBeNull()
  })

  it('hides the list again when the selection is cleared', async () => {
    const { client } = await createClientWithDefaultProject({
      name: 'Acme Ltd',
      currency: 'GBP',
      now: NOW,
    })
    await createProject({ name: 'Website', clientId: client.id, now: NOW })

    const view = render(
      <TimerPanel
        timer={timerHarness()}
        onStopped={() => {}}
        now={NOW}
        selectedClientId={client.id}
        onSelectClient={() => {}}
      />,
    )

    await screen.findByText('Website', { selector: '.timer-project-name' })

    view.rerender(
      <TimerPanel
        timer={timerHarness()}
        onStopped={() => {}}
        now={NOW}
        selectedClientId={null}
        onSelectClient={() => {}}
      />,
    )

    expect(screen.queryByText('Website', { selector: '.timer-project-name' })).toBeNull()
  })

  it('leaves the client’s own Start button able to start the default project', async () => {
    // Item 12 is unchanged: the client's Start is the common case, and the per-project
    // buttons are for every other project under the same client.
    const { client, defaultProject } = await createClientWithDefaultProject({
      name: 'Acme Ltd',
      currency: 'GBP',
      now: NOW,
    })
    await createProject({ name: 'Website', clientId: client.id, now: NOW })

    const timer = renderPanel(timerHarness(), NOW, client.id)
    const item = await clientItem('Acme Ltd')
    const start = within(item).getByRole('button', { name: 'Start a timer for Acme Ltd' })
    await waitFor(() => expect(start).toBeEnabled())
    await user.click(start)

    expect(timer.started).toEqual([defaultProject.id])
  })

  it('disables every other project’s Start while a timer is running', async () => {
    // One timer at a time (0004 T2), and a control that vanishes cannot be learned. Since
    // a project row's own controls the *running* project shows Stop rather than a disabled
    // Start, so this checks
    // a sibling — which is where a second Start button would otherwise sit.
    const { client, defaultProject } = await createClientWithDefaultProject({
      name: 'Acme Ltd',
      currency: 'GBP',
      now: NOW,
    })
    const website = await createProject({ name: 'Website', clientId: client.id, now: NOW })
    await createProject({ name: 'Intranet', clientId: client.id, now: NOW })
    expect(defaultProject.name).toBe('General')

    const running = timerHarness()
    running.running = makeEntry({
      projectId: website.id,
      source: 'timer',
      start: NOW,
      end: null,
      now: NOW,
    })
    renderPanel(running, NOW, client.id)

    await clientItem('Acme Ltd')
    expect(screen.getByRole('button', { name: 'Start a timer for Intranet' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start a timer for General' })).toBeDisabled()
  })

  it('does not offer an archived project', async () => {
    // 0005 X4: archived records are not offered as choices anywhere.
    const { client, defaultProject } = await createClientWithDefaultProject({
      name: 'Acme Ltd',
      currency: 'GBP',
      now: NOW,
    })
    const retired = await createProject({ name: 'Retired', clientId: client.id, now: NOW })
    await setArchived('project', retired.id, true, NOW)

    renderPanel(timerHarness(), NOW, client.id)

    const item = await clientItem('Acme Ltd')
    expect(within(item).getByText(defaultProject.name, { selector: '.timer-project-name' }))
    expect(within(item).queryByText('Retired', { selector: '.timer-project-name' })).toBeNull()
  })

  it('shows a client with no projects as a row and nothing under it', async () => {
    // Every client gets a default project, but it is created asynchronously — so there is a
    // moment where the client has none, and the list must not render an empty shell.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })

    renderPanel(timerHarness(), NOW, client.id)

    const item = await clientItem('Acme Ltd')
    expect(item.querySelector('.timer-project-list')).toBeNull()
  })
})

describe('what the stop notice says (item 64)', () => {
  it('does not claim a categorised entry was saved uncategorised', async () => {
    /*
     * The bug: stopping said "Saved as uncategorised" unconditionally. Every timer started
     * from this card goes against the client's default project (item 12), so the notice was
     * wrong for essentially all of them — it told the user to classify an entry that the
     * entries list was already naming a client and project for.
     */
    const { client, defaultProject } = await createClientWithDefaultProject({
      name: 'Acme Ltd',
      currency: 'GBP',
      now: NOW,
    })

    const timer = timerHarness()
    timer.running = makeEntry({
      projectId: defaultProject.id,
      source: 'timer',
      start: NOW,
      end: null,
      now: NOW,
    })
    renderPanel(timer)

    // Waited on, because the taxonomy loads asynchronously and the Stop button only appears
    // once the running timer has been resolved to the client that owns its project.
    const stop = await screen.findByRole('button', { name: /Stop the timer for Acme Ltd/ })
    await user.click(stop)

    const notice = await screen.findByTestId('just-stopped')
    expect(notice).not.toHaveTextContent(/uncategorised/i)
    // And it does not ask for work that is already done: no link to a form that has
    // nothing left to fill in.
    expect(within(notice).queryByRole('link')).toBeNull()
    expect(notice).toHaveTextContent(/^Saved\./)
    expect(client.id).toBeTruthy()
  })

  it('still says uncategorised when the timer really had no project', async () => {
    // The other half: uncategorised is a legitimate state (0005 U1) and the offer to
    // classify it is exactly right for one.
    const timer = timerHarness()
    timer.running = makeEntry({
      projectId: null,
      source: 'timer',
      start: NOW,
      end: null,
      now: NOW,
    })
    renderPanel(timer)

    // No client owns this timer, so the Stop button is on the orphan row.
    await user.click(await screen.findByRole('button', { name: 'Stop the timer' }))

    const notice = await screen.findByTestId('just-stopped')
    expect(notice).toHaveTextContent(/uncategorised/i)
    expect(within(notice).getByRole('link').getAttribute('href')).toMatch(/^#\/entries\//)
  })
})

describe('the timer row controls (item 63)', () => {
  async function row(name: string): Promise<HTMLElement> {
    const button = await screen.findByRole('button', { name: `Start a timer for ${name}` })
    const found = button.closest('li')
    if (!found) throw new Error(`no row for "${name}"`)
    return found
  }

  /** Renders the panel with a timer already running against `projectName`. */
  async function renderRunning(clientName: string, projectName: string): Promise<() => void> {
    const client = await createClient({ name: clientName, currency: 'GBP', now: NOW })
    const project = await createProject({ name: projectName, clientId: client.id, now: NOW })
    const timer = timerHarness()
    timer.running = makeEntry({
      projectId: project.id,
      source: 'timer',
      start: NOW,
      end: null,
      now: NOW,
    })
    // `renderPanel` returns the harness, not the view, so the view is kept for the unmount.
    const view = render(<TimerPanel timer={timer} onStopped={() => {}} now={NOW} />)
    await screen.findByRole('button', { name: `Stop the timer for ${clientName}` })
    return () => view.unmount()
  }

  it('shows a play mark for starting and a square for stopping', async () => {
    // A square rather than two bars: pause says "hold this here", and stopping a timer ends
    // it — the entry is written and the clock does not continue.
    await createClientWithDefaultProject({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    const view = render(<TimerPanel timer={timerHarness()} onStopped={() => {}} now={NOW} />)
    const start = await screen.findByRole('button', { name: 'Start a timer for Acme Ltd' })
    expect(start.querySelector('svg')).not.toBeNull()
    view.unmount()

    const done = await renderRunning('Other Co', 'Work')
    expect(
      screen.getByRole('button', { name: 'Stop the timer for Other Co' }).querySelector('svg'),
    ).not.toBeNull()
    done()
  })

  it('gives every icon button a tooltip as well as an accessible name', async () => {
    /*
     * The shape is a convention rather than a word, so a pointer user has nothing to hover
     * for unless the control says what it is. `title` is the tooltip; `aria-label` is what
     * a screen reader announces, and the two say the same thing on purpose.
     */
    await createClientWithDefaultProject({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    const idle = render(<TimerPanel timer={timerHarness()} onStopped={() => {}} now={NOW} />)
    const start = await screen.findByRole('button', { name: 'Start a timer for Acme Ltd' })
    expect(start).toHaveAttribute('title', 'Start a timer for Acme Ltd')
    idle.unmount()

    const cleanup = await renderRunning('Other Co', 'Work')
    for (const name of ['Stop the timer for Other Co', 'Discard the timer for Other Co']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('title', name)
    }
    cleanup()
  })

  it('uses a wastebasket rather than a cross for discard', async () => {
    // A cross reads as "close this". Discard throws recorded work away, and the bin says so.
    const cleanup = await renderRunning('Acme Ltd', 'Work')

    const discard = screen.getByRole('button', { name: 'Discard the timer for Acme Ltd' })
    expect(discard.className).toContain('timer-discard')
    expect(discard.querySelector('svg')).not.toBeNull()
    cleanup()
  })

  it('holds the discard slot open while idle, so starting does not resize the row', async () => {
    // A discard that appears and vanishes brings back the defect item 35 was written for.
    await createClientWithDefaultProject({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    const idle = render(<TimerPanel timer={timerHarness()} onStopped={() => {}} now={NOW} />)

    const slot = (await row('Acme Ltd')).querySelector('.timer-action-slot')
    expect(slot).not.toBeNull()
    // Hidden from assistive tech: there is nothing to discard while nothing is running, and
    // a disabled control would still be announced as something to press.
    expect(slot?.getAttribute('aria-hidden')).toBe('true')
    idle.unmount()

    const cleanup = await renderRunning('Other Co', 'Work')
    /*
     * Scoped to the running client's own row. "Acme Ltd" is still on the page and still
     * idle, so it still holds a slot — which is the point: the row that is running swaps its
     * placeholder for a real button, and the rows that are not are left alone.
     */
    const runningRow = (
      await screen.findByRole('button', { name: 'Stop the timer for Other Co' })
    ).closest('li')
    expect(runningRow?.querySelector('.timer-action-slot')).toBeNull()
    expect(
      within(runningRow as HTMLElement).getByRole('button', {
        name: 'Discard the timer for Other Co',
      }),
    ).toBeInTheDocument()
    cleanup()
  })
})

describe('a project row runs its own timer (items 61 and 63)', () => {
  /**
   * A client with three projects, one of them already running.
   *
   * The running timer is a prop, so the harness is given a stop spy rather than a real stop:
   * a harness whose `stop` is a no-op leaves `running` set, and the row would keep showing
   * Stop forever, which says nothing about whether pressing it reached the right button.
   */
  async function withRunningProject(runningName: string): Promise<{
    client: Client
    project: Project
    stopped: () => number
    discarded: () => number
    cleanup: () => void
  }> {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    const project = await createProject({ name: runningName, clientId: client.id, now: NOW })
    await createProject({ name: 'Other Work', clientId: client.id, now: NOW })
    const timer = timerHarness()
    timer.running = makeEntry({
      projectId: project.id,
      source: 'timer',
      start: NOW,
      end: null,
      now: NOW,
    })
    // An elapsed value, so the count-up has something to print; the harness has no clock.
    Object.defineProperty(timer, 'elapsedMs', { value: 90_000, configurable: true })
    let stops = 0
    let discards = 0
    // Not `async`: nothing is awaited, and a promise-returning stub here would make the
    // stop path look exercised when it has not been.
    timer.stop = () => {
      stops += 1
      return Promise.resolve()
    }
    timer.discard = () => {
      discards += 1
    }
    const view = render(
      <TimerPanel
        timer={timer}
        onStopped={() => {}}
        now={NOW}
        selectedClientId={client.id}
        onSelectClient={() => {}}
      />,
    )
    await screen.findByRole('button', { name: `Stop the timer for ${runningName}` })
    return {
      client,
      project,
      stopped: () => stops,
      discarded: () => discards,
      cleanup: () => view.unmount(),
    }
  }

  it('gives the running project its own Stop and discard', async () => {
    /*
     * The bug this fixes: a timer started against a project could only be stopped from the
     * client row above it, so the project you were working on had no control of its own and
     * the timer looked like it belonged to the client rather than to the project.
     */
    const { cleanup } = await withRunningProject('Website')

    // Stop and discard live on the project's row, not only on the client's.
    const projectRow = screen
      .getByRole('button', { name: 'Stop the timer for Website' })
      .closest('li')
    expect(projectRow?.className).toContain('timer-project-row-active')
    expect(
      within(projectRow as HTMLElement).getByRole('button', {
        name: 'Discard the timer for Website',
      }),
    ).toBeInTheDocument()
    expect(
      within(projectRow as HTMLElement).queryByRole('button', { name: /Start a timer/ }),
    ).toBeNull()
    cleanup()
  })

  it('shows the count-up on the project’s own row', async () => {
    // A project row is not a client row: it has no lifetime total, so while idle it shows
    // nothing rather than a zero that would be the client's figure.
    const { project, cleanup } = await withRunningProject('Website')

    const live = screen.getByTestId(`project-live-${project.id}`)
    expect(live).toHaveTextContent(/\d/)
    cleanup()
  })

  it('shows nothing on an idle project row, rather than a zero', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    const idle = await createProject({ name: 'Later', clientId: client.id, now: NOW })
    render(
      <TimerPanel
        timer={timerHarness()}
        onStopped={() => {}}
        now={NOW}
        selectedClientId={client.id}
        onSelectClient={() => {}}
      />,
    )

    expect(await screen.findByTestId(`project-live-${idle.id}`)).toHaveTextContent('')
  })

  it('marks only the running project, not every project under that client', async () => {
    // `activeClientId` is the client that owns the running project, so using it here would
    // light up the whole client's project list.
    const { cleanup } = await withRunningProject('Website')

    const active = document.querySelectorAll('.timer-project-row-active')
    expect(active).toHaveLength(1)
    expect(within(active[0] as HTMLElement).getByText('Website')).toBeInTheDocument()
    cleanup()
  })

  it('stops the timer from the project row', async () => {
    const { stopped, cleanup } = await withRunningProject('Website')

    await user.click(screen.getByRole('button', { name: 'Stop the timer for Website' }))

    // The press reached stop, and the notice appears — the same round trip the client row
    // makes, which is the point of a project row having its own controls.
    await waitFor(() => expect(stopped()).toBe(1))
    await screen.findByTestId('just-stopped')
    cleanup()
  })

  it('discards the timer from the project row', async () => {
    const { discarded, cleanup } = await withRunningProject('Website')

    await user.click(screen.getByRole('button', { name: 'Discard the timer for Website' }))

    await waitFor(() => expect(discarded()).toBe(1))
    // Discarding writes nothing, so there is no notice — and none should appear.
    expect(screen.queryByTestId('just-stopped')).toBeNull()
    cleanup()
  })

  it('puts the icons and tooltips on the project row too', async () => {
    const { cleanup } = await withRunningProject('Website')

    for (const name of [
      'Stop the timer for Website',
      'Discard the timer for Website',
      'Start a timer for Other Work',
    ]) {
      const button = screen.getByRole('button', { name })
      expect(button.querySelector('svg')).not.toBeNull()
      // The tooltip says the same thing as the accessible name, for the same reason.
      expect(button).toHaveAttribute('title', name)
    }
    cleanup()
  })
})
