import { mergeSnapshots, type Snapshot } from '../domain/merge'
import { MINUTE } from '../domain/time/duration'
import { parseEnvelope, serialiseEnvelope, toEnvelope } from './envelope'

/**
 * Local backup: export and restore (0008 J1–J12, Phase 2B gate).
 *
 * The sync blob *is* the backup format, so this is the same envelope Dropbox carries,
 * used over a file the user keeps. It matters most when sync is unavailable — no
 * account, a rejected token, an offline device — which is exactly when a user reaches
 * for it.
 *
 * Two properties are non-negotiable:
 *
 * - No credential ever leaves. The snapshot is built from the entity tables only, and
 *   `secrets` is not one of them (0012 AU6). A backup restored on another machine must
 *   not hand over a working Dropbox token.
 * - A restore never loses local data. Restore merges rather than replaces, so a file
 *   that is stale, partial or from an older build can only add or update records. A
 *   replace would let a mistyped file silently empty the database.
 */

export interface BackupDeps {
  readLocal: () => Promise<Snapshot>
  writeLocal: (snapshot: Snapshot) => Promise<void>
  supportedSchemaVersion: number
  now: () => Date
}

export interface BackupSummary {
  filename: string
  body: string
  /** Record count per table, for the confirmation the user reads before trusting it. */
  counts: Record<string, number>
}

export type RestoreOutcome =
  | { status: 'restored'; counts: Record<string, number>; exportedAt: string | null }
  | { status: 'rejected'; message: string; issues: string[] }

/**
 * Filename for a downloaded backup.
 *
 * Local date rather than UTC: the file is named for the day the user recognises, and a
 * backup taken at 23:30 in London should not be labelled with tomorrow's date.
 */
export function backupFilename(now: Date): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * MINUTE)
  const day = local.toISOString().slice(0, 10)
  return `time-tracker-backup-${day}.json`
}

/** Serialise local data into a downloadable backup. */
export async function createBackup(deps: BackupDeps): Promise<BackupSummary> {
  const snapshot = await deps.readLocal()
  const envelope = toEnvelope(snapshot, deps.now())
  return {
    filename: backupFilename(deps.now()),
    body: serialiseEnvelope(envelope),
    counts: envelope.counts,
  }
}

/**
 * Restore from a backup file's text.
 *
 * Validation is total before anything is written: a payload is never partially applied
 * (0007 F-EXPORT-4), so a malformed file leaves the database untouched rather than
 * half-imported.
 */
export async function restoreBackup(deps: BackupDeps, raw: string): Promise<RestoreOutcome> {
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    return { status: 'rejected', message: 'That file is not valid JSON.', issues: [] }
  }

  // `parseEnvelope` rejects an unknown format, a newer format version and a newer data
  // schema. A future build's file must not be half-understood.
  const parsed = parseEnvelope(decoded, deps.supportedSchemaVersion)
  if (!parsed.ok) {
    return { status: 'rejected', message: parsed.error.message, issues: parsed.error.issues }
  }

  const local = await deps.readLocal()
  const outcome = mergeSnapshots(local, parsed.snapshot, deps.supportedSchemaVersion)
  if (!outcome.ok) {
    // Unreachable via `parseEnvelope`, which already rejects a newer schema. Kept
    // because the merge is the authority on schema compatibility and a future change
    // there must not become an unhandled path.
    return {
      status: 'rejected',
      message: `Backup uses data schema ${outcome.remoteSchemaVersion}; this build understands ${outcome.supportedSchemaVersion}.`,
      issues: [],
    }
  }

  /*
   * Written as merged, without `repairReferences`.
   *
   * Repair belongs to sync, where a partial or stale merge is normal and a dangling
   * reference means two devices disagree. A restore is not that: it is a recovery
   * action, and silently rewriting records in someone's backup while recovering it is
   * a modification they did not ask for and cannot see. An entry referencing a project
   * absent from the file renders uncategorised, which is honest about the file's
   * contents; nulling the reference instead quietly changes the data.
   */
  const merged = outcome.merged
  await deps.writeLocal(merged)

  const counts: Record<string, number> = {}
  for (const [table, records] of Object.entries(merged.entities)) counts[table] = records.length

  const exportedAt = (decoded as { exportedAt?: unknown }).exportedAt
  return {
    status: 'restored',
    counts,
    exportedAt: typeof exportedAt === 'string' ? exportedAt : null,
  }
}
