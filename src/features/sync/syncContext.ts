import { createContext, useContext } from 'react'
import type { SyncStatus } from '../../sync/scheduler'
import type { describeKeySource } from '../../sync/appKey'

/**
 * The shared sync state, and the context that carries it (item 10 of `SPECS/todo.md`).
 *
 * Separate from the provider component because a module that exports both a component
 * and a hook defeats React Fast Refresh: editing the provider would then invalidate the
 * hook's module boundary as well.
 *
 * Types and the hook only. The state itself lives in `<SyncProvider>`.
 */

export type Connection = 'checking' | 'connected' | 'disconnected'

export interface SyncState {
  connection: Connection
  status: SyncStatus | null
  /** True while an OAuth round trip or a sync is in flight. */
  busy: boolean
  /** False when no Dropbox app key is configured at all. */
  hasKey: boolean
  keyInfo: ReturnType<typeof describeKeySource>
  authError: string | null
  /** Starts the Dropbox authorisation redirect. Leaves the page on success. */
  connect: () => void
  disconnect: () => void
  syncNow: () => void
  /** Re-read the app key after the setup panel configures one. */
  recheckKey: () => void
}

export const SyncContext = createContext<SyncState | null>(null)

/**
 * The shared sync state.
 *
 * Throws rather than returning a default when there is no provider: a component that
 * silently got a disconnected-and-inert sync state would look like a working app that
 * happens not to be syncing, which is the failure this whole feature exists to avoid.
 */
export function useSync(): SyncState {
  const value = useContext(SyncContext)
  if (value === null) throw new Error('useSync must be used inside <SyncProvider>')
  return value
}
