import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SyncIndicatorView } from './SyncIndicator'
import type { SyncStatus } from '../../sync/scheduler'

/**
 * The header indicator, as a pure function of state (0012 AU8, C8).
 *
 * `SyncIndicatorView` exists precisely so every branch is testable — the live state needs
 * an OAuth round trip that will not resolve in a test — and this file had none. That is how
 * a green "Synced" survived: an expired token produced `status.state === 'disabled'`, which
 * the indicator's `failed` test did not match, so it fell through to the success branch and
 * asserted the user's work was on the other device when it was not.
 *
 * The rule these protect: the indicator may only say "Synced" when a cycle has actually run
 * and succeeded. Every other state has to say something else.
 */

/** A status in each of the states the scheduler can emit. */
function status(state: SyncStatus['state'], extra: Partial<SyncStatus> = {}): SyncStatus {
  return {
    state,
    lastOutcome: null,
    lastSyncAt: '2026-10-13T09:00:00.000Z',
    lastRev: null,
    message: null,
    pending: false,
    ...extra,
  }
}

const connected = {
  connection: 'connected',
  hasKey: true,
  busy: false,
  connect: () => undefined,
} as const

function view(props: Partial<Parameters<typeof SyncIndicatorView>[0]> = {}) {
  return render(<SyncIndicatorView {...connected} status={null} {...props} />)
}

describe('what the indicator says', () => {
  it('offers to connect when disconnected', () => {
    // The one branch its own comment says is worth testing: disconnected is the state in
    // which the control has to offer an action rather than report a fact.
    view({ connection: 'disconnected' })

    expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument()
  })

  it('says nothing is configured when there is no app key', () => {
    view({ hasKey: false })

    expect(screen.getByTestId('sync-indicator')).toHaveTextContent(/not set up/i)
  })

  it('says it is asking, rather than claiming success, while the state is unknown', () => {
    // Before the first answer arrives, "Synced" would be a claim the app has not earned.
    view({ connection: 'checking' })

    expect(screen.getByTestId('sync-indicator')).toHaveTextContent(/checking/i)
  })

  it('says Synced only after a cycle has succeeded', () => {
    view({ status: status('idle') })

    const indicator = screen.getByTestId('sync-indicator')
    expect(indicator).toHaveTextContent(/synced/i)
    expect(indicator.className).toContain('sync-indicator-ok')
  })

  it('does not claim success when a cycle failed', () => {
    view({ status: status('error', { message: 'Push rejected.' }) })

    const indicator = screen.getByTestId('sync-indicator')
    expect(indicator).toHaveTextContent(/failed/i)
    expect(indicator.className).toContain('sync-indicator-error')
    expect(indicator).not.toHaveTextContent(/synced/i)
  })

  it('does not claim success when work is waiting to go out', () => {
    view({ status: status('idle', { pending: true }) })

    const indicator = screen.getByTestId('sync-indicator')
    expect(indicator).not.toHaveTextContent(/^synced/i)
    expect(indicator.className).toContain('sync-indicator-warn')
  })

  it('prefers the failure over the pending flag', () => {
    // A failed cycle with work queued is still a failure. Reporting "waiting" would
    // soften the one state the user can act on.
    view({ status: status('error', { message: 'Push rejected.', pending: true }) })

    const indicator = screen.getByTestId('sync-indicator')
    expect(indicator).toHaveTextContent(/failed/i)
    expect(indicator.className).toContain('sync-indicator-error')
  })

  it('says it is syncing rather than Synced while a cycle is in flight', () => {
    // Found by the invariant test below: `syncing` fell through to the success branch and
    // printed "Synced" during the round trip. The same mistake as the expired-token case,
    // one size down — a claim about the other device made before the app had asked it.
    view({ status: status('syncing') })

    const indicator = screen.getByTestId('sync-indicator')
    expect(indicator).toHaveTextContent(/syncing/i)
    expect(indicator).not.toHaveTextContent(/synced/i)
  })

  it('never renders the success class for a state that has not succeeded', () => {
    // The bug, stated as an invariant rather than as one case. Any state that is not a
    // successful idle cycle must not produce `sync-indicator-ok`, because that class is
    // what the dot's colour comes from, and it is the class a glance reads.
    for (const state of ['syncing', 'error'] as const) {
      const { unmount } = view({ status: status(state) })
      expect(screen.getByTestId('sync-indicator').className).not.toContain('sync-indicator-ok')
      unmount()
    }
  })

  it('prints the bare word "Synced" only when a cycle has succeeded', () => {
    /*
     * The invariant, over every state the scheduler can emit and both values of `pending`.
     *
     * Compared as the whole label rather than a substring: "Not synced yet" contains
     * "synced", so a `/synced/` assertion would have passed against the very case it was
     * written for.
     */
    const states: SyncStatus['state'][] = ['idle', 'syncing', 'error']
    for (const state of states) {
      for (const pending of [false, true]) {
        const { unmount } = view({ status: status(state, { pending }) })
        const label = (screen.getByTestId('sync-indicator').textContent ?? '').trim()
        const succeeded = state === 'idle' && !pending
        expect(label === 'Synced', `${state} pending=${pending} said "${label}"`).toBe(
          succeeded,
        )
        unmount()
      }
    }
  })
})
