import { describe, expect, it } from 'vitest'
import { summariseEntries } from './summary'
import { groupEntriesByDay } from './group'
import { dayKey, weekKey } from '../time/days'
import { entry } from '../../test/factories'
import type { Client, Project } from '../../domain/taxonomy/types'

/**
 * Summaries per client and period (items 21 and 22 of `SPECS/todo.md`).
 *
 * The arithmetic is the point: a summary that disagrees with the list above it is worse
 * than no summary, so these compare against a hand-computed figure rather than against
 * whatever the code produced last time.
 */

// Fixed to UTC so the day boundaries do not move with the machine's timezone. Local
// calendar arithmetic is what the code under test does, so the fixtures pin the input
// rather than the expectation.
const MONDAY_09 = new Date('2026-10-12T09:00:00.000Z')
const MONDAY_10 = new Date('2026-10-12T10:00:00.000Z')
const WEDNESDAY_09 = new Date('2026-10-14T09:00:00.000Z')
const NEXT_MONDAY_09 = new Date('2026-10-19T09:00:00.000Z')
const NOW = new Date('2026-10-20T12:00:00.000Z')

function client(id: string, name: string): Client {
  return {
    id,
    name,
    currency: 'GBP',
    defaultRateMinor: null,
    colour: '#2e6aae',
    archived: false,
    deletedAt: null,
    createdAt: MONDAY_09.toISOString(),
    updatedAt: MONDAY_09.toISOString(),
  }
}

function project(id: string, name: string, clientId: string | null): Project {
  return {
    id,
    name,
    clientId,
    colour: '#2e6aae',
    defaultRateMinor: null,
    currency: null,
    archived: false,
    deletedAt: null,
    createdAt: MONDAY_09.toISOString(),
    updatedAt: MONDAY_09.toISOString(),
  }
}

const ACME = client('c-acme', 'Acme Ltd')
const OTHER = client('c-other', 'Other Ltd')
const CLIENTS = [ACME, OTHER]
const WEBSITE = project('p-web', 'Website', 'c-acme')
const RETAINER = project('p-ret', 'Retainer', 'c-other')
const INTERNAL = project('p-int', 'Internal', null)
const PROJECTS = [WEBSITE, RETAINER, INTERNAL]

function at(start: Date, minutes: number) {
  return entry({
    start,
    end: new Date(start.getTime() + minutes * 60_000),
    projectId: null,
  })
}

describe('per client', () => {
  it('splits the same period by client', () => {
    const buckets = summariseEntries({
      entries: [
        { ...at(MONDAY_09, 60), projectId: WEBSITE.id },
        { ...at(MONDAY_10, 30), projectId: RETAINER.id },
      ],
      projects: PROJECTS,
      clients: CLIENTS,
      period: 'day',
      clientId: null,
      now: NOW,
    })

    expect(buckets).toHaveLength(1)
    const rows = buckets[0]?.rows ?? []
    expect(rows.map((row) => [row.clientName, row.totalMs])).toEqual([
      ['Acme Ltd', 60 * 60_000],
      ['Other Ltd', 30 * 60_000],
    ])
    expect(buckets[0]?.totalMs).toBe(90 * 60_000)
  })

  it('adds up several projects belonging to one client', () => {
    const second = project('p-web2', 'Website 2', 'c-acme')
    const buckets = summariseEntries({
      entries: [
        { ...at(MONDAY_09, 60), projectId: WEBSITE.id },
        { ...at(MONDAY_10, 30), projectId: second.id },
        { ...at(MONDAY_10, 15), projectId: RETAINER.id },
      ],
      projects: [...PROJECTS, second],
      clients: CLIENTS,
      period: 'day',
      clientId: null,
      now: NOW,
    })

    const acme = buckets[0]?.rows.find((row) => row.clientId === 'c-acme')
    expect(acme?.totalMs).toBe(90 * 60_000)
    expect(acme?.entryCount).toBe(2)
    // Both project names, so the line is meaningful without opening it.
    expect(acme?.projectNames).toEqual(['Website', 'Website 2'])
  })

  it('keeps uncategorised as its own line, named rather than missing', () => {
    // 0005 U1: a legitimate state with its own bucket, not "Unknown" and not absent.
    const buckets = summariseEntries({
      entries: [at(MONDAY_09, 45), { ...at(MONDAY_10, 15), projectId: WEBSITE.id }],
      projects: PROJECTS,
      clients: CLIENTS,
      period: 'day',
      clientId: null,
      now: NOW,
    })

    const rows = buckets[0]?.rows ?? []
    const uncategorised = rows.find((row) => row.clientId === null)
    expect(uncategorised?.clientName).toBe('Uncategorised')
    expect(uncategorised?.totalMs).toBe(45 * 60_000)
    // Last: the named clients are what the reader came for.
    expect(rows[rows.length - 1]?.clientId).toBe(null)
  })

  it('counts an entry whose project has vanished, rather than dropping its time', () => {
    const buckets = summariseEntries({
      entries: [{ ...at(MONDAY_09, 60), projectId: 'p-gone' }],
      projects: PROJECTS,
      clients: CLIENTS,
      period: 'day',
      clientId: null,
      now: NOW,
    })

    // The total still adds up. Dropping it would make the summary disagree with the list.
    expect(buckets[0]?.totalMs).toBe(60 * 60_000)
  })
})

describe('filtering by client (item 21)', () => {
  const entries = [
    { ...at(MONDAY_09, 60), projectId: WEBSITE.id },
    { ...at(MONDAY_10, 30), projectId: RETAINER.id },
    at(MONDAY_10, 20),
  ]

  it('keeps only the chosen client', () => {
    const buckets = summariseEntries({
      entries,
      projects: PROJECTS,
      clients: CLIENTS,
      period: 'all',
      clientId: 'c-acme',
      now: NOW,
    })

    expect(buckets[0]?.rows).toHaveLength(1)
    expect(buckets[0]?.rows[0]?.clientName).toBe('Acme Ltd')
    expect(buckets[0]?.totalMs).toBe(60 * 60_000)
  })

  it('keeps everything when no client is chosen', () => {
    const buckets = summariseEntries({
      entries,
      projects: PROJECTS,
      clients: CLIENTS,
      period: 'all',
      clientId: null,
      now: NOW,
    })

    expect(buckets[0]?.rows).toHaveLength(3)
    expect(buckets[0]?.totalMs).toBe(110 * 60_000)
  })
})

describe('periods (item 22)', () => {
  const entries = [
    { ...at(MONDAY_09, 60), projectId: WEBSITE.id },
    { ...at(WEDNESDAY_09, 30), projectId: WEBSITE.id },
    { ...at(NEXT_MONDAY_09, 15), projectId: RETAINER.id },
  ]

  it('daily makes a bucket per day', () => {
    const buckets = summariseEntries({
      entries,
      projects: PROJECTS,
      clients: CLIENTS,
      period: 'day',
      clientId: null,
      now: NOW,
    })

    expect(buckets.map((bucket) => bucket.dayKey)).toEqual([
      dayKey(NEXT_MONDAY_09),
      dayKey(WEDNESDAY_09),
      dayKey(MONDAY_09),
    ])
    // Newest first, so the recent work is at the top.
  })

  it('weekly folds days into the week they belong to', () => {
    const buckets = summariseEntries({
      entries,
      projects: PROJECTS,
      clients: CLIENTS,
      period: 'week',
      clientId: null,
      now: NOW,
    })

    expect(buckets).toHaveLength(2)
    // Monday and Wednesday are the same week: 60 + 30 summed per client.
    const sameWeek = buckets[1]
    expect(sameWeek?.rows[0]?.clientName).toBe('Acme Ltd')
    expect(sameWeek?.rows[0]?.totalMs).toBe(90 * 60_000)
    expect(sameWeek?.totalMs).toBe(90 * 60_000)
    expect(buckets[0]?.rows[0]?.clientName).toBe('Other Ltd')
  })

  it('labels a week by the Monday that starts it', () => {
    const buckets = summariseEntries({
      entries,
      projects: PROJECTS,
      clients: CLIENTS,
      period: 'week',
      clientId: null,
      now: NOW,
    })

    // Ambiguous otherwise: any month with two Mondays would give two identical labels.
    expect(buckets[1]?.label).toContain('12')
    expect(buckets[0]?.label).toContain('19')
  })

  it('all-entries produces a single bucket', () => {
    const buckets = summariseEntries({
      entries,
      projects: PROJECTS,
      clients: CLIENTS,
      period: 'all',
      clientId: null,
      now: NOW,
    })

    expect(buckets).toHaveLength(1)
    expect(buckets[0]?.label).toBe('All entries')
    expect(buckets[0]?.totalMs).toBe(105 * 60_000)
  })

  it('sums a running entry against now, in step with the list', () => {
    const running = entry({ start: MONDAY_09, end: null, projectId: WEBSITE.id })
    const buckets = summariseEntries({
      entries: [running],
      projects: PROJECTS,
      clients: CLIENTS,
      period: 'all',
      clientId: null,
      now: new Date(MONDAY_09.getTime() + 20 * 60_000),
    })

    expect(buckets[0]?.rows[0]?.totalMs).toBe(20 * 60_000)
  })

  it('is empty rather than throwing when there is nothing to show', () => {
    expect(
      summariseEntries({
        entries: [],
        projects: PROJECTS,
        clients: CLIENTS,
        period: 'day',
        clientId: null,
        now: NOW,
      }),
    ).toEqual([])
  })

  it('skips an unparseable timestamp instead of taking the summary down', () => {
    // Timestamps arrive from backups and from replication; one corrupt value must not
    // cost the user the rest of their figures.
    const buckets = summariseEntries({
      entries: [
        { ...at(MONDAY_09, 60), start: 'not-a-date', projectId: WEBSITE.id },
        { ...at(MONDAY_10, 30), projectId: WEBSITE.id },
      ],
      projects: PROJECTS,
      clients: CLIENTS,
      period: 'day',
      clientId: null,
      now: NOW,
    })

    expect(buckets).toHaveLength(1)
    expect(buckets[0]?.totalMs).toBe(30 * 60_000)
  })
})

describe('weeks start on Monday', () => {
  it('treats Sunday as the end of its week, not the start of the next', () => {
    // Mapping Sunday to 0 rather than 7 would put every Sunday eight days early and make
    // every week one day too long.
    const sunday = new Date('2026-10-18T12:00:00.000Z')
    expect(weekKey(sunday)).toBe(dayKey(new Date('2026-10-12T00:00:00.000Z')))
  })

  it('puts a Monday on itself', () => {
    const monday = new Date('2026-10-12T12:00:00.000Z')
    expect(weekKey(monday)).toBe(dayKey(monday))
  })
})

/**
 * The summary and the list must never disagree (0006 RP2).
 *
 * `summary.ts` argues for handling both axes in one function precisely so "a summary cannot
 * disagree with the rows above it". The two implementations did disagree, in the one case
 * that matters: an entry whose duration cannot be recovered made the list print `—` while
 * the summary reported a confident total that quietly omitted it. The user saw two numbers
 * for the same day and had no way to know which was true.
 *
 * So this asserts the agreement directly, by running both over the same corrupt input,
 * rather than asserting the rule twice in two files — which is how they came to disagree.
 */
describe('agreement with the entry list', () => {
  const NOW = new Date('2026-10-13T18:00:00.000Z')
  const DAY = dayKey(NOW)

  /**
   * A start that parses and an end that does not.
   *
   * The `end` specifically: an unreadable `start` is dropped from the day buckets entirely,
   * which is a different and already-tested path. It is the *duration* that has to survive
   * the row and reach the total, and that is what disagrees between the two.
   */
  const corrupt = {
    ...entry({ start: new Date('2026-10-13T09:00:00.000Z') }),
    end: 'not-a-timestamp',
  }

  it('reports an unrecoverable duration as unknown in both places', () => {
    const summary = summariseEntries({
      entries: [corrupt],
      projects: [],
      clients: [],
      clientId: null,
      period: 'day',
      now: NOW,
    })
    const grouped = groupEntriesByDay([corrupt], NOW)

    const bucket = summary.find((candidate) => candidate.dayKey === DAY)
    const group = grouped.find((candidate) => candidate.key === DAY)

    // Both must say "cannot be computed". The list already did; the summary did not.
    expect(bucket?.totalMs).toBeNull()
    expect(group?.totalMs).toBeNull()
  })

  it('does not let one bad row poison an unrelated day', () => {
    const good = entry({ start: new Date('2026-10-12T09:00:00.000Z') })
    const summary = summariseEntries({
      entries: [good, corrupt],
      projects: [],
      clients: [],
      clientId: null,
      period: 'day',
      now: NOW,
    })

    const clean = summary.find((candidate) => candidate.dayKey === dayKey(new Date(good.start)))
    expect(clean?.totalMs).not.toBeNull()
  })
})
