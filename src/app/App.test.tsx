import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { installTestDb } from '../test/harness'
import {
  createManualEntry,
  findRunningEntry,
  listEntries,
  startTimer,
} from '../storage/entriesRepo'
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
    // Named "Time Tracker, home" rather than just "Time Tracker": the heading is a link
    // (item 23), and a link whose name is identical to the page title does not tell a
    // screen reader user that pressing it goes anywhere.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Time Tracker, home' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Timer' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Entries' })).toBeInTheDocument()
  })

  it('shows an empty state before anything is recorded (0007 FB-3)', async () => {
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

    // Scoped to the entries list: the page contains other lists (the sync setup
    // instructions), so an unscoped count would silently include them.
    const rows = within(
      screen.getByRole('list', { name: new RegExp(`Entries for`) }),
    ).getAllByRole('listitem')
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

  /**
   * 0004 M4 has three clauses, and each is a separate thing that can go wrong: the manual
   * entry must not be creatable, the UI must prompt, and the app must not stop the timer
   * on the user's behalf. The third is the one a convenience would break, so it is
   * asserted rather than assumed.
   */
  describe('while a timer is running (0004 M4)', () => {
    /**
     * Start a timer through the storage layer, then render the new-entry route.
     *
     * Not through the button: the route has to be the app's first render, because changing
     * `location.hash` after mount needs an `act` around it, and a test whose subject is
     * the new-entry screen should not also be testing the router's event handling.
     */
    async function renderNewEntryWithTimerRunning(): Promise<UserEvent> {
      await startTimer(new Date())
      window.location.hash = '#/entries/new'
      const user = userEvent.setup()
      render(<App />)
      await screen.findByTestId('timer-running-notice')
      return user
    }

    it('prompts instead of showing the form', async () => {
      await renderNewEntryWithTimerRunning()

      expect(screen.getByTestId('timer-running-notice')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add entry' })).not.toBeInTheDocument()
    })

    it('does not stop the timer on the user\u2019s behalf', async () => {
      await renderNewEntryWithTimerRunning()

      // Reaching this route has already stopped nothing. An implementation that resolved
      // M4 by calling `stop()` as a side effect of navigating here would silently end an
      // hour of work, which is the outcome the clause exists to forbid.
      const running = await findRunningEntry()
      expect(running).toBeDefined()
      expect(running?.end).toBeNull()
    })

    it('lets the entry be added once the timer is stopped on request', async () => {
      const user = await renderNewEntryWithTimerRunning()

      await user.click(screen.getByRole('button', { name: 'Stop the timer and add the entry' }))

      expect(await screen.findByRole('button', { name: 'Add entry' })).toBeInTheDocument()
      expect(await findRunningEntry()).toBeUndefined()
    })

    it('lets the form be reached without stopping anything at all', async () => {
      await renderNewEntryWithTimerRunning()

      // Abandoning the prompt must leave the timer alone. Stopping it to get out of the
      // screen would lose work for a navigation the user could have undone.
      expect(await findRunningEntry()).toBeDefined()
    })
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

describe('theme control (item 9)', () => {
  // These moved to the settings page: a three-way radio group sat in the header of every
  // screen, for a preference nobody changes mid-entry.
  it('is not in the header', () => {
    render(<App />)
    expect(screen.queryByRole('radio', { name: 'Dark' })).toBeNull()
  })

  it('is on the settings page', () => {
    window.location.hash = '#/settings'
    render(<App />)
    expect(screen.getByRole('radio', { name: 'System' })).toBeInTheDocument()
  })

  it('defaults to following the system preference', () => {
    window.location.hash = '#/settings'
    render(<App />)
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()
  })

  it('applies and persists a chosen theme', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/settings'
    render(<App />)
    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('tt:theme')).toBe('dark')
  })
})

describe('unload warning (0004 W1, W5)', () => {
  /**
   * Behavioural rather than a spy count.
   *
   * Counting `addEventListener` calls races React's passive effects: the DOM can show
   * the running state before the unload effect has flushed, which made this test pass
   * alone and fail in a full run. Dispatching the event and checking whether the app
   * cancelled it tests what actually matters.
   */
  function beforeUnloadIsPrevented(): boolean {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }

  it('does not warn while idle', () => {
    render(<App />)
    expect(beforeUnloadIsPrevented()).toBe(false)
  })

  it('warns once a timer is running', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument(),
    )

    await waitFor(() => expect(beforeUnloadIsPrevented()).toBe(true))
  })

  it('stops warning once dismissed, and warns again for a new timer (0004 W6)', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(beforeUnloadIsPrevented()).toBe(true))

    await user.click(screen.getByRole('button', { name: "Don't remind me" }))
    await waitFor(() => expect(beforeUnloadIsPrevented()).toBe(false))

    // Stopping routes to the entry form (0001 US2), so go back to the list before
    // looking for the Start button.
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Edit entry' })).toBeInTheDocument(),
    )
    await user.click(screen.getByRole('link', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(beforeUnloadIsPrevented()).toBe(true))
  })
})
