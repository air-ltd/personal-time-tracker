import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { EntryForm } from './EntryForm'
import { installTestDb } from '../../test/harness'
import { entry } from '../../test/factories'
import {
  createClient,
  createOrFindTag,
  createProject,
  deleteClient,
  listTags,
} from '../../storage/taxonomyRepo'
import { listEntries, putEntry } from '../../storage/entriesRepo'

/**
 * Taxonomy on the entry form (0005 T1–T2, P5, U1–U2, N2).
 *
 * The point of these is that a missing project or tag must not block capture. Someone
 * recording work at the end of a day should be able to type the project and the tag and
 * keep going, rather than being sent to settings first and losing the thought.
 */

const T0 = new Date('2026-10-13T09:00:00.000Z')
const END = '2026-10-13T10:30:00.000Z'

let user: UserEvent

beforeEach(() => {
  installTestDb()
  user = userEvent.setup()
})

/** Fill in the minimum a valid entry needs, then save. */
async function saveEntry(): Promise<void> {
  await user.clear(screen.getByLabelText('Duration'))
  await user.type(screen.getByLabelText('Duration'), '90')
  await user.click(screen.getByRole('button', { name: 'Add entry' }))
}

describe('project picker', () => {
  it('groups projects under the client they belong to (0005 N2)', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    await createProject({ name: 'Website', clientId: client.id, now: T0 })
    await createProject({ name: 'Internal', now: T0 })

    render(<EntryForm now={T0} />)

    // Both types appear in one control, so the client is spelled out in a group heading.
    // Waiting on an option rather than the select: the picker is disabled until the
    // taxonomy has loaded, so the field existing is not the same as it being usable.
    expect(await screen.findByRole('group', { name: 'Acme Ltd' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'No client' })).toBeInTheDocument()
  })

  it('offers uncategorised as a named state rather than an empty selection (0005 U1)', async () => {
    render(<EntryForm now={T0} />)

    expect(await screen.findByRole('option', { name: /uncategorised/i })).toBeInTheDocument()
  })

  it('saves the chosen project', async () => {
    const project = await createProject({ name: 'Website', now: T0 })
    render(<EntryForm now={T0} />)

    await screen.findByRole('option', { name: 'Website' })
    await user.selectOptions(screen.getByLabelText('Project'), project.id)
    await saveEntry()

    await waitFor(async () => {
      expect((await listEntries())[0]?.projectId).toBe(project.id)
    })
  })

  it('saves an uncategorised entry', async () => {
    render(<EntryForm now={T0} />)
    await screen.findByLabelText('Project')

    await saveEntry()

    await waitFor(async () => {
      expect((await listEntries())[0]?.projectId).toBeNull()
    })
  })

  it('still offers a project whose client has been deleted (0005 X4)', async () => {
    // X4 keeps the projects and drops the client, so an entry filed under one of them has
    // to stay editable afterwards.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    const project = await createProject({ name: 'Website', clientId: client.id, now: T0 })
    await deleteClient(client.id, T0)

    const stored = await putEntry(entry({ projectId: project.id, end: new Date(END) }))
    render(<EntryForm now={new Date(END)} entry={stored} />)

    // The orphaned project is selectable rather than silently dropped from the picker,
    // which would make the entry impossible to re-save.
    expect(await screen.findByRole('option', { name: 'Website' })).toBeInTheDocument()
  })
})

describe('billable (0005 P5)', () => {
  it('starts billable when the project has a default rate', async () => {
    const project = await createProject({ name: 'Website', defaultRateMinor: 7_500, now: T0 })
    render(<EntryForm now={T0} />)

    await screen.findByRole('option', { name: 'Website' })
    await user.selectOptions(screen.getByLabelText('Project'), project.id)

    expect(await screen.findByLabelText('Billable')).toBeChecked()
  })

  it('starts unbillable when the project has no rate', async () => {
    const project = await createProject({ name: 'Internal', now: T0 })
    render(<EntryForm now={T0} />)

    await screen.findByRole('option', { name: 'Internal' })
    await user.selectOptions(screen.getByLabelText('Project'), project.id)

    expect(await screen.findByLabelText('Billable')).not.toBeChecked()
  })

  it('can be unticked on a rated project', async () => {
    // P5 is a default, not a lock: a rated project can still carry unbillable work.
    const project = await createProject({ name: 'Website', defaultRateMinor: 7_500, now: T0 })
    render(<EntryForm now={T0} />)

    await screen.findByRole('option', { name: 'Website' })
    await user.selectOptions(screen.getByLabelText('Project'), project.id)
    await user.click(await screen.findByLabelText('Billable'))
    await saveEntry()

    await waitFor(async () => {
      expect((await listEntries())[0]?.billable).toBe(false)
    })
  })

  it('reports the rate a project resolves to, and where it came from', async () => {
    const client = await createClient({
      name: 'Acme Ltd',
      currency: 'GBP',
      defaultRateMinor: 7_500,
      now: T0,
    })
    const project = await createProject({ name: 'Website', clientId: client.id, now: T0 })
    render(<EntryForm now={T0} />)

    await screen.findByRole('option', { name: 'Website' })
    await user.selectOptions(screen.getByLabelText('Project'), project.id)

    // The rate is not on the project, so the hint has to say it came from the client.
    expect(await screen.findByTestId('billing-hint')).toHaveTextContent(
      /75\.00.*Acme Ltd’s rate/,
    )
  })

  it('says so when nothing sets a rate, rather than implying the work is unbilled by default', async () => {
    const project = await createProject({ name: 'Internal', now: T0 })
    render(<EntryForm now={T0} />)

    await screen.findByRole('option', { name: 'Internal' })
    await user.selectOptions(screen.getByLabelText('Project'), project.id)

    expect(await screen.findByTestId('billing-hint')).toHaveTextContent(/No rate set/)
  })

  it('leaves an existing entry’s billable state alone when editing', async () => {
    const project = await createProject({ name: 'Website', defaultRateMinor: 7_500, now: T0 })
    const stored = await putEntry(
      entry({ projectId: project.id, billable: false, end: new Date(END) }),
    )

    render(<EntryForm now={new Date(END)} entry={stored} />)

    // P5 applies to new entries; it must not quietly rewrite what was already recorded.
    expect(await screen.findByLabelText('Billable')).not.toBeChecked()
  })
})

describe('tags (0005 T1–T2)', () => {
  it('creates a tag by typing it', async () => {
    render(<EntryForm now={T0} />)
    await screen.findByLabelText('Tags')

    await user.type(screen.getByLabelText('Tags'), 'research{Enter}')
    await saveEntry()

    await waitFor(async () => {
      expect((await listEntries())[0]?.tagIds).toHaveLength(1)
    })
    expect((await listTags()).map((tag) => tag.name)).toEqual(['research'])
  })

  it('selects the existing tag when the name only differs in case (0005 T2)', async () => {
    const { tag } = await createOrFindTag({ name: 'research', now: T0 })
    render(<EntryForm now={T0} />)
    await screen.findByLabelText('Tags')

    await user.type(screen.getByLabelText('Tags'), 'Research{Enter}')
    await saveEntry()

    await waitFor(async () => {
      expect((await listEntries())[0]?.tagIds).toEqual([tag.id])
    })
    expect(await listTags()).toHaveLength(1)
  })

  it('adds several tags', async () => {
    render(<EntryForm now={T0} />)
    await screen.findByLabelText('Tags')

    const field = screen.getByLabelText('Tags')
    await user.type(field, 'research{Enter}review{Enter}')

    await waitFor(() => {
      expect(
        within(screen.getByTestId('entry-tag-chips')).getAllByRole('listitem'),
      ).toHaveLength(2)
    })
  })

  it('treats a comma as a separator too', async () => {
    // Comma is the habit from every other tagging field; Enter is the habit from chips.
    render(<EntryForm now={T0} />)
    await screen.findByLabelText('Tags')

    await user.type(screen.getByLabelText('Tags'), 'research,review{Enter}')

    await waitFor(() => {
      expect(
        within(screen.getByTestId('entry-tag-chips')).getAllByRole('listitem'),
      ).toHaveLength(2)
    })
  })

  it('does not split a tag name on a space', async () => {
    // "code review" is one tag, not two — which is why space is not a separator here.
    render(<EntryForm now={T0} />)
    await screen.findByLabelText('Tags')

    await user.type(screen.getByLabelText('Tags'), 'code review{Enter}')
    await saveEntry()

    await waitFor(async () => {
      expect((await listTags()).map((tag) => tag.name)).toEqual(['code review'])
    })
  })

  it('removes a tag again', async () => {
    render(<EntryForm now={T0} />)
    await screen.findByLabelText('Tags')

    await user.type(screen.getByLabelText('Tags'), 'research{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Remove tag research' }))

    expect(screen.queryByTestId('entry-tag-chips')).toBeNull()
  })

  it('keeps an empty name from creating anything', async () => {
    render(<EntryForm now={T0} />)
    await screen.findByLabelText('Tags')

    await user.type(screen.getByLabelText('Tags'), '   {Enter}')

    expect(await listTags()).toHaveLength(0)
  })

  it('shows the taxonomy already on the entry', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    const project = await createProject({ name: 'Website', clientId: client.id, now: T0 })
    const { tag } = await createOrFindTag({ name: 'research', now: T0 })
    const stored = await putEntry(
      entry({
        projectId: project.id,
        tagIds: [tag.id],
        billable: true,
        end: new Date(END),
      }),
    )

    render(<EntryForm now={new Date(END)} entry={stored} />)

    expect(await screen.findByRole('option', { name: 'Website' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Billable')).toBeChecked()
    expect(
      within(await screen.findByTestId('entry-tag-chips')).getByText('research'),
    ).toBeVisible()
  })

  it('updates the taxonomy on save', async () => {
    const stored = await putEntry(entry({ end: new Date(END) }))
    const project = await createProject({ name: 'Website', now: T0 })

    render(<EntryForm now={new Date(END)} entry={stored} />)
    await screen.findByRole('option', { name: 'Website' })
    await user.selectOptions(screen.getByLabelText('Project'), project.id)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(async () => {
      expect((await listEntries())[0]?.projectId).toBe(project.id)
    })
  })
})
