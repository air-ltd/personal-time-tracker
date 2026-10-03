import {
  canonicalStringify,
  mergeSnapshots,
  repairReferences,
  type Snapshot,
} from '../domain/merge'
import { parseEnvelope, serialiseEnvelope, toEnvelope } from '../export/envelope'
import { SyncError, type RemoteFile, type SyncProvider } from './provider'

/**
 * Sync engine (0012 C4–C5, M1–M11).
 *
 * Local-first: IndexedDB is the source of truth and every step here is
 * best-effort. A failure must leave the app fully usable (0012 SY3).
 */

export interface SyncDeps {
  provider: SyncProvider
  path: string
  supportedSchemaVersion: number
  /** Read the current local database as a snapshot. */
  readLocal: () => Promise<Snapshot>
  /** Replace local data with a merged snapshot. */
  writeLocal: (snapshot: Snapshot) => Promise<void>
  /**
   * Record the revision this device has published.
   *
   * There is deliberately no reader here. An earlier version compared this against the
   * pulled revision to decide whether to publish, which could not distinguish "nothing
   * happened anywhere" from "only this device changed" — a local-only change leaves the
   * remote revision untouched — so local edits and deletions silently never synced.
   * The engine now compares merged content instead. The revision is still recorded
   * because it is a useful fact to be able to report; the scheduler reads it once at
   * startup and exposes it in its status rather than paying for a read per cycle.
   */
  writeLastRev: (rev: string | null) => Promise<void>
  now: () => Date
  onLog?: (event: SyncLogEntry) => void
}

export interface SyncLogEntry {
  at: string
  level: 'info' | 'warn' | 'error'
  message: string
}

export type SyncOutcome =
  | { status: 'skipped'; reason: 'not-authenticated' }
  | { status: 'pushed'; rev: string; merged: boolean }
  | { status: 'up-to-date' }
  | { status: 'blocked'; reason: 'unsupported-schema'; message: string }
  | { status: 'failed'; message: string; kind: SyncError['kind'] }

const MAX_ATTEMPTS = 3
const BACKOFF_MS = 500

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function log(deps: SyncDeps, level: SyncLogEntry['level'], message: string): void {
  deps.onLog?.({ at: deps.now().toISOString(), level, message })
}

/**
 * Run one sync cycle.
 *
 * The cycle must never overlap itself: two concurrent cycles are the most likely
 * source of duplicate or lost writes (0012 C3), so the caller is responsible for
 * serialising calls and `runSync` is not re-entrant.
 */
export async function runSync(deps: SyncDeps): Promise<SyncOutcome> {
  try {
    // 1. If this fails there is nothing to do and nothing is broken: the app works
    //    locally and offline (0012 SY3).
    try {
      await deps.provider.ensureAuth()
    } catch {
      log(deps, 'warn', 'Not signed in to the sync provider; continuing locally.')
      return { status: 'skipped', reason: 'not-authenticated' }
    }

    const local = await deps.readLocal()

    // 2. Pull. Null means the file does not exist, which is a first run.
    let remote: RemoteFile | null = null
    try {
      remote = await deps.provider.pull(deps.path)
    } catch (error) {
      if (error instanceof SyncError && error.kind === 'not-found') remote = null
      else throw error
    }

    if (!remote) {
      // First run on this provider: publish what we have (0012 C4 step 3).
      log(deps, 'info', 'No remote file yet; creating one from local data.')
      const rev = await pushWithRetry(deps, local, null)
      await deps.writeLastRev(rev)
      return { status: 'pushed', rev, merged: false }
    }

    const parsed = parseEnvelope(JSON.parse(remote.body), deps.supportedSchemaVersion)
    if (!parsed.ok) {
      // Refuse rather than interpret. Pushing over the top would destroy whatever
      // is actually on the remote (0012 M9).
      log(deps, 'error', parsed.error.message)
      return {
        status: 'blocked',
        reason: 'unsupported-schema',
        message: parsed.error.message,
      }
    }

    const remoteSnapshot = parsed.snapshot

    // 4. Merge first, then decide what to publish.
    const outcome = mergeSnapshots(local, remoteSnapshot, deps.supportedSchemaVersion)
    if (!outcome.ok) {
      const message = `Remote data uses schema ${outcome.remoteSchemaVersion}; this build understands ${deps.supportedSchemaVersion}. Not syncing.`
      log(deps, 'error', message)
      return { status: 'blocked', reason: 'unsupported-schema', message }
    }

    // 5. Repair before anything is written or published.
    //
    //    `repairReferences` nulls references that resolve in neither snapshot. It has to
    //    happen first so local and remote see the same records: writing the unrepaired
    //    merge locally and publishing the repaired one left the database and the remote
    //    holding different data, so every subsequent cycle found a difference and pushed
    //    it again — a redundant write on every sync, indefinitely.
    //
    //    The comparison in step 6 therefore runs against the repaired merge. Repair is
    //    idempotent, so once the repaired version has been published both sides agree
    //    and the cycle settles.
    const merged = repairReferences(outcome.merged)

    // 6. Reconcile locally regardless, so this device always converges on the union even
    //    when there is nothing to publish.
    await deps.writeLocal(merged)

    // 7. Publish only if the union differs from what the remote already holds.
    //
    //    The decision is by content, not by revision. A local edit, addition or deletion
    //    leaves the remote revision untouched, so comparing revisions concluded there was
    //    nothing to do — and local-only changes then never reached the provider at all.
    //    That is why deleting an entry left it sitting in Dropbox unchanged.
    //
    //    The merge is a union, so the result already contains everything the remote
    //    holds. Equality therefore means the remote is current, and pushing would be a
    //    no-op write that only mints a new revision.
    if (canonicalStringify(merged) === canonicalStringify(remoteSnapshot)) {
      await deps.writeLastRev(remote.rev)
      log(deps, 'info', 'Local and remote are in agreement; nothing to publish.')
      return { status: 'up-to-date' }
    }

    const rev = await pushWithRetry(deps, merged, remote.rev)
    await deps.writeLastRev(rev)

    log(deps, 'info', 'Merged changes and published local data.')
    return { status: 'pushed', rev, merged: true }
  } catch (error) {
    const kind = error instanceof SyncError ? error.kind : 'unknown'
    const message = error instanceof Error ? error.message : String(error)
    log(deps, 'error', message)
    // Local data is untouched on every path here, which is the point of local-first.
    return { status: 'failed', message, kind }
  }
}

/**
 * Push with a bounded number of attempts.
 *
 * A rejection means something else wrote the file since the pull, so the correct
 * response is to re-run the whole cycle from the pull, not to retry the same push.
 * Retrying the push alone would clobber the other writer (0012 C5).
 */
async function pushWithRetry(
  deps: SyncDeps,
  snapshot: Snapshot,
  expectedRev: string | null,
): Promise<string> {
  let rev: string | null = expectedRev

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await delay(BACKOFF_MS * attempt)

    const body = serialiseEnvelope(toEnvelope(snapshot, deps.now()))
    try {
      const result = await deps.provider.push(deps.path, body, rev)
      return result.rev
    } catch (error) {
      const isConflict = error instanceof SyncError && error.kind === 'conflict'
      const retryable = error instanceof SyncError && error.retryable
      if (!isConflict && !retryable) throw error
      if (attempt === MAX_ATTEMPTS - 1) throw error

      if (isConflict) {
        // Re-read so the next merge sees the other writer's data instead of
        // overwriting it with a stale expectedRev.
        log(deps, 'warn', 'Remote changed during sync; re-reading and retrying.')
        const fresh = await deps.provider.pull(deps.path)
        if (fresh) {
          const parsed = parseEnvelope(JSON.parse(fresh.body), deps.supportedSchemaVersion)
          if (parsed.ok) {
            const outcome = mergeSnapshots(
              snapshot,
              parsed.snapshot,
              deps.supportedSchemaVersion,
            )
            if (outcome.ok) {
              snapshot = repairReferences(outcome.merged)
              await deps.writeLocal(snapshot)
            }
          }
          rev = fresh.rev
        }
      }
    }
  }

  throw new SyncError('network', 'Push did not succeed after retrying')
}
