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

const isoInstant = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO instant')
const nullableIsoInstant = isoInstant.nullable()

export const entrySchema = z.object({
  id: z.string().min(1),
  projectId: z.string().nullable(),
  tagIds: z.array(z.string()),
  start: isoInstant,
  // Null only while running (0003 E4).
  end: nullableIsoInstant,
  note: z.string(),
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
      id: z.string().min(1),
      updatedAt: isoInstant,
      deletedAt: nullableIsoInstant,
    }),
  )
  .default([])

const entityTables = {
  entries: z.array(entrySchema),
  projects: deferredTable,
  clients: deferredTable,
  tags: deferredTable,
  contractPeriods: deferredTable,
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
        id: z.string().min(1),
        updatedAt: isoInstant,
        deletedAt: nullableIsoInstant,
      }),
    )
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
export function parseEnvelope(raw: unknown, supportedSchemaVersion: number): ParseResult {
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
        `Backup format version ${version} is newer than this build supports (${FORMAT_VERSION}). Update the app before importing.`,
      ),
    }
  }

  const parsed = envelopeSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    )
    return { ok: false, error: new EnvelopeError('Backup is not valid.', issues) }
  }

  // M9: refuse rather than interpret a newer data schema.
  if (parsed.data.schemaVersion > supportedSchemaVersion) {
    return {
      ok: false,
      error: new EnvelopeError(
        `Backup uses data schema ${parsed.data.schemaVersion}, but this build understands ${supportedSchemaVersion}. Update the app.`,
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
