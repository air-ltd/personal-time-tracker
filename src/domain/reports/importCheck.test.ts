import { describe, expect, it } from 'vitest'
import { checkImportedSnapshot } from './importCheck'
import type { Snapshot } from '../merge'
import type { TimeEntry } from '../entries/types'

/**
 * What a restored file is allowed to bring in.
 *
 * The app enforces these rules when you type something, and did not enforce them
 * when a file said so — so a backup could contain an entry that lasted three days, a
 * note of fifty thousand characters, or two clients with the same name, and the app
 * would accept all of it and then behave oddly.
 */

function entry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'e1',
    projectId: null,
    tagIds: [],
    start: '2026-10-13T08:00:00.000Z',
    end: '2026-10-13T09:00:00.000Z',
    note: '',
    billable: false,
    rateOverrideMinor: null,
    source: 'timer',
    createdAt: '2026-10-13T09:00:00.000Z',
    updatedAt: '2026-10-13T09:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function snap(entities: Record<string, unknown[]>): Snapshot {
  return {
    schemaVersion: 5,
    entities: entities as Snapshot['entities'],
  }
}

describe('the import check', () => {
  it('keeps an entry that breaks nothing', () => {
    const result = checkImportedSnapshot(snap({ entries: [entry()] }))
    expect(result.dropped).toHaveLength(0)
    expect(result.snapshot.entities['entries']).toHaveLength(1)
  })

  it('drops an entry longer than a day (0004 V2)', () => {
    const long = entry({
      id: 'long',
      start: '2026-10-13T08:00:00.000Z',
      end: '2026-10-15T08:00:00.000Z',
    })
    const result = checkImportedSnapshot(snap({ entries: [entry(), long] }))
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.id).toBe('long')
    expect(result.dropped[0]?.reason).toMatch(/24/)
  })

  it('drops an entry whose end is before its start', () => {
    const backwards = entry({
      id: 'backwards',
      start: '2026-10-13T09:00:00.000Z',
      end: '2026-10-13T08:00:00.000Z',
    })
    const result = checkImportedSnapshot(snap({ entries: [backwards] }))
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.reason).toMatch(/before the start/i)
  })

  it('drops an entry with a note over the limit (0004 V4)', () => {
    const long = entry({ id: 'long-note', note: 'x'.repeat(2001) })
    const result = checkImportedSnapshot(snap({ entries: [long] }))
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.reason).toMatch(/2000/)
  })

  it('keeps a running entry, which has no end to check', () => {
    const running = entry({ id: 'running', end: null })
    const result = checkImportedSnapshot(snap({ entries: [running] }))
    expect(result.dropped).toHaveLength(0)
  })

  it('drops a client whose name is over the limit (0003 Client)', () => {
    const result = checkImportedSnapshot(
      snap({
        clients: [
          {
            id: 'c1',
            name: 'x'.repeat(81),
            colour: '#123456',
            defaultRateMinor: null,
            currency: 'GBP',
            archived: false,
            createdAt: '2026-10-13T09:00:00.000Z',
            updatedAt: '2026-10-13T09:00:00.000Z',
            deletedAt: null,
          },
        ],
      }),
    )
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.reason).toMatch(/longer than 80/)
  })

  it('drops the second of two clients with the same name', () => {
    const client = (id: string) => ({
      id,
      name: 'Acme Ltd',
      colour: '#123456',
      defaultRateMinor: null,
      currency: 'GBP',
      archived: false,
      createdAt: '2026-10-13T09:00:00.000Z',
      updatedAt: '2026-10-13T09:00:00.000Z',
      deletedAt: null,
    })
    const result = checkImportedSnapshot(snap({ clients: [client('c1'), client('c2')] }))
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.id).toBe('c2')
    expect(result.snapshot.entities['clients']).toHaveLength(1)
  })

  it('keeps two projects with the same name under different clients (0005 P2)', () => {
    const project = (id: string, clientId: string) => ({
      id,
      name: 'General',
      clientId,
      colour: '#abcdef',
      defaultRateMinor: null,
      currency: null,
      archived: false,
      createdAt: '2026-10-13T09:00:00.000Z',
      updatedAt: '2026-10-13T09:00:00.000Z',
      deletedAt: null,
    })
    const result = checkImportedSnapshot(
      snap({ projects: [project('p1', 'c1'), project('p2', 'c2')] }),
    )
    expect(result.dropped).toHaveLength(0)
    expect(result.snapshot.entities['projects']).toHaveLength(2)
  })

  it('drops a contract whose days do not add up to its week (0003 CT3)', () => {
    const result = checkImportedSnapshot(
      snap({
        contractPeriods: [
          {
            id: 'cp1',
            clientId: 'c1',
            effectiveFrom: '2026-01-01',
            effectiveTo: null,
            minutesPerWeek: 2400,
            workPattern: [{ weekday: 0, minutes: 480 }],
            createdAt: '2026-10-13T09:00:00.000Z',
            updatedAt: '2026-10-13T09:00:00.000Z',
            deletedAt: null,
          },
        ],
      }),
    )
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.reason).toMatch(/add up to/)
  })

  it('carries a table it does not know about through untouched', () => {
    const result = checkImportedSnapshot(
      snap({ somethingNewer: [{ id: 'x1', updatedAt: '2026-10-13T09:00:00.000Z' }] }),
    )
    expect(result.dropped).toHaveLength(0)
    expect(result.snapshot.entities['somethingNewer']).toHaveLength(1)
  })
})
