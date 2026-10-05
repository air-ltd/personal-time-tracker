import { runSync, type SyncLogEntry, type SyncOutcome } from './engine'
import type { SyncProvider } from './provider'
import type { Snapshot } from '../domain/merge'
import { SCHEMA_VERSION } from '../storage/db'
import { subscribe } from '../storage/events'
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
 *
 * The local-write trigger is the storage layer's revision counter rather than an
 * argument passed in by whichever view happened to make the change. That inversion
 * matters: with the trigger supplied from outside, `schedule()` was reachable only if
 * every write path remembered to call it, none did, and the debounce behaviour it
 * implements (0012 C2) was unreachable in production while its tests passed. Every
 * write already bumps the revision, so subscribing to it here means the trigger cannot
 * be forgotten — there is nowhere else for it to live.
 */

export const DEBOUNCE_MS = 5_000

export interface SyncConfig {
  provider: SyncProvider
  path: string
  debounceMs?: number
  now?: () => Date
  onLog?: (entry: SyncLogEntry) => void
  onStatus?: (status: SyncStatus) => void
  /**
   * Storage seams. Default to the real repository; overridable so the scheduler can be
   * tested without IndexedDB, and so a different backing store could be substituted
   * without touching the engine.
   */
  readLocal?: () => Promise<Snapshot>
  writeLocal?: (snapshot: Snapshot) => Promise<void>
  readLastRev?: () => Promise<string | null>
  writeLastRev?: (rev: string | null) => Promise<void>
  writeLastSyncAt?: (at: string) => Promise<void>
  readLastSyncAt?: () => Promise<string | null>
  /**
   * Called after the scheduler discards a token it cannot use.
   *
   * The scheduler is the only thing that discovers this — the provider notices a token has
   * expired, and nothing else observes the sign-out. So whoever owns the *connection*
   * state has to be told, or the app keeps claiming to be connected to a provider it has
   * just disconnected from, and never offers the button that would fix it.
   */
  onAuthLost?: () => void
}

export interface SyncStatus {
  /**
   * `disabled` was removed rather than rendered.
   *
   * It was emitted for a `skipped` outcome, which is always `not-authenticated` — a token
   * that has expired or been revoked, not a provider that is switched off. Nothing else
   * could produce it, and no view handled it, so an expired token rendered as a green
   * "Synced". Adding a branch for a state that can only mean "disconnected while claiming
   * to be connected" would have been a fourth way to say the same wrong thing; the honest
   * end state is that the state cannot be represented because the condition cannot occur.
   */
  state: 'idle' | 'syncing' | 'error'
  lastOutcome: SyncOutcome | null
  lastSyncAt: string | null
  /**
   * The remote revision this device last published.
   *
   * Reported rather than branched on. It is the quickest way to answer "are these two
   * devices looking at the same file?" when a sync problem has to be diagnosed, and it
   * costs nothing to keep — but nothing may decide behaviour from it (see `SyncDeps`).
   */
  lastRev: string | null
  message: string | null
  /**
   * A local change is waiting to be published.
   *
   * 0012 C8 requires pending changes to be visible, and it is the one part of that
   * requirement with no other source: `lastSyncAt` is about the past, and `state` is
   * about the current cycle. Without this the honest answer to "is my work on the other
   * device yet?" is "I cannot tell", which is what 0012 C8 exists to prevent — and on a
   * laptop that is closed rather than tab-switched it can be hours.
   */
  pending: boolean
}

/** Failures that mean the stored token cannot be used and must be replaced. */
function isAuthFailure(kind: string): boolean {
  return kind === 'auth' || kind === 'scope-missing'
}

/**
 * What to say when the stored token turns out to be unusable.
 *
 * Says what happened and what is still true, and nothing more. The precise cause — expired,
 * revoked, or the app's permissions changed — is not knowable from here, and guessing
 * between them is the kind of confident wrong answer that costs the user more time than
 * admitting it.
 */
const TOKEN_LOST =
  'Dropbox sign-in has expired or is no longer valid, so sync is paused. ' +
  'Your data is safe in this browser — reconnect to carry on syncing.'

export class SyncScheduler {
  private readonly provider: SyncProvider
  private readonly path: string
  private readonly debounceMs: number
  private readonly now: () => Date
  private readonly onStatus: ((status: SyncStatus) => void) | undefined
  private readonly logSink: ((entry: SyncLogEntry) => void) | undefined
  private readonly readLocal: () => Promise<Snapshot>
  private readonly writeLocal: (snapshot: Snapshot) => Promise<void>
  private readonly readLastRev: () => Promise<string | null>
  private readonly writeLastRev: (rev: string | null) => Promise<void>
  private readonly writeLastSyncAt: (at: string) => Promise<void>
  private readonly readLastSyncAt: () => Promise<string | null>
  private readonly onAuthLost: (() => void) | undefined

  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private onVisibilityChange: (() => void) | null = null
  private onPageHide: (() => void) | null = null
  private onRevision: (() => void) | null = null
  private detachRevision: (() => void) | null = null
  /**
   * True while this scheduler is the one writing, so the bump its own write causes is
   * not mistaken for the user having changed something.
   *
   * Without this every sync that merged remote data would schedule another cycle to
   * publish the write it had just made — a second round trip that finds nothing. It has
   * to be a flag around `writeLocal` rather than a revision comparison because a user
   * write that lands *during* a cycle must still be noticed; the two are indistinguishable
   * by revision number, and only by asking who caused it.
   */
  private writingLocally = false
  private stopped = false
  private running = false
  private queuedWhileRunning = false
  /**
   * Whether changes are still outstanding: an armed debounce, or work that arrived after the
   * current cycle started reading.
   *
   * This is what makes `pending` *work*-scoped rather than cycle-scoped. The cycle's
   * `finally` used to clear `pending` unconditionally, so a write landing mid-cycle lit the
   * indicator and then had it cleared by a cycle that had already passed it — leaving the
   * flag false for the whole 5s debounce before the change was actually pushed. Nothing was
   * lost, but the indicator was wrong in exactly the window it exists to describe.
   */
  private workOutstanding = false
  private started = false
  private status: SyncStatus = {
    lastRev: null,
    state: 'idle',
    lastOutcome: null,
    lastSyncAt: null,
    message: null,
    pending: false,
  }

  constructor(config: SyncConfig) {
    this.provider = config.provider
    this.path = config.path
    this.debounceMs = config.debounceMs ?? DEBOUNCE_MS
    this.now = config.now ?? (() => new Date())
    this.onStatus = config.onStatus
    this.logSink = config.onLog
    this.readLocal = config.readLocal ?? readSnapshot
    // Wrapped rather than assigned directly: this is the only place the scheduler can
    // cause a revision bump, and the subscription below has to be able to tell.
    const writeLocal = config.writeLocal ?? writeSnapshot
    this.writeLocal = async (snapshot: Snapshot) => {
      this.writingLocally = true
      try {
        await writeLocal(snapshot)
      } finally {
        this.writingLocally = false
      }
    }
    this.readLastRev = config.readLastRev ?? readLastRev
    this.writeLastRev = config.writeLastRev ?? writeLastRev
    this.writeLastSyncAt = config.writeLastSyncAt ?? writeLastSyncAt
    this.readLastSyncAt = config.readLastSyncAt ?? readLastSyncAt
    this.onAuthLost = config.onAuthLost
  }

  /**
   * Level defaults to `info` because most scheduler messages are ordinary lifecycle
   * notes — a cycle starting, nothing to publish. Previously hardcoded to `warn`, which
   * made every routine message look like a problem in the log.
   */
  private log(message: string, level: SyncLogEntry['level'] = 'info'): void {
    this.logSink?.({ at: this.now().toISOString(), level, message })
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
    this.onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void this.syncNow()
    }
    document.addEventListener('visibilitychange', this.onVisibilityChange)

    // W7 / 0012 C1: the last reliable hook before a tab is discarded. A best-effort
    // push here, never a blocking prompt.
    this.onPageHide = () => {
      void this.syncNow()
    }
    window.addEventListener('pagehide', this.onPageHide)

    // Local writes (0012 C1, C2). Subscribed here rather than passed in, because the
    // signal already exists and every write path already produces it — the earlier
    // arrangement depended on each write path remembering, and none did.
    //
    // Stored before the first `await` so `stop()` can detach it even if it is called
    // while `start()` is still waiting on storage. Registering it afterwards left a
    // live subscription belonging to a scheduler nobody held, still scheduling cycles.
    this.onRevision = () => {
      if (this.writingLocally) return
      this.schedule()
    }
    this.detachRevision = subscribe(this.onRevision)

    await this.loadLastSyncAt()
    // Once per app start, not per cycle: the revision is a reportable fact, not an input
    // to any decision.
    // Emitted rather than assigned, so the panel sees it like any other status change.
    this.emit({ lastRev: await this.readLastRev() })
    await this.syncNow()
  }

  /**
   * Stop scheduling.
   *
   * Detaches the listeners as well as clearing the pending timer. Clearing the timer
   * alone left `visibilitychange` and `pagehide` attached and `schedule()` still armed,
   * so a stopped scheduler kept syncing — the method said one thing and did another.
   */
  stop(): void {
    this.stopped = true
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = null
    this.detachRevision?.()
    this.detachRevision = null
    this.onRevision = null
    if (this.onVisibilityChange) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange)
      this.onVisibilityChange = null
    }
    if (this.onPageHide) {
      window.removeEventListener('pagehide', this.onPageHide)
      this.onPageHide = null
    }
  }

  /**
   * Schedule a sync after a quiet period.
   *
   * Coalesces a burst of edits into one cycle, and flushes on a timer even if
   * editing continues, so an extended session still syncs (0012 C2).
   *
   * Called by the revision subscription above on every local write, which is what makes
   * "syncs after you record something" true without any view knowing sync exists.
   */
  schedule(): void {
    // Ignored once stopped, so a late write cannot resurrect a scheduler the app has
    // already torn down.
    if (this.stopped) return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    // Announced the moment the change is registered rather than when the cycle runs, so
    // "pending" covers the whole debounce window rather than only the round trip.
    this.workOutstanding = true
    this.emit({ pending: true })
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
    // Everything outstanding is being read by this cycle from here on, so it no longer needs
    // announcing. Anything that arrives afterwards re-arms the flag in `schedule`.
    this.workOutstanding = false
    this.emit({ state: 'syncing', message: null })

    try {
      const outcome = await runSync({
        provider: this.provider,
        path: this.path,
        supportedSchemaVersion: SCHEMA_VERSION,
        readLocal: this.readLocal,
        writeLocal: this.writeLocal,
        // The engine records the revision but never reads it; the scheduler reads it
        // once at startup for the status line.
        writeLastRev: this.writeLastRev,
        now: this.now,
        onLog: (entry: SyncLogEntry) => {
          if (entry.level === 'error') this.emit({ message: entry.message })
        },
      })

      const at = this.now().toISOString()

      // A rejected token is provably unusable — expired, or granted without the
      // permissions the app now needs. Discarding it loses nothing (local data is
      // untouched by sign-out) and turns a dead end into a single reconnect, rather
      // than an error message explaining that disconnecting is the fix.
      /*
       * `skipped` is `not-authenticated`, and it means the token died rather than that
       * there was never one.
       *
       * The scheduler only runs while `connection === 'connected'`, so "not signed in"
       * arriving here cannot be a first run — it is a token that has expired or been
       * revoked since the last cycle. It used to emit `disabled`, a state no view renders:
       * the indicator tests `state === 'error'`, so an expired token produced a green
       * "Synced" indefinitely and the Connect button never came back.
       *
       * That is the failure this whole implementation exists to prevent (0012 AU8): the
       * user is told their work is on the other device when it is not. It is handled as
       * the auth failure it is, so the existing recovery runs.
       */
      const tokenUnusable =
        outcome.status === 'skipped' ||
        (outcome.status === 'failed' && isAuthFailure(outcome.kind))

      if (tokenUnusable) {
        this.log(
          'The saved Dropbox token stopped working; discarded it so you can reconnect.',
          'warn',
        )
        await this.provider.signOut()
        // Whoever owns the connection state has to learn about this, or the app goes on
        // claiming to be connected to a provider it has just signed out of.
        this.onAuthLost?.()
      }

      if (outcome.status === 'pushed' || outcome.status === 'up-to-date') {
        await this.writeLastSyncAt(at)
        this.emit({ state: 'idle', lastOutcome: outcome, lastSyncAt: at, message: null })
      } else if (tokenUnusable) {
        this.emit({
          state: 'error',
          lastOutcome: outcome,
          message: TOKEN_LOST,
        })
      } else if (outcome.status === 'failed' && isAuthFailure(outcome.kind)) {
        // Already discarded above; the panel will offer Connect again.
        //
        // `scope-missing` is usually the Dropbox *app console* missing a scope, not a
        // bad token: reauthorising cannot fix it, and the Connect button reappearing
        // with no explanation is the only clue the user would otherwise get. Say so,
        // and name the two settings that have to agree.
        this.emit({
          state: 'error',
          lastOutcome: outcome,
          message:
            outcome.kind === 'scope-missing'
              ? 'Dropbox rejected the app for a missing permission. Check the app’s ' +
                'scopes and redirect URI in the Dropbox App Console match the Connect ' +
                'screen, then connect again.'
              : outcome.message,
        })
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
      // Cleared rather than left lit forever on a failed cycle: a failure has still resolved
      // whatever it could, and an indicator that never goes out trains the user to ignore it.
      // But only when nothing is outstanding — a write that arrived mid-flight set
      // `workOutstanding`, and clearing the flag then would misreport the 5s debounce
      // window as synced. That write's own cycle, or the queued one below, clears it.
      if (!this.workOutstanding) this.emit({ pending: false })
      if (this.queuedWhileRunning) {
        this.queuedWhileRunning = false
        void this.syncNow()
      }
    }
  }

  private async loadLastSyncAt(): Promise<void> {
    const at = await this.readLastSyncAt()
    this.emit({ lastSyncAt: at })
  }

  getStatus(): SyncStatus {
    return this.status
  }
}
