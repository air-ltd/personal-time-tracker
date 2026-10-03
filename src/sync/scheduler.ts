import { runSync, type SyncLogEntry, type SyncOutcome } from './engine'
import type { SyncProvider } from './provider'
import { SCHEMA_VERSION } from '../storage/db'
import {
  readLastRev,
  readLastSyncAt,
  readSnapshot,
  writeLastRev,
  writeLastSyncAt,
  writeSnapshot,
} from '../storage/snapshotRepo'

/**
 * Sync scheduling (0012 C1–C7).
 *
 * Triggers: app open, a debounced local write, returning to the tab, `pagehide`,
 * and a manual button. Deliberately no background polling (C6): there is no inbound
 * push path, so a timer produces only empty cycles and keeps the device awake.
 */

export const DEBOUNCE_MS = 5_000

export interface SyncConfig {
  provider: SyncProvider
  path: string
  debounceMs?: number
  now?: () => Date
  onStatus?: (status: SyncStatus) => void
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error' | 'disabled'
  lastOutcome: SyncOutcome | null
  lastSyncAt: string | null
  message: string | null
}

export class SyncScheduler {
  private readonly provider: SyncProvider
  private readonly path: string
  private readonly debounceMs: number
  private readonly now: () => Date
  private readonly onStatus: ((status: SyncStatus) => void) | undefined

  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private queuedWhileRunning = false
  private started = false
  private status: SyncStatus = {
    state: 'idle',
    lastOutcome: null,
    lastSyncAt: null,
    message: null,
  }

  constructor(config: SyncConfig) {
    this.provider = config.provider
    this.path = config.path
    this.debounceMs = config.debounceMs ?? DEBOUNCE_MS
    this.now = config.now ?? (() => new Date())
    this.onStatus = config.onStatus
  }

  private emit(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch }
    this.onStatus?.(this.status)
  }

  /**
   * Begin scheduling. Safe to call once; the load-time sync runs here (0012 C1).
   */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    // Tab focus: the user has just come back, so this is the moment most likely to
    // want a fresh pull.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.syncNow()
    })

    // W7 / 0012 C1: the last reliable hook before a tab is discarded. A best-effort
    // push here, never a blocking prompt.
    window.addEventListener('pagehide', () => {
      void this.syncNow()
    })

    await this.loadLastSyncAt()
    await this.syncNow()
  }

  stop(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = null
  }

  /**
   * Schedule a sync after a quiet period.
   *
   * Coalesces a burst of edits into one cycle, and flushes on a timer even if
   * editing continues, so an extended session still syncs (0012 C2).
   */
  schedule(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.syncNow()
    }, this.debounceMs)
  }

  /**
   * Run a cycle now.
   *
   * Two concurrent cycles are the most likely source of duplicate or lost writes
   * (0012 C3), so a cycle arriving mid-flight is remembered and run once after, not
   * run in parallel.
   */
  async syncNow(): Promise<SyncOutcome | null> {
    if (this.running) {
      this.queuedWhileRunning = true
      return null
    }
    this.running = true
    this.emit({ state: 'syncing', message: null })

    try {
      const outcome = await runSync({
        provider: this.provider,
        path: this.path,
        supportedSchemaVersion: SCHEMA_VERSION,
        readLocal: readSnapshot,
        writeLocal: writeSnapshot,
        readLastRev,
        writeLastRev,
        now: this.now,
        onLog: (entry: SyncLogEntry) => {
          if (entry.level === 'error') this.emit({ message: entry.message })
        },
      })

      const at = this.now().toISOString()
      if (outcome.status === 'pushed' || outcome.status === 'up-to-date') {
        await writeLastSyncAt(at)
        this.emit({ state: 'idle', lastOutcome: outcome, lastSyncAt: at, message: null })
      } else if (outcome.status === 'skipped') {
        this.emit({ state: 'disabled', lastOutcome: outcome, message: null })
      } else {
        this.emit({
          state: 'error',
          lastOutcome: outcome,
          message:
            outcome.status === 'blocked' ? outcome.message : `Sync failed: ${outcome.message}`,
        })
      }
      return outcome
    } finally {
      this.running = false
      if (this.queuedWhileRunning) {
        this.queuedWhileRunning = false
        void this.syncNow()
      }
    }
  }

  private async loadLastSyncAt(): Promise<void> {
    const at = await readLastSyncAt()
    this.emit({ lastSyncAt: at })
  }

  getStatus(): SyncStatus {
    return this.status
  }
}
