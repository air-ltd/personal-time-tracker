import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { EntriesView } from './EntriesView'
import { installTestDb } from '../../test/harness'
import { createClient, createProject } from '../../storage/taxonomyRepo'
import {
  createManualEntry,
  discardTimer,
  findRunningEntry,
  startTimer,
} from '../../storage/entriesRepo'

/**
 * Filtering and summarising the entries (items 21 and 22 of `SPECS/todo.md`).
 *
 * The behaviour worth protecting is the interaction between the two: a running timer
 * overrides the chosen client. If that silently changed the filter, a user who selected a
 * client to inspect would be looking at someone else's time with no indication why.
 */

const NOW = new Date('2026-10-13T18:00:00.000Z')

let user: UserEvent

beforeEach(() => {
  installTestDb()
  user = userEvent.setup()
})

async function entryFor(projectId: string | null, minutes: number): Promise<void> {
  await createManualEntry({
    start: new Date('2026-10-13T09:00:00.000Z'),
    end: new Date(`2026-10-13T09:${String(minutes).padStart(2, '0')}:00.000Z`),
    note: '',
    now: NOW,
    projectId,
  })
}

describe('filtering by client (item 21)', () => {
  it('shows only the chosen client’s entries', async () => {
    const acme = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    const other = await createClient({ name: 'Other Ltd', currency: 'GBP', now: NOW })
    const web = await createProject({ name: 'Website', clientId: acme.id, now: NOW })
    const ret = await createProject({ name: 'Retainer', clientId: other.id, now: NOW })
    await entryFor(web.id, 30)
    await entryFor(ret.id, 45)

    render(<EntriesView now={NOW} selectedClientId={acme.id} />)
    await screen.findByText('Website')

    await waitFor(() => {
      expect(screen.getByText('Website')).toBeInTheDocument()
      expect(screen.queryByText('Retainer')).toBeNull()
    })
    // The card says which client, because the control that chose it is on another card.
    expect(screen.getByTestId('entries-filter-note')).toHaveTextContent(/Acme Ltd/)
  })

  it('says which client is filtering, and that a timer is why', async () => {
    // Item 21: "If a timer is active for a client the entries should be filtered for that
    // client." The part worth testing is that it is not silent.
    const acme = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    const other = await createClient({ name: 'Other Ltd', currency: 'GBP', now: NOW })
    const web = await createProject({ name: 'Website', clientId: acme.id, now: NOW })
    const ret = await createProject({ name: 'Retainer', clientId: other.id, now: NOW })
    await entryFor(web.id, 30)
    await entryFor(ret.id, 45)
    const running = await startTimer(NOW, web.id)

    render(<EntriesView now={NOW} selectedClientId={null} />)
    await waitFor(() => {
      expect(screen.getByTestId('entries-filter-note')).toHaveTextContent(/A timer is running/)
    })

    // Two rows mention Website: the manual entry and the running timer. Both belong to
    // this client, which is the point.
    expect(screen.getAllByText('Website')).toHaveLength(2)
    expect(screen.queryByText('Retainer')).toBeNull()
    // The timer is what drove the filter, so it is the client's project that is running.
    expect(running.projectId).toBe(web.id)
  })

  it('overrides the chosen client while a timer runs, and says so', async () => {
    const acme = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    const other = await createClient({ name: 'Other Ltd', currency: 'GBP', now: NOW })
    const web = await createProject({ name: 'Website', clientId: acme.id, now: NOW })
    const ret = await createProject({ name: 'Retainer', clientId: other.id, now: NOW })
    await entryFor(web.id, 30)
    await entryFor(ret.id, 45)
    await startTimer(NOW, web.id)

    // The prop says Other Ltd; the timer says Acme. The timer wins, visibly.
    render(<EntriesView now={NOW} selectedClientId={other.id} />)

    await waitFor(() => {
      expect(screen.getByTestId('entries-filter-note')).toHaveTextContent(/Acme Ltd/)
    })
    expect(screen.getByTestId('entries-filter-note')).toHaveTextContent(/timer is running/)
    expect(screen.queryByText('Retainer')).toBeNull()
  })

  it('goes back to the chosen client once the timer is gone', async () => {
    const acme = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    const other = await createClient({ name: 'Other Ltd', currency: 'GBP', now: NOW })
    const web = await createProject({ name: 'Website', clientId: acme.id, now: NOW })
    const ret = await createProject({ name: 'Retainer', clientId: other.id, now: NOW })
    await entryFor(web.id, 30)
    await entryFor(ret.id, 45)
    await startTimer(NOW, web.id)

    render(<EntriesView now={NOW} selectedClientId={null} />)
    await waitFor(() => {
      expect(screen.getByTestId('entries-filter-note')).toHaveTextContent(/timer is running/)
    })

    // The timer has to actually go away: the view reads it from storage, so leaving it
    // running would keep the override and prove nothing.
    const running = await findRunningEntry()
    if (running === undefined) throw new Error('expected a running entry')
    await discardTimer(running.id, NOW)

    // Re-mounted rather than re-rendered, so the assertion does not depend on the store
    // subscription firing mid-test.
    cleanup()
    render(<EntriesView now={NOW} selectedClientId={acme.id} />)

    await waitFor(() => {
      expect(screen.getByTestId('entries-filter-note')).not.toHaveTextContent(
        /timer is running/,
      )
    })
    expect(screen.getByTestId('entries-filter-note')).toHaveTextContent(/Acme Ltd/)
    expect(screen.getAllByText('Website').length).toBeGreaterThan(0)
  })
})

describe('the period (item 22)', () => {
  it('keeps the list for all entries, and summarises for daily', async () => {
    const acme = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    const web = await createProject({ name: 'Website', clientId: acme.id, now: NOW })
    await entryFor(web.id, 30)

    render(<EntriesView now={NOW} selectedClientId={null} />)
    // Default is the list, so 0004's day groups and subtotals are untouched.
    expect(await screen.findByText('Website')).toBeInTheDocument()
    expect(screen.queryByTestId('entry-summary')).toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Daily' }))

    expect(await screen.findByTestId('entry-summary')).toBeInTheDocument()
    const rows = within(screen.getByTestId('entry-summary')).getAllByRole('listitem')
    expect(rows.some((row) => row.textContent?.includes('Acme Ltd'))).toBe(true)
    expect(acme.id).toBeTruthy()
  })

  it('summarises weekly', async () => {
    const acme = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    const web = await createProject({ name: 'Website', clientId: acme.id, now: NOW })
    await entryFor(web.id, 30)

    render(<EntriesView now={NOW} selectedClientId={null} />)
    await user.click(screen.getByRole('radio', { name: 'Weekly' }))

    const summary = await screen.findByTestId('entry-summary')
    expect(within(summary).getByText(/^Week of/)).toBeInTheDocument()
    expect(web.id).toBeTruthy()
  })

  it('summarises only the selected client', async () => {
    // The filter and the summary are the same selection, so the summary cannot show a
    // client whose entries were filtered out — the two disagreeing is the failure 0006
    // RP2 exists to prevent.
    const acme = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    const other = await createClient({ name: 'Other Ltd', currency: 'GBP', now: NOW })
    const web = await createProject({ name: 'Website', clientId: acme.id, now: NOW })
    const ret = await createProject({ name: 'Retainer', clientId: other.id, now: NOW })
    await entryFor(web.id, 30)
    await entryFor(ret.id, 45)

    render(<EntriesView now={NOW} selectedClientId={acme.id} />)
    await screen.findByText('Website')
    await user.click(screen.getByRole('radio', { name: 'Daily' }))

    const summary = await screen.findByTestId('entry-summary')
    expect(within(summary).getByText(/Acme Ltd/)).toBeInTheDocument()
    expect(within(summary).queryByText(/Other Ltd/)).toBeNull()
  })

  it('shows the empty state when nothing has ever been recorded', async () => {
    // 0007 FB3, and it must survive the new period control: a summary reading "nothing in
    // this period" is a different and more alarming claim than "no work yet".
    render(<EntriesView now={NOW} selectedClientId={null} />)

    expect(await screen.findByTestId('empty-state')).toBeInTheDocument()
  })
})
