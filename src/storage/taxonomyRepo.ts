import { getDb } from './db'
import { bumpRevision } from './events'
import { newId } from '../domain/time/ids'
import { PALETTE, normaliseColour, suggestColour } from '../domain/taxonomy/colour'
import {
  findByName,
  findNameConflict,
  type ExistingName,
  type NameKind,
} from '../domain/taxonomy/names'
import type { Client, Project, Tag } from '../domain/taxonomy/types'

/**
 * Taxonomy storage (0005 P1–P2, A1–A5, T2–T4, X1–X7).
 *
 * Projects and clients are not deletable at all (0005 X1): archiving sets a flag, and
 * `deletedAt` stays on both types for schema stability with no code path writing it. The
 * only tombstone this module writes is for a tag, and that tombstone is a row removal
 * avoidance for two reasons — the entries that carried the tag must still resolve, and the
 * deletion has to propagate to other devices, since a hard delete cannot be merged and the
 * tag would reappear on the next pull (0012 M6).
 *
 * Consequence worth knowing before adding a repository function: with no tombstones for
 * these two types, merge-by-id has nothing to honour for them, so archiving rides the
 * ordinary last-write-wins path on `updatedAt`.
 */

function db() {
  return getDb()
}

function iso(value: Date): string {
  return value.toISOString()
}

/** Trimmed, and never blank: a blank name would be unselectable in a picker. */
/**
 * Validate a colour arriving from outside.
 *
 * A restored backup is untrusted input, and `ColorPicker` reports every keystroke of its
 * custom field — so `input.colour` can be half-typed, or anything a hand-edited file
 * contains. Stored unvalidated it reaches four inline-style sinks and renders as no swatch
 * at all, with no error anywhere. React drops an invalid `style.background` rather than
 * executing it, so this was never an injection risk; it is a data-integrity one, and the
 * contract already says `#rrggbb`.
 *
 * `null` for anything unparseable, which the callers treat exactly as "no colour given" and
 * replace with a suggested one — so a bad value degrades to a working colour rather than to
 * a blank. Validating here rather than at the picker is deliberate: the picker cannot
 * protect the restore path, which is where the untrusted input actually arrives.
 */
function checkedColour(value: string | undefined): string | null {
  if (value === undefined) return null
  return normaliseColour(value)
}

function requireName(kind: NameKind, name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new Error(`A ${kind} needs a name.`)
  return trimmed
}

async function assertNameFree(
  kind: NameKind,
  name: string,
  options: {
    ignoreArchived: boolean
    exceptId?: string | undefined
    /**
     * Restricts the comparison to one client's projects.
     *
     * Project names are unique *within a client*, not across all projects (0005 P2,
     * revised). Two clients both having a project called "General" is the normal case,
     * not a collision — and it is what makes a per-client timer list read the way it
     * does, with the same project name under each client.
     *
     * Ignored for clients and tags, which have no client to be scoped to.
     */
    clientId?: string | null | undefined
  },
): Promise<void> {
  /*
   * Branching per kind rather than indexing a union of tables: a tag has no `archived`
   * field at all (0005 T5), and a union row would type it as `unknown`.
   *
   * Tombstones are excluded, which they were not. `toArray()` returns them, and a
   * tombstone is not a record the user can see or select — it is the merge marker for a
   * deletion that already happened. Counting one made a deleted project's name
   * permanently unusable: 0003 F4 says deleting is for projects created by mistake, and
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
            // Scoped to the client being written to, so a sibling client's project of the
            // same name is not a conflict. `undefined` means "no scope given", which keeps
            // the historical global behaviour available rather than silently changing
            // every caller's meaning.
            .filter(
              (row) => options.clientId === undefined || row.clientId === options.clientId,
            )
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

/**
 * Amend a project.
 *
 * Every patch is applied through `assertNameFree` with the record's own id excluded,
 * because a rename that keeps the same name is not a conflict with itself. A patch that
 * leaves the name alone skips the check entirely rather than re-checking a value it is
 * not changing.
 *
 * Rejected rather than coerced on bad input: a duplicate name here would merge into two
 * indistinguishable projects on another device, which no later edit could fix.
 */
export interface ProjectPatch {
  name?: string
  clientId?: string | null
  colour?: string
  defaultRateMinor?: number | null
  currency?: string | null
}

export async function updateProject(
  id: string,
  patch: ProjectPatch,
  now: Date,
): Promise<Project> {
  const current = await db().projects.get(id)
  if (!current || current.deletedAt !== null) {
    throw new Error('That project no longer exists.')
  }
  const name = patch.name === undefined ? current.name : requireName('project', patch.name)
  if (patch.name !== undefined) {
    await assertNameFree('project', name, {
      ignoreArchived: true,
      exceptId: id,
      clientId: patch.clientId ?? current.clientId,
    })
  }
  const updated: Project = {
    ...current,
    name,
    clientId: patch.clientId === undefined ? current.clientId : patch.clientId,
    colour: patch.colour ?? current.colour,
    defaultRateMinor:
      patch.defaultRateMinor === undefined ? current.defaultRateMinor : patch.defaultRateMinor,
    currency: patch.currency === undefined ? current.currency : patch.currency,
    updatedAt: iso(now),
  }
  await db().projects.put(updated)
  bumpRevision()
  return updated
}

/** Amend a client. A client name is unique regardless of archived state (0003). */
export interface ClientPatch {
  name?: string
  colour?: string
  defaultRateMinor?: number | null
  currency?: string
}

export async function updateClient(id: string, patch: ClientPatch, now: Date): Promise<Client> {
  const current = await db().clients.get(id)
  if (!current || current.deletedAt !== null) {
    throw new Error('That client no longer exists.')
  }
  const name = patch.name === undefined ? current.name : requireName('client', patch.name)
  if (patch.name !== undefined) {
    await assertNameFree('client', name, { ignoreArchived: false, exceptId: id })
  }
  const updated: Client = {
    ...current,
    name,
    colour: patch.colour ?? current.colour,
    defaultRateMinor:
      patch.defaultRateMinor === undefined ? current.defaultRateMinor : patch.defaultRateMinor,
    currency: patch.currency ?? current.currency,
    updatedAt: iso(now),
  }
  await db().clients.put(updated)
  bumpRevision()
  return updated
}

/** Rename a tag (0005 T4 offers merge, which is a rename plus a re-point of entries). */
export async function updateTag(
  id: string,
  patch: { name?: string; colour?: string },
  now: Date,
): Promise<Tag> {
  const current = await db().tags.get(id)
  if (!current || current.deletedAt !== null) throw new Error('That tag no longer exists.')
  const name = patch.name === undefined ? current.name : requireName('tag', patch.name)
  if (patch.name !== undefined) {
    await assertNameFree('tag', name, { ignoreArchived: false, exceptId: id })
  }
  const updated: Tag = {
    ...current,
    name,
    colour: patch.colour ?? current.colour,
    updatedAt: iso(now),
  }
  await db().tags.put(updated)
  bumpRevision()
  return updated
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
  // `?? null` rather than passing `input.clientId` through: an absent client is its own
  // scope, not an absent scope. Leaving it undefined would fall back to comparing against
  // every project in the database, which is the global rule this replaced.
  await assertNameFree('project', name, {
    ignoreArchived: true,
    clientId: input.clientId ?? null,
  })

  const project: Project = {
    id: newId(),
    name,
    clientId: input.clientId ?? null,
    colour: checkedColour(input.colour) ?? suggestColour(await usedColours()),
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
    colour: checkedColour(input.colour) ?? suggestColour(await usedColours()),
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
 * The name given to the project created alongside every client (item 12 of
 * `SPECS/todo.md`).
 *
 * A client with no project cannot be recorded against, and item 12 asks that starting a
 * timer for a client records against *its* project — so the project has to exist without
 * anyone having to go and make one.
 *
 * The same name under every client, because project names are unique within a client
 * rather than across all projects (0005 P2, revised). That is what lets each client's
 * project list read the same way, and what makes a per-client timer list legible.
 */
export const DEFAULT_PROJECT_NAME = 'General'

/**
 * Create a client together with its default project.
 *
 * One transaction, because a client whose project failed to be created is a client the
 * timer cannot record against, and the user would find that out at the moment they
 * pressed Start rather than when they created the client.
 */
export async function createClientWithDefaultProject(
  input: CreateClientInput,
): Promise<{ client: Client; defaultProject: Project }> {
  // Every taxonomy store is declared, not just the two being written. `createClient` and
  // `createProject` each check name uniqueness and read the colours already in use, and a
  // Dexie transaction fails outright if it touches a store it did not declare — which
  // surfaces as "an object store did not exist" rather than anything mentioning the
  // transaction.
  return db().transaction(
    'rw',
    db().clients,
    db().projects,
    db().tags,
    db().entries,
    async () => {
      const client = await createClient(input)
      const defaultProject = await createProject({
        name: DEFAULT_PROJECT_NAME,
        clientId: client.id,
        now: input.now,
      })
      return { client, defaultProject }
    },
  )
}

/**
 * The project a client's timer records against, or null when it has none.
 *
 * The client's *oldest* project rather than one flagged as the default. A flag would be
 * the more explicit design and would need a schema migration, which is a large and
 * irreversible step to buy a distinction nothing yet needs: the project created with the
 * client is always the oldest, and if the user deletes it the next one is what they most
 * likely mean. Archived projects are skipped, because recording against something the
 * user has retired is not what "default" implies.
 */
export async function defaultProjectForClient(clientId: string): Promise<Project | null> {
  const owned = (await listProjects({ clientId, includeArchived: false }))
    .filter((project) => project.clientId === clientId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return owned[0] ?? null
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
  /*
   * Through `findByName`, which compares with `nameKey`.
   *
   * This used to inline `name.trim().toLowerCase() === name.toLowerCase()`, which is two
   * thirds of `nameKey` and missed the third: the `.normalize('NFC')`. The two forms of
   * "café" are different byte sequences, so a tag typed on a Mac and the same tag typed on
   * Linux compared unequal and both were created — two tags that render identically and
   * split a filter. `findByName`'s docstring has claimed this dependency since before the
   * call existed; now it is true.
   */
  const live = (await db().tags.toArray()).filter((tag) => tag.deletedAt === null)
  const existing = findByName(name, live)
  if (existing) return { tag: existing, created: false }

  const tag: Tag = {
    id: newId(),
    name,
    colour: checkedColour(input.colour) ?? suggestColour(await usedColours()),
    createdAt: iso(input.now),
    updatedAt: iso(input.now),
    deletedAt: null,
  }
  await db().tags.put(tag)
  bumpRevision()
  return { tag, created: true }
}

export async function listProjects(
  options: { includeArchived?: boolean; clientId?: string } = {},
): Promise<Project[]> {
  const rows = await db().projects.toArray()
  return rows
    .filter((row) => row.deletedAt === null)
    .filter((row) => options.clientId === undefined || row.clientId === options.clientId)
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

export type UndoOutcome = { ok: true } | { ok: false; reason: string }

/**
 * Whether a live record other than `exceptId` already holds this name.
 *
 * The question `assertNameFree` asks, expressed as a value so undo can decide what to do
 * rather than throwing.
 */
async function nameConflictExcluding(
  kind: NameKind,
  name: string,
  exceptId: string,
  ignoreArchived: boolean,
  clientId?: string | null,
): Promise<boolean> {
  try {
    await assertNameFree(kind, name, { ignoreArchived, exceptId, clientId })
    return false
  } catch {
    return true
  }
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
export async function deleteTag(id: string, now: Date): Promise<DeleteTagReceipt | null> {
  const receipt = await db().transaction('rw', db().entries, db().tags, async () => {
    const tag = await db().tags.get(id)
    if (!tag || tag.deletedAt !== null) return null

    const entries = await db()
      .entries.filter((row) => row.tagIds.includes(id))
      .toArray()
    const untaggedEntryIds: string[] = []
    for (const row of entries) {
      await db().entries.put({
        ...row,
        tagIds: row.tagIds.filter((tagId) => tagId !== id),
        updatedAt: iso(now),
      })
      untaggedEntryIds.push(row.id)
    }
    await db().tags.put({ ...tag, deletedAt: iso(now), updatedAt: iso(now) })
    return { tag, untaggedEntryIds }
  })
  bumpRevision()
  return receipt
}

/** What undoing a tag deletion needs (0005 X7 — entries and tag deletion only). */
export interface DeleteTagReceipt {
  tag: Tag
  untaggedEntryIds: string[]
}

export async function undoDeleteTag(
  receipt: DeleteTagReceipt,
  now: Date,
): Promise<UndoOutcome> {
  const { tag, untaggedEntryIds } = receipt
  const outcome: UndoOutcome = await db().transaction(
    'rw',
    db().entries,
    db().tags,
    async () => {
      const live = await db().tags.get(tag.id)
      if (!live || live.deletedAt === null) return { ok: false, reason: 'Already restored.' }

      const conflict = await nameConflictExcluding('tag', tag.name, tag.id, false)
      if (conflict) {
        return {
          ok: false,
          reason: `Cannot restore "${tag.name}": a tag with that name already exists. The entries are intact and untagged.`,
        }
      }

      await db().tags.put({ ...live, deletedAt: null, updatedAt: iso(now) })
      for (const entryId of untaggedEntryIds) {
        const row = await db().entries.get(entryId)
        if (!row || row.deletedAt !== null) continue
        // Restoring a tag is additive, so this is safe where a restore cannot overwrite:
        // an entry that has since been deleted is skipped, and one that gained the tag
        // another way is left with a single reference rather than a duplicate.
        if (row.tagIds.includes(tag.id)) continue
        await db().entries.put({ ...row, tagIds: [...row.tagIds, tag.id], updatedAt: iso(now) })
      }
      return { ok: true }
    },
  )

  // After the transaction, not inside it: the bump notifies subscribers, and a subscriber
  // reading while the write is still open would read pre-undo data. Only on success —
  // a refused restore wrote nothing, so there is nothing to re-read.
  if (outcome.ok) bumpRevision()
  return outcome
}

/** How many entries carry a tag, for the confirmation (0005 T3). */
export async function tagEntryCount(tagId: string): Promise<number> {
  const entries = await db()
    .entries.filter((row) => row.tagIds.includes(tagId))
    .toArray()
  return entries.filter((row) => row.deletedAt === null).length
}

/** Palette, exposed so a picker renders exactly what creation would choose from. */
export { PALETTE }
