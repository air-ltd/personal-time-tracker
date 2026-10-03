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

  const entities: Record<string, Mergeable[]> = parsed.data.data
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
  }

  // J5: counts let the importer confirm nothing was truncated in transit.
  const counts: Record<string, number> = {}
  for (const [name, table] of Object.entries(data)) {
    counts[name] = table.length
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
