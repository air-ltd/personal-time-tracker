import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { TaxonomySettings } from './TaxonomySettings'
import { installTestDb } from '../../test/harness'
import { entry } from '../../test/factories'
import { writeDefaultCurrency } from '../../storage/settingsRepo'
import {
  createClient,
  createOrFindTag,
  createProject,
  listClients,
  listProjects,
  listTags,
  setArchived,
} from '../../storage/taxonomyRepo'
import { putEntry, getEntry } from '../../storage/entriesRepo'
import { FALLBACK_CURRENCY } from '../../domain/taxonomy/money'

/**
 * Taxonomy settings (0005).
 *
 * These assertions are about what the user is told before a destructive action, not only
 * about what the database ends up holding. 0005 X1–X3 is a specification of wording and
 * counts: a delete that orphaned entries silently would satisfy most of a suite written
 * the other way round.
 *
 * Queries go through Testing Library rather than a hand-rolled `act` wrapper. Nearly every
 * interaction here reads IndexedDB before it sets state — a delete confirmation loads its
 * impact counts first (0005 X1) — so the screen is not necessarily settled the instant a
 * click resolves, and `waitFor` is what makes the difference between "eventually correct"
 * and "correct when the microtasks happened to line up".
 */

const T0 = new Date('2026-10-13T09:00:00.000Z')

let user: UserEvent

beforeEach(() => {
  installTestDb()
  user = userEvent.setup()
})

/**
 * Render the panel under test and wait for the first read.
 *
 * The taxonomy is read from IndexedDB in an effect, so the panel renders a loading line
 * first and only then the rows. Rendering is synchronous, so without this every assertion
 * would race the first read.
 */
async function show(): Promise<void> {
  render(<TaxonomySettings now={T0} />)
  await waitFor(() => {
    expect(screen.queryByText(/Loading settings/)).toBeNull()
  })
}

/** The list row for a taxonomy record, found by its name rather than its position. */
/**
 * Opens the form for adding a project to one group, opening the group first if needed.
 *
 * There is no page-level "New project" button any more (item 56): a project is added from
 * the list it will join. The button lives inside that list, so a collapsed group has to be
 * opened before the button is reachable — which is also what the user would do.
 */
async function addProjectTo(clientName: string): Promise<void> {
  const group = screen
    .getByText(clientName, { selector: '.taxonomy-group-name' })
    .closest('.taxonomy-group')
  if (!group) throw new Error(`no group named "${clientName}"`)
  const toggle = group.querySelector<HTMLElement>('.taxonomy-group-toggle')
  if (toggle?.getAttribute('aria-expanded') !== 'true') {
    await user.click(toggle as HTMLElement)
  }
  await user.click(
    within(group as HTMLElement).getByRole('button', { name: `New project for ${clientName}` }),
  )
}

/**
 * A group's add-project button, whether or not the group is open.
 *
 * `hidden: true` because the button lives inside the collapsible list, and a role query
 * skips hidden elements by default — so the ordinary query cannot see a closed group's
 * button, which is exactly what the "hides with its list" test needs to check.
 */
/** Every group in the tree, in render order. */
function groups(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.taxonomy-group')]
}

/** The group headed by a name — a client, or "No client". */
function groupNamed(name: string): HTMLElement {
  const group = groups().find(
    (g) => g.querySelector('.taxonomy-group-name')?.textContent === name,
  )
  if (!group) throw new Error(`no group named "${name}"`)
  return group
}

function addButtonFor(clientName: string): HTMLElement {
  const group = screen
    .getByText(clientName, { selector: '.taxonomy-group-name' })
    .closest('.taxonomy-group')
  if (!group) throw new Error(`no group named "${clientName}"`)
  return within(group as HTMLElement).getByRole('button', {
    name: `New project for ${clientName}`,
    hidden: true,
  })
}

/**
 * A client names itself on its group header; a project or tag names itself on its row, in
 * `.taxonomy-name-text` for a project (its own element, so the archived strike reaches the
 * name and stops there). All are "the name on this record", so the helpers take any.
 */
const NAME_SELECTOR = '.taxonomy-group-name, .taxonomy-name, .taxonomy-name-text'

/**
 * Adds an internal-work project, created from a client's group with the client changed to
 * "No client" in the picker.
 *
 * There is no empty "No client" group to click (item 59), so this is the only route: the
 * client picker offers "No client — internal work" as a real choice (0005 R1/U1).
 */
async function addInternalProject(name: string): Promise<void> {
  await addProjectTo('Acme Ltd')
  await user.type(screen.getByLabelText('Project name'), name)
  await user.selectOptions(screen.getByLabelText('Client'), '')
  await user.click(screen.getByRole('button', { name: 'Add project' }))
}

/**
 * A taxonomy row that is already rendered, for tests about the grouping itself — where
 * opening the group would be the thing under test.
 */
function visibleRowFor(name: string): HTMLElement {
  const label = screen.getByText(name, { selector: NAME_SELECTOR })
  const row = label.closest('li')
  if (!row) throw new Error(`"${name}" is not inside a taxonomy row`)
  return row
}

/**
 * A taxonomy row by name, opening its client group first if it needs to (item 51).
 *
 * Projects are collapsed under their client by default, so most tests have to open a group
 * before they can act on a row. Doing that here rather than in each test means a test about,
 * say, archiving a project does not also have to know how the grouping works — and it keeps
 * the collapsing itself asserted in one place.
 */
async function rowFor(name: string): Promise<HTMLElement> {
  const label = await screen.findByText(name, { selector: NAME_SELECTOR })
  const row = label.closest('li')
  if (!row) throw new Error(`"${name}" is not inside a taxonomy row`)
  // A client row *is* the group's disclosure, so opening it is the caller's business. Only a
  // project row needs its group opened for it, and opening that would be a side effect of
  // merely looking one up.
  if (label.closest('.taxonomy-group-toggle') === null) {
    const toggle = row
      .closest('.taxonomy-group')
      ?.querySelector<HTMLElement>('.taxonomy-group-toggle')
    if (toggle && toggle.getAttribute('aria-expanded') !== 'true') {
      await user.click(toggle)
    }
  }
  return row
}

async function rowButton(name: string, label: string): Promise<HTMLElement> {
  return within(await rowFor(name)).getByRole('button', { name: label })
}

/** The form a field belongs to, so duplicate labels ("Billing currency") stay unambiguous. */
function formFor(labelText: string): HTMLElement {
  const field = screen.getByLabelText(labelText)
  const form = field.closest('form')
  if (!form) throw new Error(`"${labelText}" is not inside a form`)
  return form
}

describe('showing what is stored in user units', () => {
  it('shows a rate as money, not as the storage integer', async () => {
    // £75/hour is 7500 minor units. "7500 minor units/hour" is the storage layer talking to
    // the user, which is the exact thing the money rules exist to stop.
    await createClient({
      name: 'Acme Ltd',
      currency: 'GBP',
      defaultRateMinor: 7_500,
      now: T0,
    })
    await show()

    // A regex, because the currency label and the rate are sibling text nodes in one span.
    expect(await screen.findByText(/75\.00\/hour/)).toBeInTheDocument()
    expect(screen.queryByText(/minor units/)).not.toBeInTheDocument()
  })

  it('shows a project rate as money, and not just the word "billable"', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({
      name: 'Widget',
      clientId: client.id,
      defaultRateMinor: 1_200,
      now: T0,
    })
    await show()

    expect(screen.getByText(/£12.00\/hour/)).toBeInTheDocument()
  })
})

describe('the one archived control', () => {
  it('reveals archived clients and archived projects together', async () => {
    // One decision about one idea. It was two checkboxes under one heading, asking the user
    // to treat "see archived clients" and "see archived projects" as separate questions — and
    // the first version of it was worse, two checkboxes bound to one value, each reporting
    // the other's state.
    const live = await createClient({ name: 'Live Co', currency: 'GBP', now: T0 })
    const gone = await createClient({ name: 'Gone Co', currency: 'GBP', now: T0 })
    await setArchived('client', gone.id, true, T0)
    await createProject({ name: 'Current', clientId: live.id, now: T0 })
    const retired = await createProject({ name: 'Retired', clientId: live.id, now: T0 })
    await setArchived('project', retired.id, true, T0)
    await show()

    expect(screen.queryByText('Gone Co')).toBeNull()
    expect(screen.queryByText('Retired')).toBeNull()

    await user.click(screen.getByLabelText('Show archived clients and projects'))

    // Both, or the label is not describing the control.
    expect(screen.getByText('Gone Co')).toBeInTheDocument()
    expect(screen.getByText('Retired')).toBeInTheDocument()
  })

  it('offers exactly one such control, so there is nothing to disagree with', async () => {
    await show()
    expect(screen.getAllByRole('checkbox', { name: /Show archived/ })).toHaveLength(1)
  })

  it('hides both again on the way out', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await setArchived('client', client.id, true, T0)
    await show()

    await user.click(screen.getByLabelText('Show archived clients and projects'))
    expect(screen.getByText('Acme Ltd')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Show archived clients and projects'))
    expect(screen.queryByText('Acme Ltd')).toBeNull()
  })

  it('counts the hidden records of both types together', async () => {
    // The number is what the control reveals, so it cannot be one type's count.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await setArchived('client', client.id, true, T0)
    const project = await createProject({ name: 'Retired', clientId: client.id, now: T0 })
    await setArchived('project', project.id, true, T0)
    await show()

    expect(screen.getByText('2 records are hidden.')).toBeInTheDocument()
  })
})

describe('giving each new project its own colour', () => {
  it('does not reuse the colour of the project just created', async () => {
    // It used to: the form reset the name, rate and currency but not the colour, so the
    // second project opened as the first project's colour and a chart needed its legend
    // decoded — the thing the palette exists to prevent.
    const user = userEvent.setup()
    await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await show()
    await addProjectTo('Acme Ltd')

    let form = formFor('Project name')
    await user.type(within(form).getByLabelText('Project name'), 'Widget')
    await user.click(within(form).getByRole('button', { name: 'Add project' }))
    await rowFor('Widget')

    await addProjectTo('Acme Ltd')
    form = formFor('Project name')
    await user.type(within(form).getByLabelText('Project name'), 'Gadget')
    await user.click(within(form).getByRole('button', { name: 'Add project' }))
    await rowFor('Gadget')

    // Read from storage, not the DOM: this is about what was *written*, and a DOM read
    // would pass even if the list were rendering a stale row.
    const colours = (await listProjects()).map((project) => project.colour)
    expect(colours).toHaveLength(2)
    expect(colours[0]).not.toBe(colours[1])
  })
})

describe('creating records (0005 P1, P2, P7)', () => {
  it('creates a client with a currency and a rate', async () => {
    await show()
    await user.click(screen.getByTestId('new-client'))

    const form = formFor('Client name')
    await user.type(within(form).getByLabelText('Client name'), 'Acme Ltd')
    // 0005 P7: the picker offers currencies by name, and the stored value is the code.
    await user.selectOptions(within(form).getByLabelText('Billing currency'), 'GBP')
    await user.type(within(form).getByLabelText('Default hourly rate'), '75')
    await user.click(within(form).getByRole('button', { name: 'Add client' }))

    await waitFor(async () => {
      // £75/hour is 7500 minor units — rates are per hour, not per currency in total.
      expect(await listClients()).toMatchObject([
        { name: 'Acme Ltd', currency: 'GBP', defaultRateMinor: 7_500 },
      ])
    })
    expect(await screen.findByText('Acme Ltd', { selector: NAME_SELECTOR })).toBeInTheDocument()
  })

  it('lists a created project and reports its client by name', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Website', clientId: client.id, now: T0 })
    await show()

    // 0005 N2: project and client are told apart by grouping and labelling, never by colour
    // alone. Now by *structure* rather than by repetition: the client is the group heading,
    // so it is named once for the group instead of on every row inside it (item 51). The row
    // carries only its own project name, which is what it is.
    const group = visibleRowFor('Website').closest('.taxonomy-group')
    expect(group).not.toBeNull()
    expect(within(group as HTMLElement).getByText('Acme Ltd')).toBeInTheDocument()
  })

  it('says so when a project has no client, rather than showing nothing', async () => {
    await createProject({ name: 'Internal', now: T0 })
    await show()

    // 0005 U1: uncategorised is a legitimate visible state, so it is named.
    // Orphans get their own group rather than being scattered through the list.
    const orphan = visibleRowFor('Internal').closest('.taxonomy-group')
    expect(orphan).not.toBeNull()
    expect((orphan as HTMLElement).querySelector('.taxonomy-group-name')).toHaveTextContent(
      'No client',
    )
  })

  it('refuses a duplicate project name and reports why', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Acme', clientId: client.id, now: T0 })
    await show()
    await addProjectTo('Acme Ltd')

    const form = formFor('Project name')
    await user.type(within(form).getByLabelText('Project name'), 'acme')
    await user.click(within(form).getByRole('button', { name: 'Add project' }))

    expect(await screen.findByTestId('settings-error')).toHaveTextContent(/already exists/)
    expect(await listProjects()).toHaveLength(1)
  })

  it('creates a project with no client', async () => {
    // 0005 R1/U1: no client is a legitimate state, offered as a choice rather than being an
    // absent option — so it is reachable from any client's add button.
    await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await show()
    await addProjectTo('Acme Ltd')

    const form = formFor('Project name')
    await user.type(within(form).getByLabelText('Project name'), 'Internal')
    await user.selectOptions(within(form).getByLabelText('Client'), '')
    await user.click(within(form).getByRole('button', { name: 'Add project' }))

    await waitFor(async () => {
      expect(await listProjects()).toMatchObject([{ name: 'Internal', clientId: null }])
    })
  })
})

/**
 * Clients and projects are not deletable (0005 X1, X2, X3).
 *
 * The whole point of the change, so it is asserted as an absence: there is no Delete button
 * on either row, and archiving asks for no confirmation. Both halves matter — a delete
 * hiding behind a shortcut is still a delete, and an archive that prompts teaches the user
 * to dismiss prompts, which is what X3 forbids.
 */
describe('no delete, only archive (0005 X1–X3)', () => {
  it('offers no Delete on a client row', async () => {
    await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await show()

    expect(
      within(await rowFor('Acme Ltd')).queryByRole('button', { name: 'Delete' }),
    ).toBeNull()
    // And the way to retire one is still there.
    expect(
      within(await rowFor('Acme Ltd')).getByRole('button', { name: 'Archive' }),
    ).toBeInTheDocument()
  })

  it('offers no Delete on a project row', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Acme', clientId: client.id, now: T0 })
    await show()

    expect(within(await rowFor('Acme')).queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(
      within(await rowFor('Acme')).getByRole('button', { name: 'Archive' }),
    ).toBeInTheDocument()
  })

  it('archives a client without any confirmation, because nothing is at stake (X3)', async () => {
    // No impact count, no second confirmation. Archiving moves no entry, so a prompt here
    // would say nothing the user could act on.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'One', clientId: client.id, now: T0 })
    await show()

    await user.click(await rowButton('Acme Ltd', 'Archive'))

    // The client row goes, and its projects go with it: a project's visibility follows its
    // client's (item 57). The project itself is not archived, so it returns with its client.
    await waitFor(() =>
      expect(screen.queryByText('Acme Ltd', { selector: NAME_SELECTOR })).toBeNull(),
    )
    expect(screen.queryByText('One')).toBeNull()
    expect(screen.queryByTestId('delete-confirm')).toBeNull()

    expect((await listProjects({ includeArchived: true }))[0]?.archived).toBe(false)
  })

  it('round-trips: archive hides it, Restore brings it back (X2)', async () => {
    await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await show()

    await user.click(await rowButton('Acme Ltd', 'Archive'))
    await waitFor(() =>
      expect(screen.queryByText('Acme Ltd', { selector: NAME_SELECTOR })).toBeNull(),
    )
    expect((await listClients({ includeArchived: true }))[0]?.archived).toBe(true)

    // Only findable with the archived toggle, which is what makes it recoverable.
    await user.click(screen.getByLabelText('Show archived clients and projects'))
    await waitFor(() =>
      expect(screen.getByText('Acme Ltd', { selector: NAME_SELECTOR })).toBeInTheDocument(),
    )

    await user.click(await rowButton('Acme Ltd', 'Restore'))

    // Back to a live client: still on screen, because the toggle is still on, and now
    // offering Archive again rather than Restore.
    await waitFor(async () =>
      expect(
        within(await rowFor('Acme Ltd')).getByRole('button', { name: 'Archive' }),
      ).toBeInTheDocument(),
    )
    expect((await listClients({ includeArchived: true }))[0]?.archived).toBe(false)

    // And it survives being archived and restored without a reload in between.
    expect(screen.getByText('Acme Ltd', { selector: NAME_SELECTOR })).toBeInTheDocument()
  })

  it('still deletes a tag, because deleting a tag moves entries rather than hiding one', async () => {
    // The distinction the whole change turns on. A tag has no archive state (0005 T5), and
    // deleting it strips it from every entry carrying it, so it keeps its count and its undo.
    const { tag } = await createOrFindTag({ name: 'research', now: T0 })
    await putEntry(entry({ tagIds: [tag.id] }))
    await show()

    await user.click(await rowButton('research', 'Delete'))

    expect(await screen.findByTestId('delete-impact')).toHaveTextContent(
      '1 entry carries this tag.',
    )
  })
})

describe('archiving (0005 A1–A5)', () => {
  it('hides an archived project by default', async () => {
    const project = await createProject({ name: 'Old', now: T0 })
    await setArchived('project', project.id, true, T0)
    await show()

    expect(screen.queryByText('Old', { selector: NAME_SELECTOR })).toBeNull()
    expect(screen.getByText('1 record is hidden.')).toBeInTheDocument()
  })

  it('shows it when asked, so historical entries stay editable (0005 A2)', async () => {
    const project = await createProject({ name: 'Old', now: T0 })
    await setArchived('project', project.id, true, T0)
    await show()

    await user.click(screen.getByLabelText('Show archived clients and projects'))

    expect(await screen.findByText('Old', { selector: NAME_SELECTOR })).toBeInTheDocument()
  })

  it('keeps historical entries pointed at an archived project (0005 A1)', async () => {
    const project = await createProject({ name: 'Old', now: T0 })
    const stored = await putEntry(entry({ projectId: project.id }))
    await setArchived('project', project.id, true, T0)
    await show()

    // Archiving hides the project from pickers; it does not orphan history.
    expect((await getEntry(stored.id))?.projectId).toBe(project.id)
    expect((await listProjects({ includeArchived: true }))[0]?.archived).toBe(true)
  })

  it('restores an archived project (0005 A5)', async () => {
    const project = await createProject({ name: 'Old', now: T0 })
    await setArchived('project', project.id, true, T0)
    await show()
    await user.click(screen.getByLabelText('Show archived clients and projects'))

    // Archived projects sit under their group like any other, so the group has to be open
    // before the row's action is reachable (item 51).
    await user.click(await rowButton('Old', 'Restore'))

    await waitFor(async () => {
      expect((await listProjects({ includeArchived: true }))[0]?.archived).toBe(false)
    })
  })

  it('does not cascade an archive to its projects (0005 A4)', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'One', clientId: client.id, now: T0 })
    await setArchived('client', client.id, true, T0)
    await show()

    const projects = await listProjects()
    expect(projects[0]?.archived).toBe(false)
    expect(projects[0]?.clientId).toBe(client.id)
  })
})

describe('tags (0005 T2, T4)', () => {
  it('says so when a typed tag name already exists rather than duplicating it', async () => {
    await createOrFindTag({ name: 'research', now: T0 })
    await show()

    await user.type(screen.getByLabelText('New tag'), 'Research')
    await user.click(screen.getByRole('button', { name: 'Add tag' }))

    // A note, not an error: an existing name is an expected outcome, and announcing it
    // through `role="alert"` with a Dismiss button dressed it as a failure.
    expect(await screen.findByTestId('settings-notice')).toHaveTextContent(/already exists/i)
    expect(screen.queryByTestId('settings-error')).toBeNull()
    expect(await listTags()).toHaveLength(1)
  })

  it('takes the merged-away tag off the list (0005 T4)', async () => {
    // A merge tombstones the source tag, so the list has to re-read straight away — the
    // same reactivity the undo path needs, and asserted on the screen rather than only in
    // the database.
    const { tag: research } = await createOrFindTag({ name: 'research', now: T0 })
    const { tag: review } = await createOrFindTag({ name: 'review', now: T0 })
    await show()

    await user.click(await rowButton('research', 'Merge…'))
    const merge = await screen.findByTestId('tag-merge')
    await user.selectOptions(within(merge).getByLabelText(/into$/), review.id)
    await user.click(within(merge).getByRole('button', { name: 'Merge tags' }))

    await waitFor(() => {
      expect(screen.queryByText('research', { selector: NAME_SELECTOR })).toBeNull()
    })
    expect(research.name).toBe('research')
  })

  it('merges one tag into another (0005 T4)', async () => {
    const { tag: research } = await createOrFindTag({ name: 'research', now: T0 })
    const { tag: review } = await createOrFindTag({ name: 'review', now: T0 })
    const stored = await putEntry(entry({ tagIds: [research.id, review.id] }))
    await show()

    await user.click(await rowButton('research', 'Merge…'))
    const merge = await screen.findByTestId('tag-merge')
    await user.selectOptions(within(merge).getByLabelText(/into$/), review.id)
    await user.click(within(merge).getByRole('button', { name: 'Merge tags' }))

    // The entry keeps one reference to the surviving tag, not two.
    await waitFor(async () => {
      expect((await getEntry(stored.id))?.tagIds).toEqual([review.id])
    })
    expect((await listTags()).map((t) => t.name)).toEqual(['review'])
  })

  it('never offers a tag as the target of its own merge', async () => {
    // Merging a tag into itself would tombstone the tag and leave every entry pointing at
    // a deleted record, so it has to be unreachable rather than merely rejected.
    await createOrFindTag({ name: 'research', now: T0 })
    await createOrFindTag({ name: 'review', now: T0 })
    await show()

    await user.click(await rowButton('research', 'Merge…'))
    const merge = await screen.findByTestId('tag-merge')

    expect(within(merge).getByLabelText(/into$/).textContent).toBe('Choose a tagreview')
    expect(await listTags()).toHaveLength(2)
  })

  it('reports how many entries a tag deletion would affect (0005 T3)', async () => {
    const { tag } = await createOrFindTag({ name: 'research', now: T0 })
    await putEntry(entry({ tagIds: [tag.id] }))
    await show()
    await user.click(await rowButton('research', 'Delete'))

    expect(await screen.findByTestId('delete-impact')).toHaveTextContent(
      '1 entry carries this tag.',
    )
  })
})

describe('colour choice (0005 P3–P4)', () => {
  it('offers the accessible palette rather than a free colour wheel', async () => {
    await createProject({ name: 'Acme', now: T0 })
    await show()
    await user.click(await rowButton('Acme', 'Edit'))

    const picker = await screen.findByRole('radiogroup', { name: 'Project colour' })
    // Twelve palette entries plus the custom option.
    expect(within(picker).getAllByRole('radio')).toHaveLength(13)
    // Each swatch names itself, so the choice is not colour alone (0005 N2).
    expect(within(picker).getByRole('radio', { name: 'Project colour: #2e6aae' })).toBeChecked()
  })

  it('measures contrast for a colour typed by hand', async () => {
    await createProject({ name: 'Acme', now: T0 })
    await show()
    await user.click(await rowButton('Acme', 'Edit'))

    const picker = await screen.findByRole('radiogroup', { name: 'Project colour' })
    await user.click(within(picker).getByRole('radio', { name: 'Project colour: custom' }))
    await user.type(screen.getByLabelText('Custom colour'), '#767676')

    // The number is reported whether or not it passes, so the user can decide.
    expect(await screen.findByTestId('colour-assessment')).toHaveTextContent(/\d+\.\d+:1 light/)
  })
})

describe('a new client starts at the app default currency (item 31)', () => {
  it('picks up the default when one has been set', async () => {
    // Setting the default and then adding a client that ignores it is worse than having
    // no default: the user has said what they bill in, and every client after that has to
    // be corrected by hand.
    await writeDefaultCurrency('JPY')
    await show()
    await user.click(screen.getByTestId('new-client'))

    await waitFor(() => {
      expect(screen.getByLabelText('Billing currency')).toHaveValue('JPY')
    })
  })

  it('falls back to the chain’s last link when no default has been set', async () => {
    await show()
    await user.click(screen.getByTestId('new-client'))

    expect(await screen.findByLabelText('Billing currency')).toHaveValue(FALLBACK_CURRENCY)
  })

  it('leaves an existing client’s currency alone', async () => {
    // Only a *new* client follows the default. Overwriting one that already bills in
    // something else would silently restate what they charge.
    await writeDefaultCurrency('JPY')
    await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await show()

    await user.click(await rowButton('Acme Ltd', 'Edit'))

    expect(await screen.findByLabelText('Billing currency')).toHaveValue('GBP')
  })

  it('saves the default when the client is created without touching the field', async () => {
    await writeDefaultCurrency('JPY')
    await show()
    await user.click(screen.getByTestId('new-client'))

    const form = formFor('Client name')
    await user.type(within(form).getByLabelText('Client name'), 'Acme Ltd')
    await user.click(within(form).getByRole('button', { name: 'Add client' }))

    // Submitted before the stored default has loaded, which is the ordinary case: the
    // field is filled in as soon as it is shown, so a quick save must not race it.
    await waitFor(async () => {
      expect(await listClients()).toMatchObject([{ name: 'Acme Ltd', currency: 'JPY' }])
    })
  })
})

describe('projects grouped under their client (item 51)', () => {
  /** The disclosure buttons, in the order they are rendered. */
  function groupToggles(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('.taxonomy-group-toggle')]
  }

  /** The first disclosure button, for tests with only one group in play. */
  function firstGroupToggle(): HTMLElement {
    const toggle = groupToggles()[0]
    if (!toggle) throw new Error('no project group is rendered')
    return toggle
  }

  /** The name shown on a disclosure button. */
  function toggleName(toggle: HTMLElement): string {
    return toggle.querySelector('.taxonomy-group-name')?.textContent ?? ''
  }

  it('names each group after its client, and never mixes clients into one group', async () => {
    const acme = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    const other = await createClient({ name: 'Other Co', currency: 'GBP', now: T0 })
    await createProject({ name: 'Website', clientId: acme.id, now: T0 })
    await createProject({ name: 'Intranet', clientId: acme.id, now: T0 })
    await createProject({ name: 'Rebrand', clientId: other.id, now: T0 })
    await createProject({ name: 'Internal', now: T0 })
    await show()

    // One group per client, plus one for the orphan — so four groups, not four rows' worth
    // of repeated headings.
    expect(groupToggles().map(toggleName)).toEqual(['Acme Ltd', 'Other Co', 'No client'])

    // Each project's row lives in its own client's group.
    expect(visibleRowFor('Website').closest('.taxonomy-group')).toBe(
      visibleRowFor('Intranet').closest('.taxonomy-group'),
    )
    expect(visibleRowFor('Website').closest('.taxonomy-group')).not.toBe(
      visibleRowFor('Rebrand').closest('.taxonomy-group'),
    )
    expect(visibleRowFor('Internal').closest('.taxonomy-group')).not.toBe(
      visibleRowFor('Website').closest('.taxonomy-group'),
    )
  })

  it('collapses every group by default, hiding the projects behind a disclosure', async () => {
    // The complaint behind item 51 was a long undifferentiated list, so the default state has
    // to be the short one: clients visible, their projects one click away.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Website', clientId: client.id, now: T0 })
    await show()

    expect(visibleRowFor('Acme Ltd')).toBeInTheDocument()
    expect(toggleName(firstGroupToggle())).toBe('Acme Ltd')

    const toggle = firstGroupToggle()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    // Collapsed for real, not just labelled that way: the row is rendered but hidden.
    const row = visibleRowFor('Website')
    expect(row).not.toBeVisible()
  })

  it('does not tell a project row the wrong client, or claim it has none', async () => {
    // A regression guard for a lie the row used to tell. Item 51 moved the owner to the
    // group heading, and the row kept a "Client: X" label fed by a prop nothing set — so
    // every project, including ones under a named client, read "No client".
    const acme = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Website', clientId: acme.id, now: T0 })
    await createProject({ name: 'Internal', now: T0 })
    await show()

    // The owner is named once, by the group heading.
    expect(screen.getAllByText('Acme Ltd', { selector: '.taxonomy-group-name' })).toHaveLength(
      1,
    )
    // And no row contradicts it: nothing claims "No client" in a group that has one.
    const acmeGroup = visibleRowFor('Website').closest('.taxonomy-group') as HTMLElement
    expect(within(acmeGroup).queryByText(/No client/)).toBeNull()
    expect(within(acmeGroup).queryByText(/Client: /)).toBeNull()

    // The orphan group still says so, by heading rather than by row.
    const orphan = visibleRowFor('Internal').closest('.taxonomy-group') as HTMLElement
    expect(orphan.querySelector('.taxonomy-group-name')).toHaveTextContent('No client')
  })

  it('opens and closes a group, showing its projects only while it is open', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Website', clientId: client.id, now: T0 })
    await show()

    const toggle = firstGroupToggle()
    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(visibleRowFor('Website')).toBeVisible()

    // And closes again, so the toggle is a toggle rather than a one-way reveal.
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(visibleRowFor('Website')).not.toBeVisible()
  })

  it('opens one group without opening the others', async () => {
    // The point of collapsing is to shorten the list; opening everything to see one project
    // would defeat it. Each group keeps its own state.
    const acme = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Website', clientId: acme.id, now: T0 })
    await createProject({ name: 'Internal', now: T0 })
    await show()

    await user.click(firstGroupToggle())

    expect(visibleRowFor('Website')).toBeVisible()
    expect(visibleRowFor('Internal')).not.toBeVisible()
  })

  it('ties each disclosure to its own group, for a screen reader', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Website', clientId: client.id, now: T0 })
    await show()

    // aria-controls has to point at the panel it actually opens, or assistive tech announces
    // a relationship that does not exist.
    const toggle = firstGroupToggle()
    const controlled = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(controlled).not.toBeNull()
    expect(controlled?.classList.contains('taxonomy-list')).toBe(true)
    expect(controlled).toContainElement(visibleRowFor('Website'))
  })

  it('keeps grouping after a new project is added', async () => {
    // The grouping is derived at render time, so a reload after adding must not lose it —
    // otherwise the list silently reverts to flat and the fix looks intermittent.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Website', clientId: client.id, now: T0 })
    await show()

    await addProjectTo('Acme Ltd')
    const form = formFor('Project name')
    await user.type(within(form).getByLabelText('Project name'), 'Intranet')
    await user.click(within(form).getByRole('button', { name: 'Add project' }))

    await waitFor(() => expect(visibleRowFor('Intranet')).toBeInTheDocument())
    expect(visibleRowFor('Intranet').closest('.taxonomy-group')).toBe(
      visibleRowFor('Website').closest('.taxonomy-group'),
    )
  })
})

describe('one section for clients and their projects (item 54)', () => {
  it('shows no separate Clients and Projects sections', async () => {
    // The two lists were the thing being compressed. If either heading comes back, the
    // client and its projects are being rendered twice again and the point is lost.
    await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await show()

    expect(screen.queryByRole('heading', { name: 'Clients', level: 3 })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Projects', level: 3 })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Clients and projects' })).toBeInTheDocument()
  })

  it('carries the client actions on the same row that reveals its projects', async () => {
    // One place to act on a client, and it is the same place its projects are found.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Website', clientId: client.id, now: T0 })
    await show()

    const group = groupNamed('Acme Ltd')
    const toggle = group.querySelector('.taxonomy-group-toggle')
    const actions = group.querySelector('.taxonomy-actions')
    expect(toggle).not.toBeNull()
    expect(actions).not.toBeNull()
    expect(
      within(actions as HTMLElement).getByRole('button', { name: 'Archive' }),
    ).toBeInTheDocument()
    // The project's row sits under that same group, not in a list of its own elsewhere.
    expect(group.querySelector('.taxonomy-row')).not.toBeNull()
  })

  it('lists every client, including one with no projects', async () => {
    // A client with nothing under it still exists and can still be edited or archived. It
    // disappearing would mean the only list of clients silently lost records.
    await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createClient({ name: 'Quiet Co', currency: 'GBP', now: T0 })
    await show()

    expect(groups().map((g) => g.querySelector('.taxonomy-group-name')?.textContent)).toEqual([
      'Acme Ltd',
      'Quiet Co',
    ])
    expect(groupNamed('Quiet Co').querySelector('.taxonomy-meta')).toHaveTextContent(
      '0 projects',
    )
  })

  it('hides a client’s projects when the client is archived (item 57)', async () => {
    // A project's visibility follows its client's. Leaving them behind put rows on the page
    // whose owner was missing, which is the one thing the tree is supposed to prevent.
    //
    // The project is not *archived* by this — 0005 A4 still holds, and it comes back whole.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Live work', clientId: client.id, now: T0 })
    await setArchived('client', client.id, true, T0)
    await show()

    expect(screen.queryByText('Acme Ltd')).toBeNull()
    expect(screen.queryByText('Live work')).toBeNull()

    // Not archived: the record is untouched, so showing archived brings both back.
    expect((await listProjects({ includeArchived: true }))[0]?.archived).toBe(false)

    await user.click(screen.getByLabelText('Show archived clients and projects'))
    expect(visibleRowFor('Live work')).toBeInTheDocument()
    expect(
      within(groupNamed('Acme Ltd')).getByRole('button', { name: 'Restore' }),
    ).toBeInTheDocument()
  })

  it('still shows projects that have no client, when a client is archived', async () => {
    // Internal work is nobody's to archive along with a client.
    await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Internal', now: T0 })
    const acme = await createClient({ name: 'Second Co', currency: 'GBP', now: T0 })
    await setArchived('client', acme.id, true, T0)
    await show()

    expect(screen.queryByText('Second Co')).toBeNull()
    expect(visibleRowFor('Internal')).toBeInTheDocument()
  })

  it('offers only the client form on the section heading', async () => {
    // A project is added from the list it joins, so the page-level project button would
    // have asked the user to state what its position already said (item 56).
    await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await show()

    await user.click(screen.getByTestId('new-client'))
    expect(screen.getByRole('button', { name: 'Add client' })).toBeInTheDocument()
    await user.click(screen.getByTestId('new-client'))
    expect(screen.queryByRole('button', { name: 'Add project' })).toBeNull()
  })

  it('opens one form at a time, whichever is asked for', async () => {
    // They sit in different parts of the section now, so both being open at once would leave
    // two half-finished records on screen with no obvious relationship between them.
    await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Existing', now: T0 })
    await show()

    await user.click(screen.getByTestId('new-client'))
    await addProjectTo('Acme Ltd')
    expect(screen.queryByRole('button', { name: 'Add client' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add project' })).toBeInTheDocument()

    await addProjectTo('Acme Ltd')
    await user.click(screen.getByTestId('new-client'))
    expect(screen.queryByRole('button', { name: 'Add project' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add client' })).toBeInTheDocument()
  })
})

describe('a new project from its client row (item 55)', () => {
  it('gives every client its own add button, named for that client', async () => {
    const acme = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createClient({ name: 'Other Co', currency: 'GBP', now: T0 })
    await show()

    // "New project" alone would be ambiguous with several of them on the page, so each is
    // named for the client it acts on.
    expect(addButtonFor('Acme Ltd')).toBeInTheDocument()
    expect(addButtonFor('Other Co')).toBeInTheDocument()

    // And the client is already chosen, because the button was under it.
    await addProjectTo('Acme Ltd')
    expect(screen.getByLabelText('Client')).toHaveValue(acme.id)
  })

  it('creates the project under that client, without the client being picked', async () => {
    const acme = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createClient({ name: 'Other Co', currency: 'GBP', now: T0 })
    await show()

    await addProjectTo('Acme Ltd')
    await user.type(screen.getByLabelText('Project name'), 'Intranet')
    await user.click(screen.getByRole('button', { name: 'Add project' }))

    await waitFor(async () => {
      expect(await listProjects()).toMatchObject([{ name: 'Intranet', clientId: acme.id }])
    })
  })

  it('opens the form on the client it was opened from, not at the top of the section', async () => {
    await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createClient({ name: 'Other Co', currency: 'GBP', now: T0 })
    await show()

    await addProjectTo('Acme Ltd')

    // The form belongs to the list that asked for it. At the top of the section it would
    // have appeared to come from nowhere.
    const form = formFor('Project name')
    const acme = [...document.querySelectorAll('.taxonomy-group')].find(
      (g) => g.querySelector('.taxonomy-group-name')?.textContent === 'Acme Ltd',
    )
    expect(acme?.contains(form)).toBe(true)
  })

  it('puts the add button under the last project, not on the client row', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Website', clientId: client.id, now: T0 })
    await createProject({ name: 'Intranet', clientId: client.id, now: T0 })
    await show()

    await addProjectTo('Acme Ltd')

    const add = screen.getByRole('button', { name: 'New project for Acme Ltd' })
    const rows = [...document.querySelectorAll('.taxonomy-list .taxonomy-row')]
    const lastRow = rows[rows.length - 1] as HTMLElement
    // Where the button is says which list the new project joins.
    expect(lastRow.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('hides the add button with the collapsed list it belongs to', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Website', clientId: client.id, now: T0 })
    await show()

    // Closed, the client row is the only thing on screen — so the button has to go with the
    // projects it adds to, or it would appear to add to nothing.
    expect(addButtonFor('Acme Ltd')).not.toBeVisible()
  })

  it('gives the orphan group an add button, which is how internal work is created', async () => {
    await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await show()

    await addInternalProject('Internal')

    await waitFor(async () => {
      expect(await listProjects()).toMatchObject([{ name: 'Internal', clientId: null }])
    })
  })
})

describe('what the tree does not show (items 57, 58, 59)', () => {
  it('shows no "No client" group when nothing belongs to one', async () => {
    // The absence of a client is not a record. An empty row named "No client" told the user
    // they had nothing under it — a fact about their data, with nothing to act on.
    await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await show()

    expect(screen.queryByText('No client')).toBeNull()
  })

  it('still shows one, with its label, when there is internal work', async () => {
    // Otherwise the projects would be unreachable, so the label is what explains them.
    await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await show()
    await addInternalProject('Internal')

    // Async: the group appears only once the write lands and the list re-reads.
    expect(
      await screen.findByText('No client', { selector: '.taxonomy-group-name' }),
    ).toBeInTheDocument()
  })

  it('offers no add-project button under an archived client', async () => {
    // Work is not being started for a client that has been finished with, and offering the
    // affordance invites it.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Website', clientId: client.id, now: T0 })
    await setArchived('client', client.id, true, T0)
    await show()
    await user.click(screen.getByLabelText('Show archived clients and projects'))

    expect(
      screen.getByText('Acme Ltd', { selector: '.taxonomy-group-name' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New project for Acme Ltd' })).toBeNull()
    // Editing and restoring the client itself are still offered.
    expect(
      within(groupNamed('Acme Ltd')).getByRole('button', { name: 'Restore' }),
    ).toBeInTheDocument()
  })

  it('keeps the "archived" badge outside the struck name, for clients and projects alike', async () => {
    // The strike is on the name element, and the badge is its sibling. `text-decoration`
    // propagates to descendants and cannot be undone by them, so a badge *inside* the struck
    // element would be struck too — striking the word that says the row is archived.
    // Whether it actually looks struck is checked in the browser suite.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    const project = await createProject({ name: 'Website', clientId: client.id, now: T0 })
    await setArchived('client', client.id, true, T0)
    await setArchived('project', project.id, true, T0)
    await show()
    await user.click(screen.getByLabelText('Show archived clients and projects'))

    // The `archived` class rides on the header row, not on the group wrapper.
    const group = groupNamed('Acme Ltd')
    expect(group.querySelector('.taxonomy-row')?.className).toContain('archived')
    expect(group.querySelector('.badge-archived')).not.toBeNull()
    expect(group.querySelector('.taxonomy-group-name .badge-archived')).toBeNull()

    const projectRow = visibleRowFor('Website')
    expect(projectRow.className).toContain('archived')
    expect(projectRow.querySelector('.taxonomy-name-text')).not.toBeNull()
    expect(projectRow.querySelector('.taxonomy-name-text .badge-archived')).toBeNull()
  })
})
