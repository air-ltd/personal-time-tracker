import { getDb } from './db'
import { bumpRevision } from './events'
import { newId } from '../domain/time/ids'
import { PALETTE, suggestColour } from '../domain/taxonomy/colour'
import { findNameConflict, type ExistingName, type NameKind } from '../domain/taxonomy/names'
import type { Client, Project, Tag } from '../domain/taxonomy/types'

/**
 * Taxonomy storage (0005 P1–P2, A1–A5, T2–T4, X1–X6).
 *
 * Deletion never removes entries. A deleted project's entries are orphaned rather than
 * removed, and a deleted client's projects survive with `clientId` cleared, so the only
 * thing destroyed is the taxonomy label (0005 X1, X4).
 *
 * Deletion is a tombstone rather than a row removal, for two reasons: the entry data
 * that referenced it must be able to resolve, and the deletion has to propagate to other
 * devices — a hard delete cannot be merged, so a project would reappear on the next pull
 * (0012 M6).
 */

function db() {
  return getDb()
}

function iso(value: Date): string {
  return value.toISOString()
}

/** Trimmed, and never blank: a blank name would be unselectable in a picker. */
function requireName(kind: NameKind, name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new Error(`A ${kind} needs a name.`)
  return trimmed
}

async function assertNameFree(
  kind: NameKind,
  name: string,
  options: { ignoreArchived: boolean; exceptId?: string },
): Promise<void> {
  /*
   * Branching per kind rather than indexing a union of tables: a tag has no `archived`
   * field at all (0005 T5), and a union row would type it as `unknown`.
   *
   * Tombstones are excluded, which they were not. `toArray()` returns them, and a
   * tombstone is not a record the user can see or select — it is the merge marker for a
   * deletion that already happened. Counting one made a deleted project's name
   * permanently unusable: 0005 F4 says deleting is for projects created by mistake, and
   * the mistake that most needs fixing is precisely the one where you cannot create the
   * project you meant straight afterwards. Every table keeps the same filter so the three
   * agree about what exists.
   */
  const existing: ExistingName[] =
    kind === 'tag'
      ? (await db().tags.toArray())
          .filter((row) => row.deletedAt === null)
          .map((row) => ({ id: row.id, name: row.name, archived: false }))
      : kind === 'client'
        ? (await db().clients.toArray())
            .filter((row) => row.deletedAt === null)
            .map((row) => ({ id: row.id, name: row.name, archived: row.archived }))
        : (await db().projects.toArray())
            .filter((row) => row.deletedAt === null)
            .map((row) => ({ id: row.id, name: row.name, archived: row.archived }))
  const conflict = findNameConflict(kind, name, existing, {
    ignoreArchived: options.ignoreArchived,
  })
  // Renaming a record to its own current name is not a conflict with itself.
  if (conflict?.kind === 'duplicate' && conflict.existingId !== options.exceptId) {
    throw new Error(`"${name.trim()}" already exists.`)
  }
  if (conflict && conflict.kind !== 'duplicate') {
    throw new Error(
      conflict.kind === 'empty'
        ? `A ${kind} needs a name.`
        : `"${name.trim()}" is longer than ${conflict.limit} characters.`,
    )
  }
}

/** Colours already assigned, so a new project is not given one already in use. */
async function usedColours(): Promise<string[]> {
  const [projects, clients] = await Promise.all([
    db().projects.toArray(),
    db().clients.toArray(),
  ])
  return [...projects, ...clients]
    .filter((row) => row.deletedAt === null)
    .map((row) => row.colour)
}

export interface CreateProjectInput {
  name: string
  clientId?: string | null
  colour?: string
  defaultRateMinor?: number | null
  currency?: string | null
  now: Date
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const name = requireName('project', input.name)
  await assertNameFree('project', name, { ignoreArchived: true })

  const project: Project = {
    id: newId(),
    name,
    clientId: input.clientId ?? null,
    colour: input.colour ?? suggestColour(await usedColours()),
    defaultRateMinor: input.defaultRateMinor ?? null,
    currency: input.currency ?? null,
    archived: false,
    createdAt: iso(input.now),
    updatedAt: iso(input.now),
    deletedAt: null,
  }
  await db().projects.put(project)
  bumpRevision()
  return project
}

export interface CreateClientInput {
  name: string
  colour?: string
  defaultRateMinor?: number | null
  currency: string
  now: Date
}

export async function createClient(input: CreateClientInput): Promise<Client> {
  const name = requireName('client', input.name)
  // A client name is unique regardless of archived state (0003 Client).
  await assertNameFree('client', name, { ignoreArchived: false })

  const client: Client = {
    id: newId(),
    name,
    colour: input.colour ?? suggestColour(await usedColours()),
    defaultRateMinor: input.defaultRateMinor ?? null,
    currency: input.currency,
    archived: false,
    createdAt: iso(input.now),
    updatedAt: iso(input.now),
    deletedAt: null,
  }
  await db().clients.put(client)
  bumpRevision()
  return client
}

export interface CreateTagInput {
  name: string
  colour?: string
  now: Date
}

/**
 * Create a tag, or return the existing one with the same name.
 *
 * Returning the existing tag is the point of 0005 T2: tags are typed inline while
 * recording, so `Research` and `research` must converge on one tag rather than silently
 * creating a near-duplicate the user then has to merge.
 */
export async function createOrFindTag(
  input: CreateTagInput,
): Promise<{ tag: Tag; created: boolean }> {
  const name = requireName('tag', input.name)
  const existing = (await db().tags.toArray()).find(
    (tag) => tag.deletedAt === null && tag.name.trim().toLowerCase() === name.toLowerCase(),
  )
  if (existing) return { tag: existing, created: false }

  const tag: Tag = {
    id: newId(),
    name,
    colour: input.colour ?? suggestColour(await usedColours()),
    createdAt: iso(input.now),
    updatedAt: iso(input.now),
    deletedAt: null,
  }
  await db().tags.put(tag)
  bumpRevision()
  return { tag, created: true }
}

export async function listProjects(
  options: { includeArchived?: boolean } = {},
): Promise<Project[]> {
  const rows = await db().projects.toArray()
  return rows
    .filter((row) => row.deletedAt === null)
    .filter((row) => options.includeArchived === true || !row.archived)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listClients(
  options: { includeArchived?: boolean } = {},
): Promise<Client[]> {
  const rows = await db().clients.toArray()
  return rows
    .filter((row) => row.deletedAt === null)
    .filter((row) => options.includeArchived === true || !row.archived)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listTags(): Promise<Tag[]> {
  const rows = await db().tags.toArray()
  return rows
    .filter((row) => row.deletedAt === null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Archive or restore a project or client.
 *
 * Archiving hides a record from pickers but keeps every entry pointing at it, so
 * historical entries keep their colour and stay editable (0005 A1, A2). It deliberately
 * does not cascade: a client can be archived while its projects continue (0005 A4).
 */
export async function setArchived(
  kind: 'project' | 'client',
  id: string,
  archived: boolean,
  now: Date,
): Promise<void> {
  // Branches rather than a union of tables: a project and a client differ in more than
  // one field, so merging their types would lose that and silently allow a client's
  // `currency` on a project.
  if (kind === 'project') {
    const project = await db().projects.get(id)
    if (!project || project.deletedAt !== null) return
    await db().projects.put({ ...project, archived, updatedAt: iso(now) })
  } else {
    const client = await db().clients.get(id)
    if (!client || client.deletedAt !== null) return
    await db().clients.put({ ...client, archived, updatedAt: iso(now) })
  }
  bumpRevision()
}

/** What deleting a project would affect, for the confirmation (0005 X1, X3). */
export interface DeleteImpact {
  entryCount: number
  billableEntryCount: number
  billableMinutes: number
}

export async function projectDeleteImpact(projectId: string): Promise<DeleteImpact> {
  const entries = await db()
    .entries.filter((row) => row.projectId === projectId)
    .toArray()
  let billableEntryCount = 0
  let billableMs = 0
  for (const row of entries) {
    if (row.deletedAt !== null) continue
    if (!row.billable) continue
    const start = Date.parse(row.start)
    const end = row.end === null ? Date.now() : Date.parse(row.end)
    if (Number.isNaN(start) || Number.isNaN(end)) continue
    billableMs += end - start
    billableEntryCount += 1
  }
  return {
    entryCount: entries.filter((row) => row.deletedAt === null).length,
    billableEntryCount,
    billableMinutes: Math.round(billableMs / 60_000),
  }
}

/**
 * Delete a project: tombstone it and orphan its entries.
 *
 * Entries keep existing and lose only their `projectId`, which moves them into the
 * uncategorised bucket (0005 X1, 0003 F1). The project is tombstoned rather than
 * removed so the deletion syncs; a hard delete cannot be merged and the project would
 * return on the next pull.
 */
export async function deleteProject(id: string, now: Date): Promise<void> {
  await db().transaction('rw', db().entries, db().projects, async () => {
    const project = await db().projects.get(id)
    if (!project || project.deletedAt !== null) return

    const entries = await db()
      .entries.filter((row) => row.projectId === id)
      .toArray()
    for (const row of entries) {
      // Already-deleted entries are left exactly as they are. Bumping `updatedAt` on a
      // tombstone makes it look newer than it is, so it would win a merge tie against a
      // device that had genuinely restored the entry — and a deleted entry's projectId
      // is irrelevant either way, since it appears in no report.
      if (row.deletedAt !== null) continue
      // `updatedAt` moves so the orphaning wins the merge against a device that still
      // has this entry pointing at the project.
      await db().entries.put({ ...row, projectId: null, updatedAt: iso(now) })
    }
    await db().projects.put({ ...project, deletedAt: iso(now), updatedAt: iso(now) })
  })
  bumpRevision()
}

/**
 * Delete a client: tombstone it and clear `clientId` on its projects.
 *
 * Its projects and their entries are untouched; the entries simply move to the
 * client-less bucket, which is what makes the report totals reconcile (0005 X4, R3).
 */
export async function deleteClient(id: string, now: Date): Promise<void> {
  await db().transaction('rw', db().clients, db().projects, async () => {
    const client = await db().clients.get(id)
    if (!client || client.deletedAt !== null) return

    const projects = await db()
      .projects.filter((row) => row.clientId === id)
      .toArray()
    for (const project of projects) {
      await db().projects.put({ ...project, clientId: null, updatedAt: iso(now) })
    }
    await db().clients.put({ ...client, deletedAt: iso(now), updatedAt: iso(now) })
  })
  bumpRevision()
}

/**
 * Merge tag `fromId` into `toId`, then tombstone the source.
 *
 * 0005 T4. Without it, cleaning up near-duplicate tags means editing every entry by
 * hand. Entries gain the target and lose the source; an entry already carrying the
 * target is left alone rather than gaining a duplicate reference.
 */
export async function mergeTags(fromId: string, toId: string, now: Date): Promise<void> {
  if (fromId === toId) throw new Error('A tag cannot be merged into itself.')

  await db().transaction('rw', db().entries, db().tags, async () => {
    const source = await db().tags.get(fromId)
    const target = await db().tags.get(toId)
    if (!source || !target) throw new Error('Both tags must exist to merge.')
    if (source.deletedAt !== null || target.deletedAt !== null) {
      throw new Error('Both tags must exist to merge.')
    }

    const entries = await db()
      .entries.filter((row) => row.tagIds.includes(fromId))
      .toArray()
    for (const row of entries) {
      const tagIds = row.tagIds.includes(toId)
        ? row.tagIds.filter((tagId) => tagId !== fromId)
        : [...row.tagIds.filter((tagId) => tagId !== fromId), toId]
      await db().entries.put({ ...row, tagIds, updatedAt: iso(now) })
    }
    await db().tags.put({ ...source, deletedAt: iso(now), updatedAt: iso(now) })
  })
  bumpRevision()
}

/**
 * Delete a tag, removing it from entries (0005 T3).
 *
 * Entries are not deleted, and no rate or billable state is touched — a tag is only ever
 * a label.
 */
export async function deleteTag(id: string, now: Date): Promise<void> {
  await db().transaction('rw', db().entries, db().tags, async () => {
    const tag = await db().tags.get(id)
    if (!tag || tag.deletedAt !== null) return

    const entries = await db()
      .entries.filter((row) => row.tagIds.includes(id))
      .toArray()
    for (const row of entries) {
      await db().entries.put({
        ...row,
        tagIds: row.tagIds.filter((tagId) => tagId !== id),
        updatedAt: iso(now),
      })
    }
    await db().tags.put({ ...tag, deletedAt: iso(now), updatedAt: iso(now) })
  })
  bumpRevision()
}

/** Palette, exposed so a picker renders exactly what creation would choose from. */
export { PALETTE }
