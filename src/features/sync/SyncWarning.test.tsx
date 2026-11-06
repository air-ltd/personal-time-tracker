import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { describeKeySource } from '../../sync/appKey'
import type { SyncStatus } from '../../sync/scheduler'
import { installTestDb } from '../../test/harness'
import type { AppDb } from '../../storage/db'
import { SyncContext, type SyncState } from './syncContext'
import { SyncWarning, SYNC_WARNING_SNOOZE_MS } from './SyncWarning'

function status(state: SyncStatus['state'], message: string | null = null): SyncStatus {
  return {
    state,
    lastOutcome: null,
    lastSyncAt: '2026-10-13T09:00:00.000Z',
    lastRev: null,
    message,
    pending: false,
  }
}

const syncNow = vi.fn()
const connect = vi.fn()
let db: AppDb

const defaultState: SyncState = {
  connection: 'connected',
  status: null,
  busy: false,
  hasKey: true,
  connectionLost: false,
  warningError: null,
  keyInfo: describeKeySource(),
  authError: null,
  connect,
  disconnect: vi.fn(),
  syncNow,
  recheckKey: vi.fn(),
  shareWithThisAccount: vi.fn(),
  shareError: null,
}

function renderWarning(overrides: Partial<SyncState> = {}) {
  return render(
    <SyncContext.Provider value={{ ...defaultState, ...overrides }}>
      <SyncWarning />
    </SyncContext.Provider>,
  )
}

beforeEach(() => {
  db = installTestDb()
  syncNow.mockClear()
  connect.mockClear()
})

describe('sync warning', () => {
  it('shows a prominent failure and retries sync while Dropbox is connected', async () => {
    const user = userEvent.setup()
    renderWarning({ status: status('error', 'Dropbox is offline.') })

    const warning = await screen.findByTestId('sync-warning')
    expect(warning).toHaveTextContent('Dropbox is offline.')
    expect(warning).toHaveTextContent(/safe in this browser/i)
    await user.click(screen.getByRole('button', { name: 'Try again now' }))
    expect(syncNow).toHaveBeenCalledOnce()
  })

  it('offers Dropbox reconnection after a previously working connection is lost', async () => {
    const user = userEvent.setup()
    renderWarning({ connection: 'disconnected', connectionLost: true })

    await screen.findByTestId('sync-warning')
    await user.click(screen.getByRole('button', { name: 'Reconnect Dropbox' }))
    expect(connect).toHaveBeenCalledOnce()
  })

  it('does not warn when Dropbox has never been connected', async () => {
    renderWarning({ connection: 'disconnected' })

    await waitFor(() => expect(screen.queryByTestId('sync-warning')).not.toBeInTheDocument())
  })

  it('snoozes the warning for five hours across component mounts', async () => {
    const user = userEvent.setup()
    const { unmount } = renderWarning({ status: status('error', 'Network unavailable.') })

    await user.click(await screen.findByRole('button', { name: 'Hide for 5 hours' }))
    await waitFor(() => expect(screen.queryByTestId('sync-warning')).not.toBeInTheDocument())

    const record = await db.meta.get('sync:warningSnoozedUntil')
    expect(record?.value).toBeGreaterThan(Date.now())
    expect(record?.value).toBeLessThanOrEqual(Date.now() + SYNC_WARNING_SNOOZE_MS)

    unmount()
    renderWarning({ status: status('error', 'Network unavailable.') })
    await waitFor(() => expect(screen.queryByTestId('sync-warning')).not.toBeInTheDocument())
  })
})
