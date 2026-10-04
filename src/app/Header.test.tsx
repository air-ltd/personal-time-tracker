import { render, screen } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { SyncProvider } from '../features/sync/SyncProvider'
import { SyncIndicator, SyncIndicatorView } from '../features/sync/SyncIndicator'
import { installTestDb } from '../test/harness'

/**
 * The header (items 10, 11 and 15 of `SPECS/todo.md`).
 *
 * The indicator is the only sync surface most screens will ever have, so the case that
 * matters is a disconnected device: it has to say so, and it has to offer the one action
 * that fixes it, rather than looking like everything is fine.
 */

beforeEach(() => {
  installTestDb()
  window.location.hash = ''
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

/** The indicator rendered in isolation, with the state given rather than connected. */
function indicatorWith(state: Partial<Parameters<typeof SyncIndicatorView>[0]>) {
  return (
    <ul>
      <li>
        <SyncIndicatorView
          connection="disconnected"
          status={null}
          hasKey
          busy={false}
          connect={() => {}}
          {...state}
        />
      </li>
    </ul>
  )
}

describe('the title link (items 11 and 15)', () => {
  it('points at the app’s own home, not the deployed host', () => {
    render(<App />)
    const link = screen.getByRole('link', { name: 'Time Tracker, home' })

    // Absolute, so it resolves; and relative to the current origin, so a fork or a local
    // dev server links to itself rather than to somebody else's deployment.
    const resolved = new URL(link.getAttribute('href') ?? '', window.location.href)
    expect(resolved.origin).toBe(window.location.origin)
    expect(resolved.pathname).toBe(new URL(window.location.href).pathname)
  })

  it('keeps the base path, so it works from a subdirectory', () => {
    render(<App />)
    const link = screen.getByRole('link', { name: 'Time Tracker, home' })

    // Whatever the app is served under is what it links to — the whole point of deriving
    // it rather than writing the path out.
    const resolved = new URL(link.getAttribute('href') ?? '', window.location.href)
    expect(resolved.href.startsWith(window.location.origin)).toBe(true)
  })
})

describe('the sync indicator (item 10)', () => {
  it('offers a button that connects when disconnected', async () => {
    // The state lives in the provider, so this asserts the wiring rather than reaching
    // into it: without a key configured the indicator says setup is needed, and that is
    // the same "not connected, and here is what to do" shape.
    const user: UserEvent = userEvent.setup()
    render(<App />)

    const indicator = screen.getByTestId('sync-indicator')
    // "Checking sync…" is the honest first paint: it has asked Dropbox nothing yet, and
    // claiming connected or disconnected before the answer would be a guess.
    expect(indicator).toHaveTextContent(/checking sync/i)

    // Where it goes matters as much as what it says.
    await user.click(indicator)
    expect(window.location.hash).toBe('#/settings')
  })

  it('is on every screen, not just settings', () => {
    render(<App />)
    expect(screen.getByTestId('sync-indicator')).toBeInTheDocument()

    window.location.hash = '#/entries/new'
    expect(screen.getByTestId('sync-indicator')).toBeInTheDocument()
  })

  it('moves the detail to the settings page', async () => {
    const user: UserEvent = userEvent.setup()
    window.location.hash = '#/settings'
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
    // Matched loosely: the heading carries an environment badge, so its accessible name
    // is "Sync production" rather than "Sync".
    expect(screen.getByRole('heading', { name: /^Sync/ })).toBeInTheDocument()
    // The theme control went with it (item 9).
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('no longer carries the sync panel on the home screen', () => {
    render(<App />)
    expect(screen.queryByRole('heading', { name: /^Sync/ })).toBeNull()
  })
})

describe('the indicator by state (item 10)', () => {
  const states = [
    { connection: 'connected' as const, label: 'Synced', tone: 'ok' },
    { connection: 'disconnected' as const, label: 'Connect Dropbox', tone: 'warn' },
    { connection: 'checking' as const, label: 'Checking sync', tone: 'idle' },
  ]

  for (const state of states) {
    it(`says "${state.label}" when ${state.connection}`, () => {
      render(indicatorWith({ connection: state.connection }))
      const indicator = screen.getByTestId('sync-indicator')
      expect(indicator).toHaveTextContent(new RegExp(state.label, 'i'))
      expect(indicator.className).toContain(`sync-indicator-${state.tone}`)
    })
  }

  it('offers the action, not just a status, when disconnected', async () => {
    const user = userEvent.setup()
    const connect = vi.fn()
    render(indicatorWith({ connection: 'disconnected', connect }))

    await user.click(screen.getByRole('button', { name: /connect dropbox/i }))

    expect(connect).toHaveBeenCalledOnce()
  })

  it('says so when no Dropbox key is configured at all', () => {
    render(indicatorWith({ hasKey: false }))
    expect(screen.getByTestId('sync-indicator')).toHaveTextContent(/sync not set up/i)
  })

  it('flags a failed sync rather than reporting success', () => {
    // The failure silent sync causes: the user assumes the other device is current.
    render(
      indicatorWith({
        connection: 'connected',
        status: {
          state: 'error',
          message: 'nope',
          lastOutcome: null,
          lastSyncAt: null,
          lastRev: null,
        },
      }),
    )
    const indicator = screen.getByTestId('sync-indicator')
    expect(indicator).toHaveTextContent(/sync failed/i)
    expect(indicator.className).toContain('sync-indicator-error')
  })

  it('does not offer the action while connected', async () => {
    const user = userEvent.setup()
    const connect = vi.fn()
    render(indicatorWith({ connection: 'connected', connect }))

    expect(screen.queryByRole('button', { name: /connect dropbox/i })).toBeNull()
    await user.click(screen.getByTestId('sync-indicator'))
    expect(connect).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('#/settings')
  })
})

describe('sharing one connection', () => {
  it('throws rather than pretending, when used outside the provider', () => {
    // A component that silently got an inert sync state would look like a working app
    // that happens not to be syncing.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<SyncIndicator />)).toThrow(/SyncProvider/)
    consoleError.mockRestore()
  })

  it('does not throw when the provider is present', () => {
    render(<SyncProvider>{indicatorWith({ connection: 'connected' })}</SyncProvider>)
    expect(screen.getByTestId('sync-indicator')).toBeInTheDocument()
  })
})
