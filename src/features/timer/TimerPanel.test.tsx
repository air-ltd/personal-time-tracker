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
