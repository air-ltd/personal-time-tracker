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
import { createManualEntry, softDeleteEntry } from '../../storage/entriesRepo'
import type { TimerState } from './useTimer'

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

function renderPanel(timer = timerHarness(), now = NOW) {
  render(<TimerPanel timer={timer} onStopped={() => {}} now={now} />)
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

  it('edits a client from the timer panel', async () => {
    const { client } = await createClientWithDefaultProject({
      name: 'Acme Ltd',
      currency: 'GBP',
      now: NOW,
    })
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Edit client Acme Ltd' }))
    const field = screen.getByLabelText('Client name')
    await user.clear(field)
    await user.type(field, 'Renamed Ltd')
    await user.click(screen.getByTestId('client-form-submit'))

    expect(
      await screen.findByText('Renamed Ltd', { selector: '.timer-client-name' }),
    ).toBeVisible()
    expect(client.name).toBe('Acme Ltd')
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
    expect(select.closest('li')?.className).toContain('timer-client-row-active')
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
    expect(
      within(row).getByRole('button', { name: 'Start a timer for Acme Ltd' }),
    ).toBeVisible()
    expect(within(row).getByRole('button', { name: 'Edit client Acme Ltd' })).toBeVisible()
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
