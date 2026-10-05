import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { EntryForm } from './EntryForm'
import { installTestDb } from '../../test/harness'
import { entry } from '../../test/factories'
import {
  createClient,
  createOrFindTag,
  createProject,
  listTags,
  setArchived,
} from '../../storage/taxonomyRepo'
import { getEntry, listEntries, putEntry } from '../../storage/entriesRepo'
import type { TimeEntry } from '../../domain/entries/types'
import { writeDefaultCurrency } from '../../storage/settingsRepo'

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

  it('still offers a project whose client has been archived (0005 X5)', async () => {
    // A client cannot be deleted (0005 X1), but archiving it must not make an entry
    // impossible to re-save: the project is still the entry's own value, and dropping it
    // from the picker would leave the `<select>` holding a value with no option.
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: T0 })
    const project = await createProject({ name: 'Website', clientId: client.id, now: T0 })
    await setArchived('client', client.id, true, T0)

    const stored = await putEntry(entry({ projectId: project.id, end: new Date(END) }))
    render(<EntryForm now={new Date(END)} entry={stored} />)

    expect(await screen.findByRole('option', { name: 'Website' })).toBeInTheDocument()
    // And the client is named as its group, so the entry is not mislabelled as having no
    // client — which would misreport where the time went.
    expect(screen.getByRole('group', { name: 'Acme Ltd' })).toBeInTheDocument()
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

describe('duration in seconds (item 30)', () => {
  it('shows a short entry’s seconds rather than rounding it away', async () => {
    // A stopped timer is very often under a minute. The field used to show "00:00" for it,
    // so saving the form without noticing wrote an entry of no length.
    const start = new Date('2026-10-13T09:00:00.000Z')
    const stored = await putEntry(entry({ start, end: new Date(start.getTime() + 25_000) }))

    render(<EntryForm now={new Date('2026-10-13T10:00:00.000Z')} entry={stored} />)

    expect(await screen.findByLabelText('Duration')).toHaveValue('00:00:25')
  })

  it('keeps a whole-minute entry in the shorter form', async () => {
    const start = new Date('2026-10-13T09:00:00.000Z')
    const stored = await putEntry(
      entry({ start, end: new Date(start.getTime() + 90 * 60_000) }),
    )

    render(<EntryForm now={new Date('2026-10-13T11:00:00.000Z')} entry={stored} />)

    expect(await screen.findByLabelText('Duration')).toHaveValue('01:30')
  })

  it('saves a short entry without changing its length', async () => {
    const start = new Date('2026-10-13T09:00:00.000Z')
    const stored = await putEntry(entry({ start, end: new Date(start.getTime() + 25_000) }))

    render(<EntryForm now={new Date('2026-10-13T10:00:00.000Z')} entry={stored} />)
    await user.click(await screen.findByRole('button', { name: 'Save changes' }))

    await waitFor(async () => {
      const saved = await getEntry(stored.id)
      expect(Date.parse(saved?.end ?? '')).toBe(start.getTime() + 25_000)
    })
  })
})

/**
 * Editing a running entry (0004 ED1, ED2).
 *
 * ED1 says every entry is editable after creation, "including a running one"; ED2 says
 * editing `end` on a running entry stops it. Both can only be true together if saving
 * without stating an end leaves it running.
 *
 * They were not: the duration and end fields both started empty for a running entry, so
 * submitting produced "Enter how long this took" — and the only way to fix a typo in the
 * note of a running entry was to also state a duration, which stopped the timer as a
 * side effect. The user opened the pencil to correct a word and was told their note was
 * invalid.
 */
describe('editing a running entry (0004 ED1, ED2)', () => {
  const START = new Date('2026-10-13T09:00:00.000Z')
  const LATER = new Date('2026-10-13T10:30:00.000Z')

  async function running(): Promise<TimeEntry> {
    return putEntry(entry({ start: START, end: null, note: 'Fixme', source: 'timer' }))
  }

  it('saves a corrected note without stopping the timer', async () => {
    const stored = await running()

    render(<EntryForm now={LATER} entry={stored} />)
    const note = await screen.findByLabelText('Note')
    await user.clear(note)
    await user.type(note, 'Fixed')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(async () => {
      const saved = await getEntry(stored.id)
      expect(saved?.note).toBe('Fixed')
      // The whole point: editing something other than the end does not end it.
      expect(saved?.end).toBeNull()
    })
  })

  it('says the entry is still running, so a blank duration is not a mystery', async () => {
    const stored = await running()

    render(<EntryForm now={LATER} entry={stored} />)

    // 90 minutes from the start to `now`. Stating what would be saved is what makes the
    // blank field a decision rather than an oversight.
    expect(await screen.findByTestId('running-preview')).toHaveTextContent(/1h 30m/)
  })

  it('still validates the parts that do apply', async () => {
    // A running entry skips the duration rules because its length is the clock's doing,
    // but a future start is the user's own error and must still block the save.
    const stored = await putEntry(
      entry({ start: new Date('2026-10-13T12:00:00.000Z'), end: null, source: 'timer' }),
    )

    render(<EntryForm now={LATER} entry={stored} />)
    await user.click(await screen.findByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Start is in the future.')).toBeInTheDocument()
  })

  it('stops the entry when a duration is stated (0004 ED2)', async () => {
    const stored = await running()

    render(<EntryForm now={LATER} entry={stored} />)
    await user.type(await screen.findByLabelText('Duration'), '30')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(async () => {
      const saved = await getEntry(stored.id)
      expect(Date.parse(saved?.end ?? '')).toBe(START.getTime() + 30 * 60_000)
    })
  })

  it('stops the entry when an end time is stated instead', async () => {
    const stored = await running()

    render(<EntryForm now={LATER} entry={stored} />)
    await user.click(await screen.findByRole('radio', { name: 'Enter an end time' }))
    // `user.type` is unreliable on a datetime-local input — it types characters rather
    // than filling segments — so the value is set the way a browser would.
    //
    // Local time, not the UTC the fixture is written in: 09:00Z is 10:00 in Europe/London
    // on this date, and an end equal to the start is rejected by 0004 V1 rather than
    // saved as a zero-length entry.
    fireEvent.change(await screen.findByLabelText('End'), {
      target: { value: '2026-10-13T11:00' },
    })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(async () => {
      const saved = await getEntry(stored.id)
      expect(saved?.end).not.toBeNull()
    })
  })

  it('does not let a new manual entry be left open-ended', async () => {
    // 0003 E4 allows exactly one open-ended row, and 0004 M4 reserves it for the timer.
    // The "leave it running" path must therefore be unreachable from the new-entry form.
    render(<EntryForm now={LATER} />)
    await user.click(await screen.findByRole('button', { name: 'Add entry' }))

    expect(await screen.findByText('Enter how long this took.')).toBeInTheDocument()
  })
})

/**
 * The billing preview, and the resolution chain behind it (0003 currency resolution).
 *
 * The hint used to resolve currency inline and ended at a hardcoded `USD`, ignoring the
 * app-wide default the user had chosen in Settings one screen away — so a rate stored in
 * yen was previewed in dollars, and in another form in pounds. The chain is now
 * `resolveCurrency`, and these pin the three links that were once independent copies.
 */
/**
 * A tag typed and then saved (0005 T1, T2).
 *
 * The tag field commits on blur, and pressing Save is a blur. The blur handler was
 * fire-and-forget, so the entry was written before the tag existed: the tag arrived in the
 * taxonomy attached to nothing, and nothing told the user. A silent loss, plus an orphan.
 *
 * Two things had to be true for the fix, and only fixing one of them changes nothing:
 * the save has to *await* the commit, and it has to use the selection the commit produced —
 * `onChange` schedules a state update, so the form's own `tagIds` is still the old value in
 * the closure that is about to write.
 */
describe('a tag typed and then saved', () => {
  async function typeTagThenSave(user: UserEvent): Promise<void> {
    render(<EntryForm now={new Date('2026-10-13T11:00:00.000Z')} />)
    await user.type(await screen.findByLabelText('Duration'), '90')
    // The name is typed and *not* committed with a separator, so the only thing that can
    // commit it is losing focus — which is what pressing Save does.
    await user.type(await screen.findByLabelText('Tags'), 'research')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))
  }

  it('attaches the tag to the entry', async () => {
    await typeTagThenSave(user)

    await waitFor(async () => {
      const saved = await listEntries()
      expect(saved).toHaveLength(1)
      expect(saved[0]?.tagIds).toHaveLength(1)
    })
    const tag = (await listTags())[0]
    expect((await listEntries())[0]?.tagIds).toEqual([tag?.id])
    // And not left orphaned.
    expect(tag?.name).toBe('research')
  })

  it('leaves no tag behind unattached', async () => {
    await typeTagThenSave(user)

    await waitFor(async () => {
      expect(await listEntries()).toHaveLength(1)
    })
    const entries = await listEntries()
    const tags = await listTags()
    // Every tag the user created is on the entry they created it for.
    expect(tags.map((tag) => tag.id).sort()).toEqual([...(entries[0]?.tagIds ?? [])].sort())
  })
})

describe('the billing preview resolves currency through the whole chain', () => {
  /** Render the form, pick the project named `name`, and return the billing hint. */
  async function previewFor(name: string): Promise<HTMLElement> {
    render(<EntryForm now={T0} />)
    const picker = await screen.findByLabelText('Project')
    const option = await screen.findByRole('option', { name })
    await user.selectOptions(picker, option)
    return await screen.findByTestId('billing-hint')
  }

  it("uses the project's own currency", async () => {
    const client = await createClient({ name: 'Acme', currency: 'GBP', now: T0 })
    await createProject({
      name: 'Website',
      clientId: client.id,
      currency: 'JPY',
      defaultRateMinor: 10_000,
      now: T0,
    })

    // Yen, not the client's pounds: 0005 P6 — a project overriding its client is the
    // case that is invisible without being tested.
    expect(await previewFor('Website')).toHaveTextContent(/10,000/)
  })

  it("falls back to the client's currency when the project has none", async () => {
    await writeDefaultCurrency('JPY')
    const client = await createClient({ name: 'Acme', currency: 'GBP', now: T0 })
    await createProject({
      name: 'Website',
      clientId: client.id,
      defaultRateMinor: 10_000,
      now: T0,
    })

    expect(await previewFor('Website')).toHaveTextContent(/£/)
  })

  it('falls back to the app-wide default when neither project nor client says', async () => {
    // The link that was missing entirely: the setting exists, is configurable, and was
    // ignored by the entry form and by the project form. A client-less project is the
    // only way to reach it — a client always carries a currency of its own.
    await writeDefaultCurrency('JPY')
    await createProject({ name: 'Website', clientId: null, defaultRateMinor: 5_000, now: T0 })

    // 5,000 minor units of yen is ¥5,000; in dollars it would read $50.00, which is what
    // the hardcoded fallback produced for a user who had chosen yen.
    expect(await previewFor('Website')).toHaveTextContent(/5,000/)
  })

  it('uses the documented last resort when nothing is configured anywhere', async () => {
    // No app default, no client, no project currency: `resolveCurrency` must still
    // produce a currency rather than leaving the preview with none to format with.
    await createProject({ name: 'Website', clientId: null, defaultRateMinor: 12_500, now: T0 })

    expect(await previewFor('Website')).toHaveTextContent(/\$125\.00/)
  })
})
