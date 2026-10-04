import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDb, setDbForTests } from './db'
import { resetRevisionForTests } from './events'
import { listEntries, startTimer, stopTimer } from './entriesRepo'
import {
  createClient,
  createOrFindTag,
  createProject,
  deleteClient,
  deleteProject,
  deleteTag,
  listProjects,
  listTags,
  mergeTags,
  projectDeleteImpact,
  setArchived,
} from './taxonomyRepo'
import { T0, entry } from '../test/factories'
import { PALETTE } from '../domain/taxonomy/colour'
import {
  FALLBACK_CURRENCY,
  groupByCurrency,
  minorUnitExponent,
  projectDefaultsToBillable,
  resolveCurrency,
  resolveRateMinor,
} from '../domain/taxonomy/money'
import { findByName, findNameConflict, nameKey, validateName } from '../domain/taxonomy/names'
import type { Client, Project } from '../domain/taxonomy/types'

/**
 * Taxonomy rules (0005).
 *
 * Weighted towards the destructive operations, because that is where the spec is
 * strictest and where a bug loses a user's history: archiving must not delete, deleting
 * must not remove entries, and both must survive a merge with another device.
 */

let db: AppDb
let counter = 0

beforeEach(async () => {
  db = new AppDb(`taxonomy-${(counter += 1)}`)
  setDbForTests(db)
  // Await the open so the schema upgrade has committed; see useTimer.test.tsx.
  await db.open()
  resetRevisionForTests()
})

const later = new Date('2026-10-14T09:00:00.000Z')

describe('names', () => {
  it('compares trimmed and case-insensitively', () => {
    expect(nameKey('  Acme  ')).toBe('acme')
    expect(nameKey('ACME')).toBe(nameKey('acme'))
  })

  it('treats a decomposed accented name as equal to its composed form', () => {
    // A name round-tripped through a backup can come back decomposed. Comparing raw
    // strings would let "café" be created twice, looking identical in a report.
    expect(nameKey('café')).toBe(nameKey('café'))
  })

  it('enforces the length limits from the spec', () => {
    expect(validateName('project', '')).toEqual({ kind: 'empty' })
    expect(validateName('project', '   ')).toEqual({ kind: 'empty' })
    expect(validateName('project', 'x'.repeat(80))).toBeNull()
    expect(validateName('project', 'x'.repeat(81))).toMatchObject({
      kind: 'too-long',
      limit: 80,
    })
    // Tags are shorter than projects.
    expect(validateName('tag', 'x'.repeat(41))).toMatchObject({ limit: 40 })
  })

  it('reports a duplicate against a non-archived record', () => {
    const existing = [{ id: 'p1', name: 'Acme', archived: false }]
    expect(
      findNameConflict('project', 'acme', existing, { ignoreArchived: true }),
    ).toMatchObject({
      kind: 'duplicate',
      existingId: 'p1',
    })
  })

  it('allows reusing a name freed by archiving a project', () => {
    // 0005 P2 scopes uniqueness to non-archived projects, so archiving frees the name.
    const existing = [{ id: 'p1', name: 'Acme', archived: true }]
    expect(findNameConflict('project', 'Acme', existing, { ignoreArchived: true })).toBeNull()
    // But a client name is unique regardless of archive state.
    expect(
      findNameConflict('client', 'Acme', existing, { ignoreArchived: false }),
    ).toMatchObject({
      kind: 'duplicate',
    })
  })

  it('finds a record by name regardless of case', () => {
    const existing = [{ id: 't1', name: 'research', archived: false }]
    expect(findByName('Research', existing)?.id).toBe('t1')
  })
})

describe('creating', () => {
  it('creates a project with defaults', async () => {
    const project = await createProject({ name: 'Acme', now: T0 })

    expect(project).toMatchObject({
      name: 'Acme',
      clientId: null,
      archived: false,
      deletedAt: null,
      defaultRateMinor: null,
      currency: null,
    })
    expect(PALETTE).toContain(project.colour)
  })

  it('trims the name', async () => {
    expect((await createProject({ name: '  Acme  ', now: T0 })).name).toBe('Acme')
  })

  it('rejects a duplicate name differing only by case', async () => {
    await createProject({ name: 'Acme', now: T0 })
    await expect(createProject({ name: 'acme', now: T0 })).rejects.toThrow(/already exists/)
  })

  it('rejects a blank name', async () => {
    await expect(createProject({ name: '   ', now: T0 })).rejects.toThrow(/needs a name/)
  })

  it('gives each new project a different colour', async () => {
    const first = await createProject({ name: 'One', now: T0 })
    const second = await createProject({ name: 'Two', now: T0 })
    // Two charts using the same colour would be unreadable, and the palette is finite
    // but large enough that this should not come up quickly.
    expect(second.colour).not.toBe(first.colour)
  })

  it('lets a project and a client share a name, being distinct types (0005 N1)', async () => {
    await createProject({ name: 'Acme', now: T0 })
    const client = await createClient({ name: 'Acme', currency: 'GBP', now: T0 })
    expect(client.name).toBe('Acme')
  })

  it('gives clients and projects colours from the same palette', async () => {
    // A by-client chart and a by-project chart of the same data must not look identical.
    const project = await createProject({ name: 'P', now: T0 })
    const client = await createClient({ name: 'C', currency: 'GBP', now: T0 })
    expect(PALETTE).toContain(project.colour)
    expect(PALETTE).toContain(client.colour)
  })
})

describe('inline tags (0005 T1, T2)', () => {
  it('creates a tag that does not exist', async () => {
    const { tag, created } = await createOrFindTag({ name: 'research', now: T0 })
    expect(created).toBe(true)
    expect(tag.name).toBe('research')
  })

  it('returns the existing tag rather than a near-duplicate', async () => {
    const first = await createOrFindTag({ name: 'research', now: T0 })
    const second = await createOrFindTag({ name: 'Research', now: T0 })

    expect(second.created).toBe(false)
    expect(second.tag.id).toBe(first.tag.id)
    expect(await listTags()).toHaveLength(1)
  })

  it('ignores surrounding space when matching', async () => {
    await createOrFindTag({ name: 'research', now: T0 })
    expect((await createOrFindTag({ name: '  research  ', now: T0 })).created).toBe(false)
  })

  it('does not resurrect a deleted tag', async () => {
    const { tag } = await createOrFindTag({ name: 'research', now: T0 })
    await deleteTag(tag.id, later)
    // Recreating after deletion is a new tag with the same name, which is what the user
    // asked for; matching the tombstone would silently restore the old references.
    expect((await createOrFindTag({ name: 'research', now: later })).created).toBe(true)
  })
})

describe('archiving (0005 A1–A5)', () => {
  it('hides an archived project from the default list', async () => {
    const project = await createProject({ name: 'Acme', now: T0 })
    await setArchived('project', project.id, true, later)

    expect(await listProjects()).toHaveLength(0)
    // Still reachable, or historical entries would become uneditable (0005 A2).
    expect(await listProjects({ includeArchived: true })).toHaveLength(1)
  })

  it('keeps entries pointing at an archived project, with its colour', async () => {
    const project = await createProject({ name: 'Acme', now: T0 })
    await db.entries.put({ ...entry({ id: 'e1', projectId: project.id }), deletedAt: null })
    await setArchived('project', project.id, true, later)

    const [stored] = await db.entries.toArray()
    // The entry still resolves, so a historical report keeps the project's colour.
    expect(stored?.projectId).toBe(project.id)
    const [reloaded] = await listProjects({ includeArchived: true })
    expect(reloaded?.colour).toBe(project.colour)
  })

  it('does not cascade from a client to its projects (0005 A4)', async () => {
    const client = await createClient({ name: 'Acme', currency: 'GBP', now: T0 })
    const project = await createProject({ name: 'Site', clientId: client.id, now: T0 })
    await setArchived('client', client.id, true, later)

    // The project stays active and keeps its client reference.
    const projects = await listProjects()
    expect(projects.map((p) => p.id)).toEqual([project.id])
    expect(projects[0]?.clientId).toBe(client.id)
  })

  it('restores an archived project', async () => {
    const project = await createProject({ name: 'Acme', now: T0 })
    await setArchived('project', project.id, true, later)
    await setArchived('project', project.id, false, later)

    expect(await listProjects()).toHaveLength(1)
  })

  it('ignores archiving a deleted record', async () => {
    const project = await createProject({ name: 'Acme', now: T0 })
    await deleteProject(project.id, later)
    await setArchived('project', project.id, false, later)

    // Not resurrected by an archive toggle.
    expect(await listProjects({ includeArchived: true })).toHaveLength(0)
  })
})

describe('deleting a project (0005 X1–X3)', () => {
  async function withEntries() {
    const project = await createProject({ name: 'Acme', now: T0 })
    await db.entries.bulkPut([
      entry({ id: 'e1', projectId: project.id }),
      entry({ id: 'e2', projectId: project.id, billable: true }),
      entry({ id: 'e3', projectId: null }),
    ])
    return project
  }

  it('keeps the entries and orphans them rather than deleting', async () => {
    const project = await withEntries()
    await deleteProject(project.id, later)

    const entries = await listEntries()
    // Nothing is removed; only the project reference is lost (0003 F1).
    expect(entries.map((e) => e.id).sort()).toEqual(['e1', 'e2', 'e3'])
    expect(entries.find((e) => e.id === 'e1')?.projectId).toBeNull()
    expect(entries.find((e) => e.id === 'e3')?.projectId).toBeNull()
  })

  it('reports what would be affected before the user confirms', async () => {
    const project = await withEntries()
    const impact = await projectDeleteImpact(project.id)

    // The count and the billable hours are what 0005 X1 requires be shown.
    expect(impact.entryCount).toBe(2)
    expect(impact.billableEntryCount).toBe(1)
    expect(impact.billableMinutes).toBe(60)
  })

  it('tombstones rather than removing, so the deletion syncs', async () => {
    const project = await withEntries()
    await deleteProject(project.id, later)

    // A hard delete cannot be merged, so the project would return on the next pull.
    const stored = await db.projects.get(project.id)
    expect(stored?.deletedAt).toBe(later.toISOString())
    expect(await listProjects({ includeArchived: true })).toHaveLength(0)
  })

  it('bumps updatedAt on orphaned entries so the change wins a merge', async () => {
    const project = await withEntries()
    await deleteProject(project.id, later)

    const [orphaned] = (await db.entries.toArray()).filter((e) => e.id === 'e1')
    // A device that still has this entry pointing at the project must lose.
    expect(orphaned?.updatedAt).toBe(later.toISOString())
  })

  it('is a no-op the second time', async () => {
    const project = await withEntries()
    await deleteProject(project.id, later)
    await expect(deleteProject(project.id, later)).resolves.toBeUndefined()
  })
})

describe('deleting a client (0005 X4)', () => {
  it('keeps its projects and clears their client reference', async () => {
    const client = await createClient({ name: 'Acme', currency: 'GBP', now: T0 })
    const project = await createProject({ name: 'Site', clientId: client.id, now: T0 })
    await db.entries.put(entry({ id: 'e1', projectId: project.id }))

    await deleteClient(client.id, later)

    // Projects and entries survive; the entries move to the client-less bucket so report
    // totals still reconcile (0005 R3).
    const projects = await listProjects({ includeArchived: true })
    expect(projects).toHaveLength(1)
    expect(projects[0]?.clientId).toBeNull()
    expect(await listEntries()).toHaveLength(1)
  })

  it('tombstones the client', async () => {
    const client = await createClient({ name: 'Acme', currency: 'GBP', now: T0 })
    await deleteClient(client.id, later)
    expect((await db.clients.get(client.id))?.deletedAt).toBe(later.toISOString())
  })
})

describe('tags on entries (0005 T3, T4)', () => {
  async function withTaggedEntry(tagIds: string[]) {
    await db.entries.put(entry({ id: 'e1', tagIds }))
  }

  it('removes a deleted tag from entries without deleting them', async () => {
    const { tag } = await createOrFindTag({ name: 'research', now: T0 })
    await withTaggedEntry([tag.id])

    await deleteTag(tag.id, later)

    const [stored] = await db.entries.toArray()
    expect(stored?.tagIds).toEqual([])
    expect(await listEntries()).toHaveLength(1)
  })

  it('merges one tag into another', async () => {
    const source = await createOrFindTag({ name: 'research', now: T0 })
    const target = await createOrFindTag({ name: 'review', now: T0 })
    await withTaggedEntry([source.tag.id])

    await mergeTags(source.tag.id, target.tag.id, later)

    const [stored] = await db.entries.toArray()
    expect(stored?.tagIds).toEqual([target.tag.id])
    // The source is tombstoned, not hard-deleted, so the merge syncs.
    expect((await db.tags.get(source.tag.id))?.deletedAt).toBe(later.toISOString())
    expect(await listTags()).toHaveLength(1)
  })

  it('does not duplicate the tag on an entry that already has both', async () => {
    const source = await createOrFindTag({ name: 'research', now: T0 })
    const target = await createOrFindTag({ name: 'review', now: T0 })
    await withTaggedEntry([source.tag.id, target.tag.id])

    await mergeTags(source.tag.id, target.tag.id, later)

    expect((await db.entries.toArray())[0]?.tagIds).toEqual([target.tag.id])
  })

  it('refuses to merge a tag into itself', async () => {
    const tag = await createOrFindTag({ name: 'research', now: T0 })
    await expect(mergeTags(tag.tag.id, tag.tag.id, later)).rejects.toThrow(/into itself/)
  })

  it('refuses to merge into a missing tag', async () => {
    const source = await createOrFindTag({ name: 'research', now: T0 })
    await expect(mergeTags(source.tag.id, 'nope', later)).rejects.toThrow(/must exist/)
  })

  it('leaves billable state and rates alone', async () => {
    const { tag } = await createOrFindTag({ name: 'research', now: T0 })
    await db.entries.put(
      entry({ id: 'e1', tagIds: [tag.id], billable: true, rateOverrideMinor: 5000 }),
    )

    await deleteTag(tag.id, later)

    const [stored] = await db.entries.toArray()
    // A tag is only ever a label; deleting it must not touch money (0005 T3).
    expect(stored?.billable).toBe(true)
    expect(stored?.rateOverrideMinor).toBe(5000)
  })
})

describe('rate and currency resolution (0003, 0005 P5–P8)', () => {
  const client: Client = {
    id: 'c1',
    name: 'Acme',
    colour: '#000000',
    defaultRateMinor: 5_000,
    currency: 'GBP',
    archived: false,
    createdAt: T0.toISOString(),
    updatedAt: T0.toISOString(),
    deletedAt: null,
  }
  const project: Project = {
    id: 'p1',
    name: 'Site',
    clientId: 'c1',
    colour: '#000000',
    defaultRateMinor: 9_000,
    currency: null,
    archived: false,
    createdAt: T0.toISOString(),
    updatedAt: T0.toISOString(),
    deletedAt: null,
  }

  it('prefers the entry override, then the project, then the client', () => {
    expect(resolveRateMinor({ rateOverrideMinor: 1, project, client })).toBe(1)
    expect(resolveRateMinor({ rateOverrideMinor: null, project, client })).toBe(9_000)
    expect(
      resolveRateMinor({
        rateOverrideMinor: null,
        project: { ...project, defaultRateMinor: null },
        client,
      }),
    ).toBe(5_000)
  })

  it('reports no rate when nothing applies, rather than zero', () => {
    // Zero would mean "billable at no rate"; null means "no monetary value", which are
    // different things.
    expect(
      resolveRateMinor({ rateOverrideMinor: null, project: null, client: null }),
    ).toBeNull()
  })

  it('treats a project with a rate as defaulting to billable', () => {
    expect(projectDefaultsToBillable(project)).toBe(true)
    expect(projectDefaultsToBillable({ ...project, defaultRateMinor: null })).toBe(false)
    expect(projectDefaultsToBillable(null)).toBe(false)
  })

  it('prefers the project currency over the client, and says which won', () => {
    expect(resolveCurrency({ ...project, currency: 'EUR' }, client, 'USD')).toEqual({
      code: 'EUR',
      source: 'project',
    })
    expect(resolveCurrency(project, client, 'USD')).toEqual({ code: 'GBP', source: 'client' })
    expect(resolveCurrency(project, null, 'USD')).toEqual({
      code: 'USD',
      source: 'app-default',
    })
    expect(resolveCurrency(null, null, null)).toEqual({
      code: FALLBACK_CURRENCY,
      source: 'fallback',
    })
  })

  it('never totals across currencies', () => {
    // 0003 CU2: GBP plus JPY is not a number.
    const totals = groupByCurrency([
      { currency: 'GBP', minor: 1_000 },
      { currency: 'GBP', minor: 500 },
      { currency: 'JPY', minor: 900 },
    ])

    expect(Object.fromEntries(totals)).toEqual({ GBP: 1_500, JPY: 900 })
    expect(totals.size).toBe(2)
  })

  it('knows that not every currency has two decimals', () => {
    // 0003 CU1: assuming two decimals misreports JPY by a factor of a hundred.
    expect(minorUnitExponent('GBP')).toBe(2)
    expect(minorUnitExponent('JPY')).toBe(0)
    expect(minorUnitExponent('KWD')).toBe(3)
  })
})

describe('timer interaction', () => {
  it('keeps a running entry while its project is archived', async () => {
    const project = await createProject({ name: 'Acme', now: T0 })
    await startTimer(new Date('2026-10-13T09:00:00.000Z'))

    await setArchived('project', project.id, true, later)

    // The timer is independent of taxonomy; archiving must not disturb a running entry.
    const running = await db.entries.filter((e) => e.end === null).first()
    expect(running).toBeDefined()
    await stopTimer(running?.id as string, later)
  })
})

/**
 * Deleting a project must not disturb entries that are already deleted.
 *
 * Bumping `updatedAt` on a tombstone makes it look newer than it is, so it would win a
 * merge tie against a device that had genuinely restored the entry — a deletion
 * resurrecting as a deletion. A tombstone's projectId is also irrelevant, since it
 * appears in no report.
 */
describe('deleting a project leaves existing tombstones untouched', () => {
  it('does not advance updatedAt on an already-deleted entry', async () => {
    const project = await createProject({ name: 'Acme', now: T0 })
    const deletedAt = '2026-10-13T11:00:00.000Z'
    await db.entries.put({
      ...entry({ id: 'gone', projectId: project.id }),
      deletedAt,
      updatedAt: deletedAt,
    })

    await deleteProject(project.id, later)

    const stored = await db.entries.get('gone')
    expect(stored?.deletedAt).toBe(deletedAt)
    expect(stored?.updatedAt).toBe(deletedAt)
    // Left pointing at the deleted project, which is harmless and keeps the tombstone
    // byte-identical to what another device already holds.
    expect(stored?.projectId).toBe(project.id)
  })

  it('still orphans the entries that are not deleted', async () => {
    const project = await createProject({ name: 'Acme', now: T0 })
    await db.entries.put({ ...entry({ id: 'live', projectId: project.id }) })
    await db.entries.put({
      ...entry({ id: 'gone', projectId: project.id }),
      deletedAt: '2026-10-13T11:00:00.000Z',
    })

    await deleteProject(project.id, later)

    expect((await db.entries.get('live'))?.projectId).toBeNull()
    expect((await db.entries.get('gone'))?.projectId).toBe(project.id)
  })

  it('does not count tombstones in the impact shown before confirming', async () => {
    const project = await createProject({ name: 'Acme', now: T0 })
    await db.entries.put({ ...entry({ id: 'live', projectId: project.id }) })
    await db.entries.put({
      ...entry({ id: 'gone', projectId: project.id }),
      deletedAt: '2026-10-13T11:00:00.000Z',
    })

    // A count that included deleted entries would overstate what the user is about to
    // change, since nothing happens to them.
    expect((await projectDeleteImpact(project.id)).entryCount).toBe(1)
  })
})

/**
 * Names freed by deletion.
 *
 * 0005 F4 says deleting exists for projects created by mistake, so the mistake most
 * worth fixing is the one where the intended project cannot be created afterwards.
 */
describe('names freed by deletion', () => {
  it('reuses a deleted project name', async () => {
    const project = await createProject({ name: 'Acme', now: T0 })
    await deleteProject(project.id, T0)
    const replacement = await createProject({ name: 'acme', now: T0 })
    expect(replacement.name).toBe('acme')
  })

  it('reuses a deleted client name', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await deleteClient(client.id, T0)
    await expect(
      createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 }),
    ).resolves.toMatchObject({ name: 'Acme Ltd' })
  })

  it('creates a new tag rather than resurrecting a deleted one', async () => {
    // A tag has no archive state (0005 T5), so deletion is the only way a name goes
    // away and reuse has to produce a genuinely new record.
    const { tag: first } = await createOrFindTag({ name: 'research', now: T0 })
    await deleteTag(first.id, T0)
    const { tag: second, created } = await createOrFindTag({ name: 'research', now: T0 })
    expect(created).toBe(true)
    expect(second.id).not.toBe(first.id)
  })

  it('frees the name when a project is archived rather than deleted', async () => {
    // Archiving is the intended way to retire a project (0005 F4, A1), and a name freed
    // by archiving has to be reusable or archiving becomes a one-way door.
    const first = await createProject({ name: 'Acme', now: T0 })
    await setArchived('project', first.id, true, T0)
    await expect(createProject({ name: 'Acme', now: T0 })).resolves.toMatchObject({
      name: 'Acme',
    })
  })

  it('still refuses a name held by a live project', async () => {
    await createProject({ name: 'Acme', now: T0 })
    await expect(createProject({ name: 'ACME', now: T0 })).rejects.toThrow(/already exists/)
  })
})
