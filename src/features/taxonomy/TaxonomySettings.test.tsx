import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { TaxonomySettings } from './TaxonomySettings'
import { installTestDb } from '../../test/harness'
import { entry } from '../../test/factories'
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
import { readDefaultCurrency, writeDefaultCurrency } from '../../storage/settingsRepo'
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
const LATER = new Date('2026-10-13T18:00:00.000Z')

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
function rowFor(name: string): HTMLElement {
  const label = screen.getByText(name, { selector: '.taxonomy-name' })
  const row = label.closest('li')
  if (!row) throw new Error(`"${name}" is not inside a taxonomy row`)
  return row
}

function rowButton(name: string, label: string): HTMLElement {
  return within(rowFor(name)).getByRole('button', { name: label })
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

    expect(screen.getByText(/Client: Acme Ltd/)).toBeInTheDocument()
    expect(screen.getByText(/£12.00\/hour/)).toBeInTheDocument()
  })
})

describe('the two archived toggles', () => {
  it('shows archived clients and archived projects independently', async () => {
    // One flag drove both controls, so ticking "Show archived clients" also revealed
    // archived projects — two checkboxes bound to one value, each reporting the other's
    // state. Each label has to show exactly what it names.
    const live = await createClient({ name: 'Live Co', currency: 'GBP', now: T0 })
    const gone = await createClient({ name: 'Gone Co', currency: 'GBP', now: T0 })
    await setArchived('client', gone.id, true, T0)
    await createProject({ name: 'Current', clientId: live.id, now: T0 })
    const retired = await createProject({ name: 'Retired', clientId: live.id, now: T0 })
    await setArchived('project', retired.id, true, T0)
    await show()

    expect(screen.queryByText('Gone Co')).toBeNull()
    expect(screen.queryByText('Retired')).toBeNull()

    await user.click(screen.getByLabelText('Show archived clients'))

    // The client toggle moves the clients and nothing else.
    expect(screen.getByText('Gone Co')).toBeInTheDocument()
    expect(screen.queryByText('Retired')).toBeNull()

    await user.click(screen.getByLabelText('Show archived projects'))
    expect(screen.getByText('Retired')).toBeInTheDocument()
  })
})

describe('giving each new project its own colour', () => {
  it('does not reuse the colour of the project just created', async () => {
    // It used to: the form reset the name, rate and currency but not the colour, so the
    // second project opened as the first project's colour and a chart needed its legend
    // decoded — the thing the palette exists to prevent.
    const user = userEvent.setup()
    await show()
    await user.click(screen.getByTestId('new-project'))

    let form = formFor('Project name')
    await user.type(within(form).getByLabelText('Project name'), 'Widget')
    await user.click(within(form).getByRole('button', { name: 'Add project' }))
    await waitFor(() => expect(rowFor('Widget')).toBeDefined())

    await user.click(screen.getByTestId('new-project'))
    form = formFor('Project name')
    await user.type(within(form).getByLabelText('Project name'), 'Gadget')
    await user.click(within(form).getByRole('button', { name: 'Add project' }))
    await waitFor(() => expect(rowFor('Gadget')).toBeDefined())

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
    expect(await screen.findByText('Acme Ltd')).toBeInTheDocument()
  })

  it('lists a created project and reports its client by name', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Website', clientId: client.id, now: T0 })
    await show()

    // 0005 N2: project and client are told apart by grouping and labelling, never by
    // colour alone.
    expect(within(rowFor('Website')).getByText('Client: Acme Ltd')).toBeInTheDocument()
  })

  it('says so when a project has no client, rather than showing nothing', async () => {
    await createProject({ name: 'Internal', now: T0 })
    await show()

    // 0005 U1: uncategorised is a legitimate visible state, so it is named.
    expect(within(rowFor('Internal')).getByText('No client')).toBeInTheDocument()
  })

  it('refuses a duplicate project name and reports why', async () => {
    await createProject({ name: 'Acme', now: T0 })
    await show()
    await user.click(screen.getByTestId('new-project'))

    const form = formFor('Project name')
    await user.type(within(form).getByLabelText('Project name'), 'acme')
    await user.click(within(form).getByRole('button', { name: 'Add project' }))

    expect(await screen.findByTestId('settings-error')).toHaveTextContent(/already exists/)
    expect(await listProjects()).toHaveLength(1)
  })

  it('creates a project with no client', async () => {
    await show()
    await user.click(screen.getByTestId('new-project'))

    const form = formFor('Project name')
    await user.type(within(form).getByLabelText('Project name'), 'Internal')
    await user.click(within(form).getByRole('button', { name: 'Add project' }))

    await waitFor(async () => {
      expect(await listProjects()).toMatchObject([{ name: 'Internal', clientId: null }])
    })
  })

  it('stores the app default currency (0003 CU4)', async () => {
    await show()
    await user.selectOptions(screen.getByLabelText('Currency for work with no client'), 'JPY')

    await waitFor(async () => {
      expect(await readDefaultCurrency()).toBe('JPY')
    })
  })
})

describe('deleting a project (0005 X1–X3, 0003 F3)', () => {
  async function projectWithEntries(count: number, billable = false) {
    const project = await createProject({ name: 'Acme', now: T0 })
    const ids: string[] = []
    for (let i = 0; i < count; i += 1) {
      const stored = await putEntry(
        entry({
          projectId: project.id,
          billable,
          start: new Date(`2026-10-13T0${i}:00:00.000Z`),
          end: new Date(`2026-10-13T0${i}:30:00.000Z`),
        }),
      )
      ids.push(stored.id)
    }
    return { project, ids }
  }

  it('states the affected entry count before confirming', async () => {
    // 0005 X1: the count has to be visible before the user commits, not after.
    await projectWithEntries(3)
    await show()
    await user.click(rowButton('Acme', 'Delete'))

    expect(await screen.findByTestId('delete-impact')).toHaveTextContent(
      '3 entries use this project.',
    )
  })

  it('agrees in number when exactly one entry is affected', async () => {
    // "1 entry use this project" is the kind of thing that ships and reads as broken.
    await projectWithEntries(1)
    await show()
    await user.click(rowButton('Acme', 'Delete'))

    expect(await screen.findByTestId('delete-impact')).toHaveTextContent(
      '1 entry uses this project.',
    )
  })

  it('says plainly that entries are kept and lose their project (0005 X2)', async () => {
    await projectWithEntries(2)
    await show()
    await user.click(rowButton('Acme', 'Delete'))

    expect(await screen.findByTestId('delete-confirm-project')).toHaveTextContent(
      /entries are kept.*lose their project/i,
    )
  })

  it('asks for a second confirmation when billable time is involved (0005 X3)', async () => {
    await projectWithEntries(2, true)
    await show()
    await user.click(rowButton('Acme', 'Delete'))

    expect(await screen.findByTestId('delete-impact')).toHaveTextContent(/2 are billable/)
    // The first click must not have deleted anything yet.
    expect(await listProjects()).toHaveLength(1)

    await user.click(await screen.findByTestId('delete-confirm-accept'))
    await screen.findByTestId('delete-confirm-strong')
    expect(await listProjects()).toHaveLength(1)

    await user.click(screen.getByTestId('delete-confirm-strong'))
    await waitFor(async () => {
      expect(await listProjects()).toHaveLength(0)
    })
  })

  it('does not ask twice when nothing billable is involved', async () => {
    await projectWithEntries(1, false)
    await show()
    await user.click(rowButton('Acme', 'Delete'))

    expect(await screen.findByTestId('delete-confirm-accept')).toBeInTheDocument()
    expect(screen.queryByTestId('delete-confirm-strong')).toBeNull()

    await user.click(screen.getByTestId('delete-confirm-accept'))
    await waitFor(async () => {
      expect(await listProjects()).toHaveLength(0)
    })
  })

  it('leaves the entries intact and uncategorised', async () => {
    // 0005 X1 / 0003 F3: the single most destructive thing the app does.
    const { ids } = await projectWithEntries(2)
    await show()
    await user.click(rowButton('Acme', 'Delete'))
    await user.click(await screen.findByTestId('delete-confirm-accept'))

    await waitFor(async () => {
      expect(await listProjects()).toHaveLength(0)
    })
    for (const id of ids) {
      const stored = await getEntry(id)
      expect(stored?.projectId).toBeNull()
      expect(stored?.deletedAt).toBeNull()
    }
  })

  it('offers undo, which puts the project and its entries back', async () => {
    const { project, ids } = await projectWithEntries(2)
    await show()
    await user.click(rowButton('Acme', 'Delete'))
    await user.click(await screen.findByTestId('delete-confirm-accept'))

    expect(await screen.findByTestId('undo-bar')).toHaveTextContent(
      /2 entries are now uncategorised/,
    )

    await user.click(
      within(screen.getByTestId('undo-bar')).getByRole('button', { name: 'Undo' }),
    )

    await waitFor(async () => {
      expect(await listProjects()).toMatchObject([{ name: 'Acme' }])
    })
    for (const id of ids) expect((await getEntry(id))?.projectId).toBe(project.id)
    expect(screen.queryByTestId('undo-bar')).toBeNull()
  })

  it('reports an undo that cannot work instead of failing silently', async () => {
    await projectWithEntries(0)
    await show()
    await user.click(rowButton('Acme', 'Delete'))
    await user.click(await screen.findByTestId('delete-confirm-accept'))
    // Take the name in the meantime, which is the one way a restore can legitimately fail.
    await createProject({ name: 'Acme', now: LATER })

    const undoBar = await screen.findByTestId('undo-bar')
    await user.click(within(undoBar).getByRole('button', { name: 'Undo' }))

    expect(await screen.findByTestId('settings-error')).toHaveTextContent(/cannot restore/i)
  })

  it('cancels without deleting', async () => {
    await createProject({ name: 'Acme', now: T0 })
    await show()
    await user.click(rowButton('Acme', 'Delete'))
    await user.click(
      within(await screen.findByTestId('delete-confirm-project')).getByRole('button', {
        name: 'Cancel',
      }),
    )

    await waitFor(() => {
      expect(screen.queryByTestId('delete-confirm-project')).toBeNull()
    })
    expect(await listProjects()).toHaveLength(1)
  })
})

describe('deleting a client (0005 X4)', () => {
  it('warns with the affected project count and keeps the projects', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'One', clientId: client.id, now: T0 })
    await createProject({ name: 'Two', clientId: client.id, now: T0 })
    await show()
    await user.click(rowButton('Acme Ltd', 'Delete'))

    expect(await screen.findByTestId('delete-impact')).toHaveTextContent(
      '2 projects belong to this client.',
    )
    expect(screen.getByTestId('delete-confirm-client')).toHaveTextContent(/projects are kept/i)

    await user.click(screen.getByTestId('delete-confirm-accept'))
    await waitFor(async () => {
      expect(await listClients()).toHaveLength(0)
    })
    // X4: projects survive with no client.
    expect((await listProjects()).map((p) => p.clientId)).toEqual([null, null])
  })
})

describe('archiving (0005 A1–A5)', () => {
  it('hides an archived project by default', async () => {
    const project = await createProject({ name: 'Old', now: T0 })
    await setArchived('project', project.id, true, T0)
    await show()

    expect(screen.queryByText('Old', { selector: '.taxonomy-name' })).toBeNull()
    expect(screen.getByText('1 project is hidden.')).toBeInTheDocument()
  })

  it('shows it when asked, so historical entries stay editable (0005 A2)', async () => {
    const project = await createProject({ name: 'Old', now: T0 })
    await setArchived('project', project.id, true, T0)
    await show()

    await user.click(screen.getByLabelText('Show archived projects'))

    expect(await screen.findByText('Old', { selector: '.taxonomy-name' })).toBeInTheDocument()
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
    await user.click(screen.getByLabelText('Show archived projects'))

    await user.click(await screen.findByRole('button', { name: 'Restore' }))

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

    await user.click(rowButton('research', 'Merge…'))
    const merge = await screen.findByTestId('tag-merge')
    await user.selectOptions(within(merge).getByLabelText(/into$/), review.id)
    await user.click(within(merge).getByRole('button', { name: 'Merge tags' }))

    await waitFor(() => {
      expect(screen.queryByText('research', { selector: '.taxonomy-name' })).toBeNull()
    })
    expect(research.name).toBe('research')
  })

  it('merges one tag into another (0005 T4)', async () => {
    const { tag: research } = await createOrFindTag({ name: 'research', now: T0 })
    const { tag: review } = await createOrFindTag({ name: 'review', now: T0 })
    const stored = await putEntry(entry({ tagIds: [research.id, review.id] }))
    await show()

    await user.click(rowButton('research', 'Merge…'))
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

    await user.click(rowButton('research', 'Merge…'))
    const merge = await screen.findByTestId('tag-merge')

    expect(within(merge).getByLabelText(/into$/).textContent).toBe('Choose a tagreview')
    expect(await listTags()).toHaveLength(2)
  })

  it('reports how many entries a tag deletion would affect (0005 T3)', async () => {
    const { tag } = await createOrFindTag({ name: 'research', now: T0 })
    await putEntry(entry({ tagIds: [tag.id] }))
    await show()
    await user.click(rowButton('research', 'Delete'))

    expect(await screen.findByTestId('delete-impact')).toHaveTextContent(
      '1 entry carries this tag.',
    )
  })
})

describe('colour choice (0005 P3–P4)', () => {
  it('offers the accessible palette rather than a free colour wheel', async () => {
    await createProject({ name: 'Acme', now: T0 })
    await show()
    await user.click(rowButton('Acme', 'Edit'))

    const picker = await screen.findByRole('radiogroup', { name: 'Project colour' })
    // Twelve palette entries plus the custom option.
    expect(within(picker).getAllByRole('radio')).toHaveLength(13)
    // Each swatch names itself, so the choice is not colour alone (0005 N2).
    expect(within(picker).getByRole('radio', { name: 'Project colour: #2e6aae' })).toBeChecked()
  })

  it('measures contrast for a colour typed by hand', async () => {
    await createProject({ name: 'Acme', now: T0 })
    await show()
    await user.click(rowButton('Acme', 'Edit'))

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

    await user.click(rowButton('Acme Ltd', 'Edit'))

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
