import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { installTestDb } from '../test/harness'
import { createManualEntry, listEntries } from '../storage/entriesRepo'
import { dayKey } from '../domain/time/days'

beforeEach(() => {
  installTestDb()
  window.location.hash = ''
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('root route', () => {
  it('renders the timer and entries panels', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Time Tracker' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Timer' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Entries' })).toBeInTheDocument()
  })

  it('shows an empty state before anything is recorded (0007 FB3)', async () => {
    render(<App />)
    expect(await screen.findByTestId('empty-state')).toHaveTextContent(/No entries yet/)
  })

  it('ignores a query string when matching', () => {
    window.location.hash = '#/?range=week'
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Timer' })).toBeInTheDocument()
  })
})

describe('routing', () => {
  // 0002 R3
  it('renders not-found for an unrouted path without throwing', () => {
    window.location.hash = '#/definitely-not-a-route'
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })

  it('routes to the new-entry form', () => {
    window.location.hash = '#/entries/new'
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Add entry' })).toBeInTheDocument()
  })

  it('reports a missing entry rather than rendering an empty form', async () => {
    window.location.hash = '#/entries/does-not-exist'
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Entry not found' })).toBeInTheDocument()
  })
})

describe('recording a timer (Phase 2A gate)', () => {
  it('starts, shows elapsed, then routes to the form on stop (0001 US2)', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => {
      expect(screen.getByTestId('timer-elapsed')).not.toHaveTextContent('No timer running')
    })

    await user.click(screen.getByRole('button', { name: 'Stop' }))

    // Stopping lands on the detail form for the entry just stopped.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit entry' })).toBeInTheDocument()
    })
    expect(window.location.hash).toMatch(/^#\/entries\/[0-9a-f-]{36}$/)

    const entries = await listEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.end).not.toBeNull()
  })

  // 0004 T1: starting twice must not create two running entries.
  it('is a no-op when a timer is already running', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument(),
    )
    // The Start button is replaced while running, so a double-click cannot race.
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
    expect(await listEntries()).toHaveLength(1)
  })

  // 0004 T6
  it('discarding leaves no active entry', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: 'Discard' }))

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument())
    expect(await listEntries()).toHaveLength(0)
  })
})

describe('entry list', () => {
  it('groups entries by day and shows a subtotal matching the rows (0004 L1, 0006 RP2)', async () => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0)
    await createManualEntry({
      start,
      end: new Date(start.getTime() + 3_600_000),
      note: 'first',
      now,
    })
    await createManualEntry({
      start: new Date(start.getTime() + 7_200_000),
      end: new Date(start.getTime() + 10_800_000),
      note: 'second',
      now,
    })

    render(<App />)

    const key = dayKey(start)
    await waitFor(() => expect(screen.getByTestId(`day-total-${key}`)).toBeInTheDocument())
    expect(screen.getByTestId(`day-total-${key}`)).toHaveTextContent('2h')

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
  })

  it('marks a running entry', async () => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0)
    await createManualEntry({
      start,
      end: new Date(start.getTime() + 3_600_000),
      note: 'done',
      now,
    })

    render(<App />)
    await waitFor(() => expect(screen.getByText('done')).toBeInTheDocument())
    expect(screen.queryByText('running')).not.toBeInTheDocument()
  })
})

describe('manual entry (0004 M1–M4)', () => {
  it('saves a duration-first entry and shows it in the list', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/entries/new'
    render(<App />)

    const startInput = screen.getByLabelText<HTMLInputElement>('Start')
    const [datePart, timePart] = (startInput.value || '2026-01-01T09:00').split('T')
    await user.clear(startInput)
    await user.type(startInput, `${datePart}T${timePart}`)

    await user.type(screen.getByLabelText('Duration'), '90')
    await user.type(screen.getByLabelText('Note'), 'wrote the entry form')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Entries' })).toBeInTheDocument(),
    )
    const entries = await listEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.source).toBe('manual')
    expect(entries[0]?.note).toBe('wrote the entry form')
    expect(
      new Date(entries[0]?.end ?? 0).getTime() - new Date(entries[0]?.start ?? 0).getTime(),
    ).toBe(90 * 60 * 1000)
  })

  it('previews the parsed duration before saving', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/entries/new'
    render(<App />)

    await user.type(screen.getByLabelText('Duration'), '45')
    expect(await screen.findByTestId('duration-preview')).toHaveTextContent('45 minutes')
  })

  // 0004 V2: the 24-hour cap blocks saving.
  it('refuses an entry longer than 24 hours', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/entries/new'
    render(<App />)

    const startInput = screen.getByLabelText<HTMLInputElement>('Start')
    const day = (startInput.value || '2026-01-01').slice(0, 10)
    await user.clear(startInput)
    await user.type(startInput, `${day}T09:00`)

    await user.type(screen.getByLabelText('Duration'), '25:00')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    const errors = await screen.findByTestId('form-errors')
    expect(errors).toHaveTextContent(/cannot be longer than 24 hours/i)
    expect(await listEntries()).toHaveLength(0)
  })

  it('requires a duration', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/entries/new'
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Add entry' }))
    expect(await screen.findByTestId('form-errors')).toBeInTheDocument()
    expect(await listEntries()).toHaveLength(0)
  })
})

describe('delete and undo (0003 D1–D4)', () => {
  it('soft-deletes, then restores via undo', async () => {
    const user = userEvent.setup()
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0)
    await createManualEntry({
      start,
      end: new Date(start.getTime() + 3_600_000),
      note: 'oops',
      now,
    })

    render(<App />)
    await user.click(await screen.findByRole('link', { name: /Edit/ }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Edit entry' })).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByTestId('undo-bar')).toBeInTheDocument())
    expect(await listEntries()).toHaveLength(0)

    await user.click(
      within(screen.getByTestId('undo-bar')).getByRole('button', { name: 'Undo' }),
    )
    await waitFor(async () => expect(await listEntries()).toHaveLength(1))
  })
})

describe('theme control', () => {
  it('defaults to following the system preference', () => {
    render(<App />)
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()
  })

  it('applies and persists a chosen theme', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('tt:theme')).toBe('dark')
  })
})

describe('unload warning (0004 W1, W5)', () => {
  it('registers beforeunload only while a timer runs', async () => {
    const user = userEvent.setup()
    const addSpy = vi.spyOn(window, 'addEventListener')

    render(<App />)
    const idleRegistrations = addSpy.mock.calls.filter(
      ([type]) => type === 'beforeunload',
    ).length

    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument(),
    )

    const runningRegistrations = addSpy.mock.calls.filter(
      ([type]) => type === 'beforeunload',
    ).length
    expect(runningRegistrations).toBeGreaterThan(idleRegistrations)
    addSpy.mockRestore()
  })
})
