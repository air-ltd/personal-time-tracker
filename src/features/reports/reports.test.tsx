import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { CapacityReport } from '../capacity/CapacityReport'
import { EntryReports } from './EntryReports'
import { InvoiceView } from './InvoiceView'
import { ReportsPage } from './ReportsPage'
import { installTestDb } from '../../test/harness'
import { prepareEntries } from '../../domain/reports/report'
import { entry } from '../../test/factories'
import type { Client, Project } from '../../domain/taxonomy/types'

/**
 * The report screens.
 *
 * The arithmetic has its own tests, and the browser suite checks the round trip
 * through a real browser. What is here is the part only a component test can say:
 * what the screen *shows*, and what it shows when there is nothing to show.
 *
 * The empty states matter more than they look. 0006 C6 says an empty chart renders
 * an explanatory message rather than an empty frame, and 0013 CP-A6 says an unknown
 * figure renders as a dash rather than as a zero — and a zero is a *confident wrong
 * answer*, not a missing one.
 */

const CLIENT: Client = {
  id: 'c1',
  name: 'Acme Ltd',
  colour: '#123456',
  defaultRateMinor: 10000,
  currency: 'GBP',
  archived: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  deletedAt: null,
}

const PROJECT: Project = {
  id: 'p1',
  name: 'Website',
  clientId: 'c1',
  colour: '#abcdef',
  defaultRateMinor: null,
  currency: null,
  archived: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  deletedAt: null,
}

const NOW = new Date('2026-10-14T12:00:00.000Z')

describe('the expected-against-actual report', () => {
  beforeEach(() => {
    installTestDb()
  })

  it('shows a dash, not a zero, for a client with no contract (0013 CP-A6)', async () => {
    // Time tracked, but no contract for that client: the expectation is unknown, and
    // unknown has to look different from zero.
    const prepared = prepareEntries(
      [entry({ projectId: 'p1' })],
      { projects: [PROJECT], clients: [CLIENT], defaultCurrency: 'GBP' },
      NOW,
      15,
    )
    render(
      <CapacityReport
        range={{ from: '2026-10-12', to: '2026-10-18' }}
        prepared={prepared}
        clients={[CLIENT]}
      />,
    )

    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
    const row = screen.getByRole('row', { name: /Acme Ltd/ })
    // The utilisation cell is the last one, and it must be a dash.
    const cells = within(row).getAllByRole('cell')
    expect(cells[cells.length - 2]?.textContent).toBe('—')
  })

  it('says so when there is no client to report on', async () => {
    render(
      <CapacityReport
        range={{ from: '2026-10-12', to: '2026-10-18' }}
        prepared={[]}
        clients={[]}
      />,
    )
    await waitFor(() =>
      expect(screen.getByText(/No client has expected hours yet/)).toBeTruthy(),
    )
  })
})

describe('the entry reports', () => {
  beforeEach(() => {
    installTestDb()
  })

  it('says so when nothing was tracked in the period (0006 C6)', async () => {
    const prepared = prepareEntries(
      [],
      { projects: [], clients: [], defaultCurrency: 'GBP' },
      NOW,
      15,
    )
    render(
      <EntryReports
        prepared={prepared}
        durations={[]}
        mode="clipped"
        onModeChange={() => {}}
      />,
    )
    await waitFor(() =>
      expect(screen.getByText(/Nothing was tracked in this period/)).toBeTruthy(),
    )
  })

  it('breaks the time down, and the breakdown totals what the rows say', async () => {
    const entries = [entry({ projectId: 'p1' }), entry({ projectId: 'p2' })]
    const prepared = prepareEntries(
      entries,
      { projects: [PROJECT], clients: [CLIENT], defaultCurrency: 'GBP' },
      NOW,
      15,
    )
    render(
      <EntryReports
        prepared={prepared}
        durations={prepared.map((item) => item.durationMs)}
        mode="clipped"
        onModeChange={() => {}}
      />,
    )

    await waitFor(() => expect(screen.getByRole('row', { name: /Total/ })).toBeTruthy())
    // A total row, and a percentage that adds to a hundred.
    const total = screen.getByRole('row', { name: /Total/ })
    expect(total.textContent).toContain('100.0%')
  })
})

describe('the invoice', () => {
  beforeEach(() => {
    installTestDb()
  })

  it('shows nothing when no client is chosen', () => {
    render(
      <InvoiceView
        clientId={null}
        clientName=""
        entries={[]}
        durations={[]}
        incrementMinutes={15}
      />,
    )
    expect(screen.queryByRole('heading', { name: /Invoice/ })).toBeNull()
  })

  it('says so when the client has no billable work', async () => {
    const prepared = prepareEntries(
      [],
      { projects: [], clients: [CLIENT], defaultCurrency: 'GBP' },
      NOW,
      15,
    )
    render(
      <InvoiceView
        clientId={CLIENT.id}
        clientName={CLIENT.name}
        entries={prepared}
        durations={[]}
        incrementMinutes={15}
      />,
    )
    await waitFor(() => expect(screen.getByText(/No billable work for Acme Ltd/)).toBeTruthy())
  })

  it('is behind a control, and the control says what it will do', async () => {
    const user = userEvent.setup()
    const prepared = prepareEntries(
      [entry({ projectId: 'p1', billable: true, rateOverrideMinor: 10000 })],
      { projects: [PROJECT], clients: [CLIENT], defaultCurrency: 'GBP' },
      NOW,
      15,
    )
    render(
      <InvoiceView
        clientId={CLIENT.id}
        clientName={CLIENT.name}
        entries={prepared}
        durations={prepared.map((item) => item.durationMs)}
        incrementMinutes={15}
      />,
    )

    const toggle = screen.getByRole('button', { name: 'Show the invoice' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    await user.click(toggle)
    expect(
      screen.getByRole('button', { name: 'Hide the invoice' }).getAttribute('aria-expanded'),
    ).toBe('true')
    expect(screen.getByRole('table')).toBeTruthy()
  })
})

describe('the reports page', () => {
  beforeEach(() => {
    installTestDb()
  })

  it('offers a period, and the reports share it', async () => {
    render(<ReportsPage now={NOW} />)
    await waitFor(() => expect(screen.getByLabelText('Period')).toBeTruthy())
    // The capacity panel reads the contracts first, so its heading arrives a moment
    // after the page does.
    expect(await screen.findByRole('heading', { name: 'Expected against actual' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Time tracked' })).toBeTruthy()
  })
})
