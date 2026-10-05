/**
 * Taxonomy entities (0003 Project/Client/Tag, 0005).
 *
 * Every entity here carries `updatedAt` and `deletedAt` because `merge.ts` requires
 * them: the merge is generic and knows nothing about entity types, so an entity without
 * a deletion marker could not be tombstoned and would reappear on the next pull
 * (0012 M2). The specs define `archived` and `createdAt`; `deletedAt` is the
 * merge-compatible tombstone and is what makes 0005 X1–X5 undoable.
 *
 * Deletion and archiving are deliberately separate states. Archiving hides a project
 * from pickers while its historical entries keep their project and colour (0005 A1);
 * deleting orphans those entries instead (0005 X1). One flag could not express both.
 */

export interface Project {
  id: string
  /** Trimmed, 1–80 characters, unique among non-archived projects (0005 P2). */
  name: string
  /** Null means non-client work, which is legitimate rather than unclassified (0005 R1, U1). */
  clientId: string | null
  /** `#rrggbb`, lowercase. From the accessible palette by default (0005 P3). */
  colour: string
  /** Hourly rate in minor units. Null means not billable by default (0005 P5). */
  defaultRateMinor: number | null
  /** ISO 4217. Null inherits from the client, then the app default (0005 P6). */
  currency: string | null
  archived: boolean
  createdAt: string
  updatedAt: string
  /** Tombstone for sync. Set by delete, distinct from `archived` (0012 M6). */
  deletedAt: string | null
}

export interface Client {
  id: string
  /** Trimmed, 1–80 characters, unique (0003 Client). */
  name: string
  colour: string
  /** Fallback rate for projects belonging to this client (0003 rate resolution). */
  defaultRateMinor: number | null
  /** ISO 4217. This client's billing currency (0005 P7). */
  currency: string
  archived: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface Tag {
  id: string
  /** Trimmed, 1–40 characters, unique case-insensitively (0005 T2). */
  name: string
  colour: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/**
 * Anything the merge can carry.
 *
 * Declared rather than imported from `merge.ts` so this module stays free of
 * dependencies on sync, matching the layering the architecture requires (0002 A1).
 */
/** Name and id fields a picker needs, without loading the whole record. */
export interface TaxonomyOption {
  id: string
  name: string
  colour: string
  archived: boolean
}
