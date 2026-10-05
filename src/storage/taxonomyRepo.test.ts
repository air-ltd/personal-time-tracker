import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { normaliseColour } from '../domain/taxonomy/colour'
import { AppDb, setDbForTests } from './db'
import { getRevision, resetRevisionForTests, subscribe } from './events'
import {
  getEntry,
  listEntries,
  putEntry,
  softDeleteEntry,
  startTimer,
  stopTimer,
  updateEntry,
} from './entriesRepo'
import {
  clientDeleteImpact,
  createClient,
  createOrFindTag,
  createProject,
  deleteClient,
  deleteProject,
  deleteTag,
  listClients,
  listProjects,
  listTags,
  mergeTags,
  projectDeleteImpact,
  setArchived,
  tagEntryCount,
  undoDeleteClient,
  undoDeleteProject,
  undoDeleteTag,
  updateClient,
  updateProject,
  updateTag,
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

/**
 * Fresh database, awaited open.
 *
 * Awaiting `open()` matters: Dexie applies the schema upgrade asynchronously, so a test
 * that reached for a table before it committed could find it missing. Shared by every
 * describe in this file — see useTimer.test.tsx.
 */
function installDb(): void {
  db = new AppDb(`taxonomy-${(counter += 1)}`)
  setDbForTests(db)
  void db.open().then(() => resetRevisionForTests())
}

beforeEach(async () => {
  installDb()
  await db.open()
})

const later = new Date('2026-10-14T09:00:00.000Z')

describe('names', () => {
  it('compares trimmed and case-insensitively', () => {
    expect(nameKey('  Acme  ')).toBe('acme')
    expect(nameKey('ACME')).toBe(nameKey('acme'))
  })

  it('treats a decomposed accented name as equal to its composed form', () => {
    /*
     * The two forms are built from code points rather than typed as literals, and that is
     * the whole point of the test.
     *
     * This assertion used to read `expect(nameKey('café')).toBe(nameKey('café'))` — with
     * both literals byte-identical (`636166c3a9`). It compared a string with itself and
     * passed whether or not `nameKey` normalised anything, so the assertion guarding the
     * codebase's most carefully argued Unicode decision proved nothing about it. It reads
     * as though it tests normalisation because the letters look different on screen; they
     * are not different in the source.
     *
     * A decomposed literal is also awkward to write on purpose: every editor, shell and
     * normalisation pass will quietly recompose it, which is how the original slipped in
     * and would slip in again. `String.fromCharCode` is unambiguous.
     */
    const composed = `caf${String.fromCharCode(0x00e9)}` // é as one code point
    const decomposed = `cafe${String.fromCharCode(0x0301)}` // e + combining acute

    // Guard the guard: if these ever compare equal, the assertion below is vacuous again.
    expect(composed).not.toBe(decomposed)
    expect(nameKey(decomposed)).toBe(nameKey(composed))
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

  describe('names are unique within a client (0005 P2, revised)', () => {
    it('lets two clients each have a project called General', async () => {
      // The rule used to be global, which meant every client could not have the same
      // obvious project name and a per-client project list could not read consistently.
      const acme = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
      const other = await createClient({ name: 'Other Ltd', currency: 'GBP', now: T0 })

      const first = await createProject({ name: 'General', clientId: acme.id, now: T0 })
      const second = await createProject({ name: 'General', clientId: other.id, now: T0 })

      expect(first.name).toBe('General')
      expect(second.name).toBe('General')
    })

    it('still rejects a duplicate within one client, whatever the case', async () => {
      const acme = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
      await createProject({ name: 'General', clientId: acme.id, now: T0 })

      await expect(
        createProject({ name: 'general', clientId: acme.id, now: T0 }),
      ).rejects.toThrow(/already exists/)
    })

    it('treats client-less projects as one scope of their own', async () => {
      // Two internal projects cannot share a name either: they appear together in the same
      // uncategorised group, so the collision would be visible there too.
      await createProject({ name: 'Internal', now: T0 })
      await expect(createProject({ name: 'internal', now: T0 })).rejects.toThrow(
        /already exists/,
      )
    })

    it('does not let a client-less project collide with a client’s', async () => {
      const acme = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
      await createProject({ name: 'General', clientId: acme.id, now: T0 })

      // Different scopes, so this is allowed — and 0005 N2 keeps them distinguishable by
      // the group heading rather than by the name.
      const internal = await createProject({ name: 'General', now: T0 })
      expect(internal.clientId).toBeNull()
    })

    it('rejects a rename that would collide inside the same client', async () => {
      const acme = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
      const other = await createClient({ name: 'Other Ltd', currency: 'GBP', now: T0 })
      await createProject({ name: 'Website', clientId: acme.id, now: T0 })
      const spare = await createProject({ name: 'Spare', clientId: acme.id, now: T0 })

      await expect(updateProject(spare.id, { name: 'website' }, T0)).rejects.toThrow(
        /already exists/,
      )

      // But moving it to a client with no such project is fine.
      await expect(
        updateProject(spare.id, { name: 'Website', clientId: other.id }, T0),
      ).resolves.toMatchObject({ name: 'Website', clientId: other.id })
    })
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

/**
 * Colour from outside (0011 T2, 0005 P3).
 *
 * The picker validates nothing on the way in — it reports every keystroke of its custom
 * field — and a restored backup is untrusted input, so `colour` used to be stored exactly
 * as given. The contract says `#rrggbb`; anything else reached four inline-style sinks and
 * rendered as no swatch, with no error anywhere.
 *
 * Not an injection risk, and the tests are careful to say so: React assigns to
 * `element.style.background`, so an invalid value is dropped by the CSSOM, and the CSP
 * forbids inline script. It is a data-integrity gap, and the fix is degradation — a bad
 * colour becomes a good one, never a blank.
 */
describe('a colour that is not a colour', () => {
  it.each([
    ['an empty string', ''],
    ['half-typed hex', '#2e6'],
    ['not hex at all', 'rebeccapurple'],
    ['a url()', 'url(https://example.com/x.png)'],
    ['an injection attempt', 'red; background-image: url(x)'],
    ['whitespace', '   '],
  ])(
    'replaces %s with a usable palette colour rather than storing it',
    async (_label, colour) => {
      const project = await createProject({ name: 'Website', colour, now: T0 })

      expect(project.colour).toMatch(/^#[0-9a-f]{6}$/)
      // And it is a colour the app can actually render, not merely well-shaped.
      expect(normaliseColour(project.colour)).toBe(project.colour)
    },
  )

  it('keeps a valid colour exactly as asked', async () => {
    const project = await createProject({ name: 'Website', colour: '#1F5FBF', now: T0 })

    // Normalised to lower case, which is what the type documents.
    expect(project.colour).toBe('#1f5fbf')
  })

  it('applies the same rule to clients and tags', async () => {
    const client = await createClient({
      name: 'Acme',
      colour: 'nope',
      currency: 'GBP',
      now: T0,
    })
    const { tag } = await createOrFindTag({ name: 'research', colour: '#zzz', now: T0 })

    expect(client.colour).toMatch(/^#[0-9a-f]{6}$/)
    expect(tag.colour).toMatch(/^#[0-9a-f]{6}$/)
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

  it('converges on an existing tag whose name arrived decomposed', async () => {
    /*
     * The bug this covers was invisible to the suite and to review, because the only test
     * of Unicode safety compared a literal with itself. `createOrFindTag` inlined
     * `trim().toLowerCase()` and dropped the `.normalize('NFC')` that `nameKey` performs,
     * so a decomposed "café" — which is what a name round-tripped through a backup, or
     * typed on a platform with a different keyboard, arrives as — compared unequal to the
     * composed tag already in the database and created a second one.
     *
     * Two tags that render identically and split a filter is the exact harm
     * `names.ts` argues normalisation prevents.
     */
    const composed = `caf${String.fromCharCode(0x00e9)}`
    const decomposed = `cafe${String.fromCharCode(0x0301)}`

    const first = await createOrFindTag({ name: composed, now: T0 })
    const second = await createOrFindTag({ name: decomposed, now: later })

    expect(second.created).toBe(false)
    expect(second.tag.id).toBe(first.tag.id)
    expect(await listTags()).toHaveLength(1)
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

  it('is a no-op the second time, and says so', async () => {
    // Null rather than undefined: the receipt is what the undo window holds, so "nothing
    // was deleted" has to be distinguishable from "deleted, here is what to undo".
    const project = await withEntries()
    await deleteProject(project.id, later)
    await expect(deleteProject(project.id, later)).resolves.toBeNull()
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
 * 0003 F4 says deleting exists for projects created by mistake, so the mistake most
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
    // Archiving is the intended way to retire a project (0003 F4, 0005 A1), and a name freed
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

/**
 * Amending a record (0005 P1: CRUD, not just create and read).
 *
 * Weighted towards what a patch must *not* do. Amending is where a record silently loses
 * a field, and a project that forgets its client or rate looks fine until a report
 * resolves the wrong money.
 */
describe('amending records', () => {
  const later = new Date('2026-10-13T18:00:00.000Z')

  beforeEach(() => {
    installDb()
  })

  it('changes a project name and leaves everything else alone', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    const project = await createProject({
      name: 'Acme',
      clientId: client.id,
      defaultRateMinor: 5000,
      currency: 'EUR',
      now: T0,
    })

    const updated = await updateProject(project.id, { name: 'Acme Rebuild' }, later)

    expect(updated.name).toBe('Acme Rebuild')
    expect(updated.clientId).toBe(client.id)
    expect(updated.defaultRateMinor).toBe(5000)
    expect(updated.currency).toBe('EUR')
    expect(updated.updatedAt).toBe(later.toISOString())
    expect(updated.createdAt).toBe(project.createdAt)
  })

  it('refuses a rename that collides with a live project', async () => {
    await createProject({ name: 'Acme', now: T0 })
    const other = await createProject({ name: 'Other', now: T0 })
    await expect(updateProject(other.id, { name: 'acme' }, later)).rejects.toThrow(
      /already exists/,
    )
  })

  it('allows a rename to the record its own name', async () => {
    // Renaming to an unchanged name is not a conflict with itself. Rejecting it would
    // make the form reject its own initial state on save.
    const project = await createProject({ name: 'Acme', now: T0 })
    await expect(updateProject(project.id, { name: 'Acme' }, later)).resolves.toMatchObject({
      name: 'Acme',
    })
  })

  it('clears a currency rather than keeping the old one', async () => {
    // Null means inherit, so a patch that cannot express "unset" would strand a project
    // on a currency override the user has removed.
    const project = await createProject({ name: 'Acme', currency: 'EUR', now: T0 })
    const updated = await updateProject(project.id, { currency: null }, later)
    expect(updated.currency).toBeNull()
  })

  it('clears a rate rather than keeping the old one', async () => {
    const project = await createProject({ name: 'Acme', defaultRateMinor: 5000, now: T0 })
    const updated = await updateProject(project.id, { defaultRateMinor: null }, later)
    expect(updated.defaultRateMinor).toBeNull()
  })

  it('rejects amending a deleted record', async () => {
    const project = await createProject({ name: 'Acme', now: T0 })
    await deleteProject(project.id, T0)
    await expect(updateProject(project.id, { name: 'Nope' }, later)).rejects.toThrow(
      /no longer exists/,
    )
  })

  it('rejects amending one that does not exist', async () => {
    await expect(updateProject('nope', { name: 'Nope' }, later)).rejects.toThrow(
      /no longer exists/,
    )
  })

  it('rejects a blank name', async () => {
    const project = await createProject({ name: 'Acme', now: T0 })
    await expect(updateProject(project.id, { name: '   ' }, later)).rejects.toThrow(
      /needs a name/,
    )
  })

  it('changes a client currency without touching its projects', async () => {
    // 0005 P8: the currency changes what future figures resolve to. Entries keep no
    // currency of their own (0003 CU6), so nothing needs rewriting — and nothing is.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    const project = await createProject({ name: 'Acme', clientId: client.id, now: T0 })

    const updated = await updateClient(client.id, { currency: 'EUR' }, later)

    expect(updated.currency).toBe('EUR')
    expect((await listProjects()).find((p) => p.id === project.id)?.clientId).toBe(client.id)
  })

  it('rejects a client rename that collides, archived or not', async () => {
    // A client name is unique regardless of archived state (0003), which is the one
    // deliberate difference from project naming.
    const first = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    const second = await createClient({ name: 'Other Ltd', currency: 'GBP', now: T0 })
    await setArchived('client', first.id, true, T0)
    await expect(updateClient(second.id, { name: 'Acme Ltd' }, later)).rejects.toThrow(
      /already exists/,
    )
  })

  it('renames a tag', async () => {
    const { tag } = await createOrFindTag({ name: 'research', now: T0 })
    const updated = await updateTag(tag.id, { name: 'Research Notes' }, later)
    expect(updated.name).toBe('Research Notes')
  })

  it('refuses a tag rename that collides case-insensitively (0005 T2)', async () => {
    await createOrFindTag({ name: 'research', now: T0 })
    const { tag } = await createOrFindTag({ name: 'review', now: T0 })
    await expect(updateTag(tag.id, { name: 'RESEARCH' }, later)).rejects.toThrow(
      /already exists/,
    )
  })
})

/**
 * Undoing a taxonomy deletion (0005 X5).
 *
 * Each case here is a way the naive implementation — clear the tombstone — would look
 * correct and still lose something: entries already orphaned, a project adopted from the
 * wrong record, an edit made inside the undo window quietly reverted.
 */
describe('undoing a taxonomy deletion', () => {
  const later = new Date('2026-10-13T18:00:00.000Z')

  beforeEach(() => {
    installDb()
  })

  async function projectWithEntry(name = 'Acme') {
    const project = await createProject({ name, now: T0 })
    const stored = await putEntry(entry({ projectId: project.id }))
    return { project, entryId: stored.id }
  }

  /**
   * Delete and hand back the receipt, failing loudly if nothing was deleted.
   *
   * The non-null assertion is banned by lint, and asserting then returning is noisier
   * than saying what the helper assumes: that the record existed and was live.
   */
  async function receiptFor<T>(deleted: Promise<T | null>): Promise<T> {
    const receipt = await deleted
    if (receipt === null) throw new Error('expected a deletion receipt, got none')
    return receipt
  }

  it('restores a deleted project and its entries', async () => {
    const { project, entryId } = await projectWithEntry()
    const receipt = await receiptFor(deleteProject(project.id, T0))
    expect(receipt).not.toBeNull()

    const outcome = await undoDeleteProject(receipt, later)

    expect(outcome).toEqual({ ok: true })
    expect((await getEntry(entryId))?.projectId).toBe(project.id)
    expect(await listProjects()).toHaveLength(1)
  })

  it('leaves entries deleted between the two intact', async () => {
    const { project, entryId } = await projectWithEntry()
    const receipt = await receiptFor(deleteProject(project.id, T0))
    await softDeleteEntry(entryId, later)

    await undoDeleteProject(receipt, later)

    // Resurrecting a deleted entry would defeat the delete entirely.
    expect((await getEntry(entryId))?.deletedAt).not.toBeNull()
  })

  it('does not steal an entry reassigned inside the undo window', async () => {
    const { project, entryId } = await projectWithEntry()
    const receipt = await receiptFor(deleteProject(project.id, T0))
    const other = await createProject({ name: 'Other', now: T0 })
    await updateEntry(entryId, { projectId: other.id }, later)

    await undoDeleteProject(receipt, later)

    expect((await getEntry(entryId))?.projectId).toBe(other.id)
  })

  it('refuses to restore over a name taken in the meantime, and explains', async () => {
    const { project } = await projectWithEntry('Acme')
    const receipt = await receiptFor(deleteProject(project.id, T0))
    await createProject({ name: 'Acme', now: later })

    const outcome = await undoDeleteProject(receipt, later)

    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.reason).toMatch(/already exists/)
    // The lesser harm: entries stay, uncategorised.
    expect((await listProjects()).map((p) => p.name)).toEqual(['Acme'])
  })

  it('reports a second undo rather than clearing twice', async () => {
    const { project } = await projectWithEntry()
    const receipt = await receiptFor(deleteProject(project.id, T0))
    await undoDeleteProject(receipt, later)
    const again = await undoDeleteProject(receipt, later)
    expect(again).toEqual({ ok: false, reason: 'Already restored.' })
  })

  it('restores a client and relinks its projects', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    const project = await createProject({ name: 'Acme', clientId: client.id, now: T0 })
    const receipt = await receiptFor(deleteClient(client.id, T0))

    const outcome = await undoDeleteClient(receipt, later)

    expect(outcome).toEqual({ ok: true })
    expect((await listClients()).map((c) => c.name)).toEqual(['Acme Ltd'])
    expect((await listProjects()).find((p) => p.id === project.id)?.clientId).toBe(client.id)
  })

  it('does not revert a project renamed inside the undo window', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    const project = await createProject({ name: 'Acme', clientId: client.id, now: T0 })
    const receipt = await receiptFor(deleteClient(client.id, T0))
    await updateProject(project.id, { name: 'Acme Phase Two' }, later)

    await undoDeleteClient(receipt, later)

    const restored = (await listProjects()).find((p) => p.id === project.id)
    // Relinked, because it is still client-less — but under the new name it now has.
    expect(restored?.name).toBe('Acme Phase Two')
    expect(restored?.clientId).toBe(client.id)
  })

  it('leaves a project that gained a client in the meantime alone', async () => {
    const first = await createClient({ name: 'First Ltd', currency: 'GBP', now: T0 })
    const second = await createClient({ name: 'Second Ltd', currency: 'GBP', now: T0 })
    const project = await createProject({ name: 'Acme', clientId: first.id, now: T0 })
    const receipt = await receiptFor(deleteClient(first.id, T0))
    await updateProject(project.id, { clientId: second.id }, later)

    await undoDeleteClient(receipt, later)

    expect((await listProjects()).find((p) => p.id === project.id)?.clientId).toBe(second.id)
  })

  it('restores a deleted tag onto its entries', async () => {
    const { tag } = await createOrFindTag({ name: 'research', now: T0 })
    const stored = await putEntry(entry({ tagIds: [tag.id] }))
    const receipt = await receiptFor(deleteTag(tag.id, T0))
    expect((await getEntry(stored.id))?.tagIds).toEqual([])

    const outcome = await undoDeleteTag(receipt, later)

    expect(outcome).toEqual({ ok: true })
    expect((await getEntry(stored.id))?.tagIds).toEqual([tag.id])
  })

  it('does not duplicate a tag an entry already carries', async () => {
    const { tag } = await createOrFindTag({ name: 'research', now: T0 })
    const stored = await putEntry(entry({ tagIds: [tag.id] }))
    const receipt = await receiptFor(deleteTag(tag.id, T0))
    await updateEntry(stored.id, { tagIds: [tag.id] }, later)

    await undoDeleteTag(receipt, later)

    expect((await getEntry(stored.id))?.tagIds).toEqual([tag.id])
  })
})

describe('delete impact for confirmations (0005 X1, X4, T3)', () => {
  beforeEach(() => {
    installDb()
  })

  it('counts a client by its projects, not its entries', async () => {
    // The entries survive a client deletion, so a count of entries would overstate what
    // changes. Reports move to the client-less bucket and reconcile.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'One', clientId: client.id, now: T0 })
    await createProject({ name: 'Two', clientId: client.id, now: T0 })
    await createProject({ name: 'Free', now: T0 })

    expect(await clientDeleteImpact(client.id)).toEqual({ projectCount: 2 })
  })

  it('counts a tag by the entries carrying it', async () => {
    const { tag } = await createOrFindTag({ name: 'research', now: T0 })
    await putEntry(entry({ tagIds: [tag.id] }))
    await putEntry(entry({ tagIds: [tag.id] }))
    await putEntry(entry())

    expect(await tagEntryCount(tag.id)).toBe(2)
  })
})

/**
 * Revision notification (0005 X1–X5).
 *
 * Every write here has to tell the views, because every view subscribes to a revision
 * counter rather than to IndexedDB. A write that lands correctly but stays quiet is
 * invisible in a test that only inspects the database and obvious in the app, where the
 * row simply never comes back.
 *
 * This block exists because two of these bumps were missing: the deletes, and then the
 * undos. Both were found by the browser suite rather than by a unit test, because a test
 * that only reads back the rows cannot tell a quiet write from an unobserved one.
 */
describe('notifying views', () => {
  beforeEach(() => {
    installDb()
  })

  /** Counts notifications raised while `run` executes, after the setup has settled. */
  async function notificationsFrom(run: () => Promise<unknown>): Promise<number> {
    let notified = 0
    const unsubscribe = subscribe(() => {
      notified += 1
    })
    try {
      await run()
      return notified
    } finally {
      unsubscribe()
    }
  }

  /** A project holding one entry, deleted, so there is a receipt to undo. */
  async function deletedProjectWithEntry(name = 'Acme') {
    const project = await createProject({ name, now: T0 })
    await putEntry(entry({ projectId: project.id }))
    return { project, receipt: await deleteProject(project.id, T0) }
  }

  it('notifies on delete', async () => {
    const project = await createProject({ name: 'Acme', now: T0 })
    const before = getRevision()

    await notificationsFrom(async () => {
      await deleteProject(project.id, T0)
    })

    expect(getRevision()).toBeGreaterThan(before)
  })

  it('notifies on undo of a delete', async () => {
    const { receipt } = await deletedProjectWithEntry()
    if (receipt === null) throw new Error('expected a deletion receipt, got none')
    const before = getRevision()

    await notificationsFrom(async () => {
      await undoDeleteProject(receipt, T0)
    })

    expect(getRevision()).toBeGreaterThan(before)
  })

  it('notifies on undo of a client delete', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'One', clientId: client.id, now: T0 })
    const receipt = await deleteClient(client.id, T0)
    if (receipt === null) throw new Error('expected a deletion receipt, got none')
    const before = getRevision()

    await notificationsFrom(async () => {
      await undoDeleteClient(receipt, T0)
    })

    expect(getRevision()).toBeGreaterThan(before)
  })

  it('notifies on undo of a tag delete', async () => {
    const { tag } = await createOrFindTag({ name: 'research', now: T0 })
    const receipt = await deleteTag(tag.id, T0)
    if (receipt === null) throw new Error('expected a deletion receipt, got none')
    const before = getRevision()

    await notificationsFrom(async () => {
      await undoDeleteTag(receipt, T0)
    })

    expect(getRevision()).toBeGreaterThan(before)
  })

  it('stays quiet when a restore is refused, because nothing was written', async () => {
    const project = await createProject({ name: 'Acme', now: T0 })
    const receipt = await deleteProject(project.id, T0)
    if (receipt === null) throw new Error('expected a deletion receipt, got none')
    // Take the name, which is the one way a restore can legitimately be refused.
    await createProject({ name: 'Acme', now: T0 })

    const notified = await notificationsFrom(async () => {
      const outcome = await undoDeleteProject(receipt, T0)
      expect(outcome.ok).toBe(false)
    })

    expect(notified).toBe(0)
  })
})
