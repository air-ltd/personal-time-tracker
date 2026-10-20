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
  /**
   * A message describing why this device's data cannot go to the connected account,
   * or null when there is no problem.
   *
   * Optional, and a function rather than data, because the check needs two things the
   * engine does not have: the account the local data is bound to, and the account the
   * connected token belongs to.
   */
  findAccountMismatch?: () => Promise<string | null>
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
  /**
   * The remote file is not valid JSON.
   *
   * Distinct from `unsupported-schema` because the advice is different: a schema
   * mismatch is fixed by updating the app, and a corrupt file is not. It is also
   * distinct because a corrupt remote is not overwritten — pushing over it would
   * destroy whatever is really there.
   */
  | { status: 'blocked'; reason: 'corrupt-remote'; message: string }
  /**
   * The connected account is not the one this device's data belongs to.
   *
   * Publishing would hand the device's whole work history to a different account, so
   * the cycle stops before anything moves. The user has to say so explicitly.
   */
  | { status: 'blocked'; reason: 'different-account'; message: string }
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

    /*
     * 1b. Is this the account this device's data belongs to?
     *
     * Signing out leaves the local data behind (0012 AU7), so the data outlives the
     * connection. Connecting a different account afterwards would find an empty
     * remote and publish everything into it — the previous account's client names,
     * notes and hours, handed to a different readership without a word of warning.
     *
     * So the cycle stops here, before anything is pulled or published. The user is
     * told, and the way past it is explicit.
     *
     * An account that cannot be identified is not treated as a different one. A
     * guard that blocked every sync because it could not read an id would be a
     * worse failure than the one it prevents.
     */
    const mismatch = await deps.findAccountMismatch?.()
    if (mismatch !== undefined && mismatch !== null) {
      log(deps, 'error', mismatch)
      return { status: 'blocked', reason: 'different-account', message: mismatch }
    }

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

    /*
     * Parsed in two steps, so a file that is not JSON at all is reported as what it
     * is rather than as a parser error.
     *
     * `JSON.parse` throws on malformed input, and the message it throws names a
     * character offset in a file the user has never seen — "Unexpected token '}' in
     * JSON at position 412". That says nothing about what happened, nothing about
     * where the file came from, and nothing the user can act on.
     *
     * The file is not overwritten either: a corrupt remote is pushed over only by
     * the user, deliberately, through a restore.
     */
    let decoded: unknown
    try {
      decoded = JSON.parse(remote.body)
    } catch {
      const message =
        'The file in Dropbox could not be read, so it may have been corrupted. Nothing has ' +
        'been changed. Restore from a local backup if you have one.'
      log(deps, 'error', message)
      return { status: 'blocked', reason: 'corrupt-remote', message }
    }

    // The source is the sync path, so the messages name the file in Dropbox rather
    // than a backup the user never downloaded.
    const parsed = parseEnvelope(decoded, deps.supportedSchemaVersion, 'sync')
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

    // 5. Repair before anything is written or published, so local and remote hold the
    //    same records. Writing the unrepaired merge locally and publishing the repaired
    //    one left the database and the remote holding different data, so every
    //    subsequent cycle found a difference and pushed it again — a redundant write on
    //    every sync, indefinitely.
    //
    //    The comparison in step 7 runs against the repaired merge. Repair is idempotent,
    //    so once the repaired version has been published both sides agree and the cycle
    //    settles.
    //
    //    Ordering matters less than it used to: `repairReferences` no longer edits in
    //    place, so it cannot silently alter the merge it was handed. It still goes
    //    first, because there is no reason to write records we already know are wrong.
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
    /*
     * A `SyncError`'s message is written for the user. Anything else is an internal
     * failure, and its text names a function, a type or a line of code — forwarding
     * that verbatim tells the user nothing they can act on, and sometimes quotes
     * their own data back at them. This was how a corrupt remote file reached the
     * screen as "Unexpected token '}' in JSON at position 412".
     *
     * The detail still goes to the log, where it is useful and where nobody has to
     * read it.
     */
    const detail = error instanceof Error ? error.message : String(error)
    const message =
      error instanceof SyncError
        ? detail
        : 'Sync failed for an unexpected reason. Nothing has been changed — try again, and check the sync log if it keeps happening.'
    log(deps, 'error', error instanceof SyncError ? message : `${message} (${detail})`)
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
          // The same two steps as the first read: a body that is not JSON is reported
          // as what it is rather than as a parser error.
          let freshDecoded: unknown
          try {
            freshDecoded = JSON.parse(fresh.body)
          } catch {
            log(deps, 'warn', 'Remote file is not valid JSON; leaving it alone.')
            throw new SyncError('network', 'The file in Dropbox could not be read.')
          }
          const parsed = parseEnvelope(freshDecoded, deps.supportedSchemaVersion, 'sync')
          if (parsed.ok) {
            /*
             * Read local *again*, not the snapshot this cycle started with.
             *
             * The in-flight `snapshot` was read before the round trip, so anything the
             * user saved while the network was in flight is in neither argument to the
             * merge: it would not be merged, and it would not be pushed either. "Sync
             * now" would then report success while omitting the entry that was added a
             * second earlier — a success message that is not true of what the user just
             * did. One extra IndexedDB read on the already-rare conflict path is a good
             * trade for a result that means what it says.
             *
             * Read outside the merge so a write that lands during the *merge* itself is
             * not lost either; `writeLocal` is an upsert, so whatever it carries over an
             * unchanged row is preserved.
             */
            const local = await deps.readLocal()
            const outcome = mergeSnapshots(local, parsed.snapshot, deps.supportedSchemaVersion)
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
