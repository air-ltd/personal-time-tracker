import { z } from 'zod'
import type { Mergeable, Snapshot } from '../domain/merge'
import type { EntrySource } from '../domain/entries/types'

/**
 * Backup envelope (0008 J1–J12).
 *
 * The same format is the sync wire format (0012 SY4), so one schema serves the
 * backup importer, the sync engine and a hand-recovered file from the provider.
 * A separate sync format would be a second schema to keep in step.
 *
 * OAuth credentials are deliberately absent. A backup is the kind of file people
 * email around, and it must not also grant access to the user's provider account
 * (0012 AU6).
 */

export const FORMAT = 'personal-time-tracker-backup'
/** Bumped only on a breaking layout change (0008 J3). */
export const FORMAT_VERSION = 1

/**
 * Where an envelope came from.
 *
 * The same format is the backup format and the sync wire format, so the same parse
 * serves both — and the message it produces has to name the right thing. A syncing
 * user told "Backup uses data schema 5" goes looking for a backup they never
 * downloaded, and the artefact is not the problem: the file in Dropbox is.
 *
 * `'backup'` is the default, so a caller that does not say which it is gets the
 * restore wording, which is the path that has a file picker in front of it.
 */
export type EnvelopeSource = 'backup' | 'sync'

/** How each source is named in a message the user reads. */
const SOURCE_LABELS: Record<EnvelopeSource, string> = {
  backup: 'Backup',
  sync: 'The file in Dropbox',
}

const isoInstant = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO instant')
const nullableIsoInstant = isoInstant.nullable()

/*
 * Bounds on the sizes a file may claim.
 *
 * A backup file arrives from outside — a file the user picked, or a blob in their
 * Dropbox account — so its shape is not the app's to assume. Without these, a
 * 64 MB file is accepted and then parsed, validated, merged and written in one
 * synchronous pass on the main thread, which freezes the tab and then fails on a
 * quota error. A file that is too large is *rejected*, which is a better answer than
 * a browser that stops responding.
 *
 * The limits are generous compared with the confirmed volume — under a hundred
 * entries a week, a few thousand in total — so they never bite on real data, and
 * tight enough that a hostile file is refused rather than absorbed.
 */

/** A note, a label, or a name. The app's own limit is 2,000 characters (0004 V4). */
const MAX_TEXT_LENGTH = 2_000

/** An identifier. A UUID with room to spare. */
const MAX_ID_LENGTH = 128

/** Tags on one entry. A person does not tag an entry with fifty things. */
const MAX_TAGS_PER_ENTRY = 64

/** The weekdays in a work pattern. 0003 CT2 says exactly seven, and only seven. */
const MAX_PATTERN_ENTRIES = 7

/** Records in one table of a file. Roughly a decade of entries. */
const MAX_RECORDS_PER_TABLE = 50_000

export const entrySchema = z.object({
  id: z.string().min(1).max(MAX_ID_LENGTH),
  projectId: z.string().max(MAX_ID_LENGTH).nullable(),
  tagIds: z.array(z.string().max(MAX_ID_LENGTH)).max(MAX_TAGS_PER_ENTRY),
  start: isoInstant,
  // Null only while running (0003 E4).
  end: nullableIsoInstant,
  note: z.string().max(MAX_TEXT_LENGTH),
  billable: z.boolean(),
  rateOverrideMinor: z.number().int().nonnegative().nullable(),
  source: z.enum(['timer', 'manual']) satisfies z.ZodType<EntrySource>,
  createdAt: isoInstant,
  updatedAt: isoInstant,
  deletedAt: nullableIsoInstant,
})

/**
 * Shape for tables that arrive in later phases.
 *
 * Present from the start so the envelope is complete per 0008 J2.1 and a user who
 * syncs during Phase 2B still round-trips a file whose optional tables are simply
 * empty. Tightened when the owning phase defines its fields, which is a schema
 * change rather than a format change.
 *
 * `looseObject` rather than `object` is deliberate. A plain Zod object *strips*
 * fields it does not know about, so a backup written by Phase 4 and synced into this
 * build would silently lose a project's colour, rate and everything else that
 * phase added — the opposite of 0008 J6, and a quiet way to destroy a user's data.
 * Passing unknown fields through means this build cannot understand them but can
 * still carry them.
 */
const deferredTable = z
  .array(
    z.looseObject({
      id: z.string().min(1).max(MAX_ID_LENGTH),
      updatedAt: isoInstant,
      deletedAt: nullableIsoInstant,
    }),
  )
  .max(MAX_RECORDS_PER_TABLE)
  .default([])

/**
 * One weekday's contracted minutes (0003 CT2).
 *
 * `weekday` is Monday-first: 0 is Monday, 6 is Sunday (0013 K3).
 */
const dayPatternSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  minutes: z.number().int().nonnegative().max(1440),
})

/**
 * A contract period (0003 §ContractPeriod).
 *
 * `looseObject` rather than `object`, for the same reason `deferredTable` uses it: a
 * plain Zod object strips fields it does not know about, so a contract period written
 * by a later build would silently lose whatever that build added. Validating the
 * fields this build knows while passing the rest through means it can reject a
 * malformed contract and still carry a newer one.
 *
 * `clientId` is required, because a contract with no client has no scope to be
 * compared against (0003 CT9) — a record without one is not a contract.
 */
const contractPeriodSchema = z.looseObject({
  id: z.string().min(1),
  clientId: z.string().min(1),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  minutesPerWeek: z.number().int().nonnegative(),
  workPattern: z.array(dayPatternSchema).max(MAX_PATTERN_ENTRIES),
  createdAt: isoInstant,
  updatedAt: isoInstant,
  deletedAt: nullableIsoInstant,
})

const entityTables = {
  entries: z.array(entrySchema).max(MAX_RECORDS_PER_TABLE),
  projects: deferredTable,
  clients: deferredTable,
  tags: deferredTable,
  contractPeriods: z.array(contractPeriodSchema).default([]),
  nonWorkingDays: deferredTable,
  /*
   * Settings, as mergeable rows (SPECS/todo.md item 46).
   *
   * `deferredTable`'s shape is exactly right for these — `id`, `updatedAt`, `deletedAt` —
   * because that is what makes a setting mergeable by the same union-by-id,
   * last-write-wins rule as everything else. `value` is `unknown` because the three settings
   * have three different value shapes, and `looseObject` passes it through rather than
   * stripping a shape this build does not recognise.
   *
   * `optional()` and not `default([])`: an older backup that predates this has no `settings`
   * key at all, and reading "absent" as "the user has no settings" would silently reset
   * them on restore. Absent means absent, and the local values are left alone.
   */
  settings: z
    .array(
      z.looseObject({
        id: z.string().min(1).max(MAX_ID_LENGTH),
        updatedAt: isoInstant,
        deletedAt: nullableIsoInstant,
      }),
    )
    .max(MAX_RECORDS_PER_TABLE)
    .optional(),
}

export const envelopeSchema = z.object({
  format: z.literal(FORMAT),
  formatVersion: z.number().int().positive(),
  schemaVersion: z.number().int().nonnegative(),
  exportedAt: isoInstant,
  counts: z.record(z.string(), z.number().int().nonnegative()),
  data: z.object(entityTables),
})

export type Envelope = z.infer<typeof envelopeSchema>

export class EnvelopeError extends Error {
  readonly issues: string[]
  constructor(message: string, issues: string[] = []) {
    super(message)
    this.name = 'EnvelopeError'
    this.issues = issues
  }
}

export type ParseResult = { ok: true; snapshot: Snapshot } | { ok: false; error: EnvelopeError }

/**
 * Parse a backup or sync payload.
 *
 * The format field is checked before anything else is interpreted (0008 J11), and
 * a future `formatVersion` is rejected rather than best-effort parsed (J12). A
 * payload is never partially applied: validation completes or nothing happens
 * (0007 F-EXPORT-4).
 */
export function parseEnvelope(
  raw: unknown,
  supportedSchemaVersion: number,
  source: EnvelopeSource = 'backup',
): ParseResult {
  const label = SOURCE_LABELS[source]

  const format = (raw as { format?: unknown } | null)?.format
  if (format !== FORMAT) {
    return {
      ok: false,
      error: new EnvelopeError(`Not a ${FORMAT} file.`),
    }
  }

  const version = (raw as { formatVersion?: unknown }).formatVersion
  if (typeof version === 'number' && version > FORMAT_VERSION) {
    return {
      ok: false,
      error: new EnvelopeError(
        `${label} format version ${version} is newer than this build supports (${FORMAT_VERSION}). Update the app before importing.`,
      ),
    }
  }

  const parsed = envelopeSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    )
    return { ok: false, error: new EnvelopeError(`${label} is not valid.`, issues) }
  }

  // M9: refuse rather than interpret a newer data schema.
  if (parsed.data.schemaVersion > supportedSchemaVersion) {
    return {
      ok: false,
      error: new EnvelopeError(
        `${label} uses data schema ${parsed.data.schemaVersion}, but this build understands ${supportedSchemaVersion}. Update the app.`,
      ),
    }
  }

  // J5: counts are the cheap integrity check — they let the importer confirm nothing
  // was truncated in transit. Validating the field was the easy half; comparing it to
  // what actually arrived is the half that catches a file cut short by a quota, a
  // half-finished upload, or a hand edit. A mismatch means the document is incomplete,
  // and importing it would silently drop records the user believes they backed up.
  //
  // Only tables this build parsed are compared. `counts` is an open record, so a newer
  // build's tables arrive as a count naming something that `envelopeSchema` stripped —
  // and refusing that file would break 0008 J6, which requires an older build to be
  // able to carry a newer build's backup. Not being able to see a table is not
  // evidence that its records are missing.
  const data = parsed.data.data as Record<string, unknown[] | undefined>
  const mismatched = Object.entries(parsed.data.counts).filter(
    ([name, count]) => data[name] !== undefined && count !== data[name]?.length,
  )
  if (mismatched.length > 0) {
    return {
      ok: false,
      error: new EnvelopeError(
        'Backup is incomplete: it says it contains records that are not there.',
        mismatched.map(([name, count]) => `${name}: expected ${count} records`),
      ),
    }
  }

  // `settings` is optional in the schema and therefore possibly `undefined` here. Dropped
  // rather than defaulted to `[]`: an empty array is a real assertion that the user has no
  // settings, and treating a file that never mentioned them as making that assertion is how
  // a restore quietly resets someone's preferences.
  const { settings, ...rest } = parsed.data.data
  const entities: Record<string, Mergeable[]> = rest
  if (settings !== undefined) entities['settings'] = settings
  return { ok: true, snapshot: { schemaVersion: parsed.data.schemaVersion, entities } }
}

/** Build an envelope from a snapshot. Field names are passed through unchanged (J6). */
export function toEnvelope(snapshot: Snapshot, exportedAt: Date): Envelope {
  const data = {
    entries: (snapshot.entities['entries'] ?? []) as Envelope['data']['entries'],
    projects: (snapshot.entities['projects'] ?? []) as Envelope['data']['projects'],
    clients: (snapshot.entities['clients'] ?? []) as Envelope['data']['clients'],
    tags: (snapshot.entities['tags'] ?? []) as Envelope['data']['tags'],
    contractPeriods: (snapshot.entities['contractPeriods'] ??
      []) as Envelope['data']['contractPeriods'],
    nonWorkingDays: (snapshot.entities['nonWorkingDays'] ??
      []) as Envelope['data']['nonWorkingDays'],
    // Omitted when there are none, rather than written as an empty array, so a file written
    // by this build is indistinguishable from one written before settings existed. Either
    // way the reader treats absent as "no opinion".
    ...(snapshot.entities['settings'] === undefined
      ? {}
      : { settings: snapshot.entities['settings'] as Envelope['data']['settings'] }),
  }

  // J5: counts let the importer confirm nothing was truncated in transit.
  const counts: Record<string, number> = {}
  for (const [name, table] of Object.entries(data)) {
    // Only tables that are actually present are counted. `settings` is optional, so
    // iterating the shape of `data` rather than its keys would count `undefined` and
    // report a table the file never had.
    if (Array.isArray(table)) counts[name] = table.length
  }

  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    schemaVersion: snapshot.schemaVersion,
    exportedAt: exportedAt.toISOString(),
    counts,
    data,
  }
}

/**
 * Serialise for the wire.
 *
 * Compact rather than pretty-printed (J9): these files get emailed, and newlines
 * triple the size for no benefit.
 */
export function serialiseEnvelope(envelope: Envelope): string {
  return JSON.stringify(envelope)
}
