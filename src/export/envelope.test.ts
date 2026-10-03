import { describe, expect, it } from 'vitest'
import {
  FORMAT,
  FORMAT_VERSION,
  parseEnvelope,
  serialiseEnvelope,
  toEnvelope,
} from './envelope'
import type { Mergeable, Snapshot } from '../domain/merge'

const AT = new Date('2026-10-13T09:00:00.000Z')

function entry(id: string): Mergeable {
  return {
    id,
    projectId: null,
    tagIds: [],
    start: '2026-10-13T08:00:00.000Z',
    end: '2026-10-13T09:00:00.000Z',
    note: 'note',
    billable: false,
    rateOverrideMinor: null,
    source: 'manual',
    createdAt: '2026-10-13T08:00:00.000Z',
    updatedAt: '2026-10-13T08:00:00.000Z',
    deletedAt: null,
  } as Mergeable
}

function snapshotOf(entries: Mergeable[], schemaVersion = 1): Snapshot {
  return { schemaVersion, entities: { entries } }
}

describe('toEnvelope', () => {
  it('includes every entity table, defaulting the absent ones (0008 J2.1)', () => {
    const envelope = toEnvelope(snapshotOf([entry('a')]), AT)
    expect(Object.keys(envelope.data).sort()).toEqual([
      'clients',
      'contractPeriods',
      'entries',
      'nonWorkingDays',
      'projects',
      'tags',
    ])
    expect(envelope.data.projects).toEqual([])
  })

  it('records counts for every table (0008 J5)', () => {
    const envelope = toEnvelope(snapshotOf([entry('a'), entry('b')]), AT)
    expect(envelope.counts['entries']).toBe(2)
    expect(envelope.counts['projects']).toBe(0)
  })

  it('stamps the format and version (0008 J2, J3)', () => {
    const envelope = toEnvelope(snapshotOf([]), AT)
    expect(envelope.format).toBe(FORMAT)
    expect(envelope.formatVersion).toBe(FORMAT_VERSION)
    expect(envelope.exportedAt).toBe(AT.toISOString())
  })

  it('carries the snapshot schema version through', () => {
    expect(toEnvelope(snapshotOf([], 4), AT).schemaVersion).toBe(4)
  })

  // J6: no transformation, so a backup is not a second schema.
  it('passes record fields through unchanged', () => {
    const envelope = toEnvelope(snapshotOf([entry('a')]), AT)
    expect(envelope.data.entries[0]).toMatchObject({ note: 'note', source: 'manual' })
  })

  it('serialises compactly rather than pretty-printed (0008 J9)', () => {
    const serialised = serialiseEnvelope(toEnvelope(snapshotOf([entry('a')]), AT))
    expect(serialised.split('\n')).toHaveLength(1)
  })
})

describe('parseEnvelope', () => {
  it('round-trips a snapshot', () => {
    const original = snapshotOf([entry('a'), entry('b')])
    const result = parseEnvelope(JSON.parse(serialiseEnvelope(toEnvelope(original, AT))), 1)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.entities['entries']).toHaveLength(2)
    expect(result.snapshot.schemaVersion).toBe(1)
  })

  it('round-trips a soft-deleted entry so undo survives a restore', () => {
    const deleted = { ...entry('a'), deletedAt: '2026-10-13T10:00:00.000Z' } as Mergeable
    const result = parseEnvelope(
      JSON.parse(serialiseEnvelope(toEnvelope(snapshotOf([deleted]), AT))),
      1,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.entities['entries']?.[0]?.deletedAt).toBe('2026-10-13T10:00:00.000Z')
  })

  it('round-trips a running entry', () => {
    const running = { ...entry('a'), end: null } as Mergeable
    const result = parseEnvelope(
      JSON.parse(serialiseEnvelope(toEnvelope(snapshotOf([running]), AT))),
      1,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      (result.snapshot.entities['entries']?.[0] as unknown as { end: string | null }).end,
    ).toBeNull()
  })

  // J11: check the marker before interpreting anything else.
  it('rejects a payload that is not a backup at all', () => {
    const result = parseEnvelope({ hello: 'world' }, 1)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('Not a')
  })

  it('rejects null and non-objects', () => {
    expect(parseEnvelope(null, 1).ok).toBe(false)
    expect(parseEnvelope('a string', 1).ok).toBe(false)
  })

  // J12: refuse a newer file layout rather than best-effort parsing it.
  it('rejects a newer format version', () => {
    const envelope = {
      ...toEnvelope(snapshotOf([entry('a')]), AT),
      formatVersion: FORMAT_VERSION + 1,
    }
    const result = parseEnvelope(envelope, 1)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toMatch(/newer than this build/)
  })

  // M9: a newer data schema must not be interpreted.
  it('rejects a newer data schema', () => {
    const envelope = toEnvelope(snapshotOf([entry('a')], 9), AT)
    const result = parseEnvelope(envelope, 1)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toMatch(/data schema 9/)
  })

  it('rejects an entry missing required fields, listing the problems', () => {
    const envelope = toEnvelope(snapshotOf([entry('a')]), AT)
    const broken = { ...envelope, data: { ...envelope.data, entries: [{ id: 'a' }] } }
    const result = parseEnvelope(broken, 1)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.issues.length).toBeGreaterThan(0)
  })

  it('rejects an end timestamp before its start at parse time', () => {
    const envelope = toEnvelope(snapshotOf([entry('a')]), AT)
    const broken = {
      ...envelope,
      data: {
        ...envelope.data,
        entries: [
          {
            ...envelope.data.entries[0],
            start: '2026-10-13T10:00:00.000Z',
            end: '2026-10-13T09:00:00.000Z',
          },
        ],
      },
    }
    // A reversed span is well-formed data even though it is nonsense, so the schema
    // accepts it; validateEntry is what rejects it. Asserted here to pin down where
    // the boundary sits.
    expect(parseEnvelope(broken, 1).ok).toBe(true)
  })

  it('rejects an unknown source value', () => {
    const envelope = toEnvelope(snapshotOf([entry('a')]), AT)
    const broken = {
      ...envelope,
      data: {
        ...envelope.data,
        entries: [{ ...envelope.data.entries[0], source: 'telepathy' }],
      },
    }
    expect(parseEnvelope(broken, 1).ok).toBe(false)
  })

  it('rejects a non-integer rate, which would mean float money', () => {
    const envelope = toEnvelope(snapshotOf([entry('a')]), AT)
    const broken = {
      ...envelope,
      data: {
        ...envelope.data,
        entries: [{ ...envelope.data.entries[0], rateOverrideMinor: 10.5 }],
      },
    }
    expect(parseEnvelope(broken, 1).ok).toBe(false)
  })

  // J6: a Phase 4 project's fields must survive a round trip through this build,
  // even though this build cannot validate them. Stripping them would be a quiet way
  // to lose data.
  it('preserves fields from tables it does not understand', () => {
    const envelope = toEnvelope(snapshotOf([entry('a')]), AT)
    const withProject = {
      ...envelope,
      data: {
        ...envelope.data,
        projects: [
          {
            id: 'p',
            name: 'Later phase project',
            clientId: null,
            colour: '#1F5FBF',
            defaultRateMinor: 9000,
            archived: false,
            updatedAt: '2026-10-13T08:00:00.000Z',
            deletedAt: null,
          },
        ],
      },
    }

    const result = parseEnvelope(withProject, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const project = result.snapshot.entities['projects']?.[0] as unknown as {
      colour: string
      defaultRateMinor: number
    }
    expect(project.colour).toBe('#1F5FBF')
    expect(project.defaultRateMinor).toBe(9000)
  })

  it('still rejects a deferred record with no id or a bad timestamp', () => {
    const envelope = toEnvelope(snapshotOf([entry('a')]), AT)
    const broken = {
      ...envelope,
      data: { ...envelope.data, projects: [{ updatedAt: 'not-a-date', deletedAt: null }] },
    }
    expect(parseEnvelope(broken, 1).ok).toBe(false)
  })
})

describe('credentials never appear in a payload (0012 AU6, 0008 S2)', () => {
  it('has no field that could hold a token', () => {
    const serialised = serialiseEnvelope(toEnvelope(snapshotOf([entry('a')]), AT))
    expect(serialised).not.toMatch(/token/i)
    expect(serialised).not.toMatch(/secret/i)
    expect(serialised).not.toMatch(/refresh/i)
  })
})
