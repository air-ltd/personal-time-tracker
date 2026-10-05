import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EntryList } from './EntryList'
import { installTestDb } from '../../test/harness'
import { entry } from '../../test/factories'
import {
  createClient,
  createOrFindTag,
  createProject,
  setArchived,
} from '../../storage/taxonomyRepo'
import { putEntry } from '../../storage/entriesRepo'
import * as entriesRepo from '../../storage/entriesRepo'

/**
 * Taxonomy on an entry row (0005 U1–U2, N2, A1, T3).
 *
 * The list has to resolve ids to names, which means it can be handed an id that no longer
 * names anything. Each of those cases is covered here, because the failure is not an error
 * — it is a blank space where a project should be, which reads as "nothing was recorded"
 * when in fact work was.
 */

const NOW = new Date('2026-10-13T18:00:00.000Z')

beforeEach(() => {
  installTestDb()
})

describe('entry rows', () => {
  it('names the project and the client it belongs to (0005 N2)', async () => {
    const client = await createClient({ name: 'Acme Ltd', currency: 'GBP', now: NOW })
    const project = await createProject({ name: 'Website', clientId: client.id, now: NOW })
    await putEntry(entry({ projectId: project.id, end: new Date('2026-10-13T10:30:00.000Z') }))

    render(<EntryList now={NOW} />)

    const row = await screen.findByText('Website')
    expect(row).toBeVisible()
    // Both types are on screen together, so the client is named rather than implied.
    expect(within(row.parentElement as HTMLElement).getByText(/Acme Ltd/)).toBeVisible()
  })

  it('labels an entry with no project rather than showing nothing (0005 U1)', async () => {
    await putEntry(entry({ end: new Date('2026-10-13T10:30:00.000Z') }))

    render(<EntryList now={NOW} />)

    expect(await screen.findByText('Uncategorised')).toBeVisible()
  })

  it('still names a project that has been archived (0005 A1)', async () => {
    // Archiving hides a project from pickers, but the entries that used it are history and
    // must keep reading as what they were.
    const project = await createProject({ name: 'Old', now: NOW })
    const stored = await putEntry(
      entry({ projectId: project.id, end: new Date('2026-10-13T10:30:00.000Z') }),
    )
    await setArchived('project', project.id, true, NOW)

    render(<EntryList now={NOW} />)

    expect(await screen.findByText('Old')).toBeVisible()
    expect(
      within(screen.getByText('Old').parentElement as HTMLElement).getByText('archived'),
    ).toBeVisible()
    expect(stored.projectId).toBe(project.id)
  })

  it('does not crash on an id it cannot resolve', async () => {
    // Reachable through replication, where an entry can arrive before its project.
    await putEntry(
      entry({
        projectId: '00000000-0000-4000-8000-000000000000',
        tagIds: ['00000000-0000-4000-8000-000000000001'],
        end: new Date('2026-10-13T10:30:00.000Z'),
      }),
    )

    render(<EntryList now={NOW} />)

    // Unresolved is presented as uncategorised rather than rendering an empty gap or
    // throwing and taking every other row with it.
    expect(await screen.findByText('Uncategorised')).toBeVisible()
  })

  it('shows tags with their names (0005 N2)', async () => {
    const { tag } = await createOrFindTag({ name: 'research', now: NOW })
    const stored = await putEntry(
      entry({ tagIds: [tag.id], end: new Date('2026-10-13T10:30:00.000Z') }),
    )

    render(<EntryList now={NOW} />)

    expect(await screen.findByTestId(`tags-${stored.id}`)).toHaveTextContent('research')
  })

  it('marks billable entries', async () => {
    const stored = await putEntry(
      entry({ billable: true, end: new Date('2026-10-13T10:30:00.000Z') }),
    )

    render(<EntryList now={NOW} />)

    expect(await screen.findByTestId(`billable-${stored.id}`)).toHaveTextContent('Billable')
  })

  it('does not mark an entry billable when it is not', async () => {
    const stored = await putEntry(
      entry({ billable: false, end: new Date('2026-10-13T10:30:00.000Z') }),
    )

    render(<EntryList now={NOW} />)

    await screen.findByTestId(`duration-${stored.id}`)
    expect(screen.queryByTestId(`billable-${stored.id}`)).toBeNull()
  })
})

/**
 * Which path reads the database.
 *
 * `EntryList` accepts pre-filtered entries because the caller above it has already decided
 * what to show. It used to subscribe to the store *as well*, even when it was handed a
 * list — so every write ran two full read-and-filter cycles on the home screen. Nothing
 * about that is visible on screen, which is why it survived: it only costs time.
 *
 * So the assertion is on the read, not on the output. The rendered rows are already covered
 * by the tests above, on both paths.
 */
describe('reads the database only when it has to', () => {
  it('does not read when the caller passed entries in', async () => {
    await putEntry(entry({ end: new Date('2026-10-13T10:30:00.000Z') }))
    const reads = vi.spyOn(entriesRepo, 'listEntries')

    render(
      <EntryList now={NOW} entries={[entry({ end: new Date('2026-10-13T10:30:00.000Z') })]} />,
    )

    expect(await screen.findByText('Uncategorised')).toBeVisible()
    expect(reads).not.toHaveBeenCalled()
  })

  it('does read when it has to load them itself', async () => {
    await putEntry(entry({ end: new Date('2026-10-13T10:30:00.000Z') }))
    const reads = vi.spyOn(entriesRepo, 'listEntries')

    render(<EntryList now={NOW} />)

    expect(await screen.findByText('Uncategorised')).toBeVisible()
    expect(reads).toHaveBeenCalled()
  })
})
