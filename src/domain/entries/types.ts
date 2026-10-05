/**
 * Entity types (0003).
 *
 * The full 0003 shape is stored even though Phase 2A only populates part of it.
 * Entries are immutable snapshots of a schema; adding a field later would
 * otherwise mean a migration for data that was always null and always absent.
 * Partial records would also make `Field ?? default` a habit that hides genuine
 * gaps.
 */
export type EntrySource = 'timer' | 'manual'

export interface TimeEntry {
  id: string
  /** Null in Phase 2A: project taxonomy arrives in Phase 4 (0003 E1). */
  projectId: string | null
  tagIds: string[]
  /** ISO 8601 UTC instant. Wall-clock spans, never local-time strings (0003 P1). */
  start: string
  /** Null only while running. At most one entry may have this (0003 E4). */
  end: string | null
  note: string
  billable: boolean
  /** Integer minor units, or null to inherit (0003 P3). */
  rateOverrideMinor: number | null
  source: EntrySource
  createdAt: string
  updatedAt: string
  /** Soft delete. Rows are retained so a delete is undoable (0003 D1). */
  deletedAt: string | null
}
