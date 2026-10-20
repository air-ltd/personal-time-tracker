import { beforeEach, describe, expect, it } from 'vitest'
import { installTestDb } from '../test/harness'
import {
  createContractPeriod,
  deleteContractPeriod,
  findOverlaps,
  listAllContractPeriods,
  listContractPeriods,
  updateContractPeriod,
} from './contractPeriodRepo'
import type { DayPattern } from '../domain/capacity/types'

const MON_FRI_40H: DayPattern[] = [
  { weekday: 0, minutes: 480 },
  { weekday: 1, minutes: 480 },
  { weekday: 2, minutes: 480 },
  { weekday: 3, minutes: 480 },
  { weekday: 4, minutes: 480 },
  { weekday: 5, minutes: 0 },
  { weekday: 6, minutes: 0 },
]

const NOW = new Date('2026-10-13T12:00:00.000Z')

function input(overrides: Partial<Parameters<typeof createContractPeriod>[0]> = {}) {
  return {
    clientId: 'client-a',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    minutesPerWeek: 2400,
    workPattern: MON_FRI_40H,
    ...overrides,
  }
}

describe('contract periods', () => {
  beforeEach(() => {
    installTestDb()
  })

  it('stores a contract for a client', async () => {
    const result = await createContractPeriod(input(), NOW)
    expect(result.ok).toBe(true)

    const stored = await listContractPeriods('client-a')
    expect(stored).toHaveLength(1)
    const [first] = stored
    expect(first?.minutesPerWeek).toBe(2400)
    expect(first?.clientId).toBe('client-a')
  })

  it('refuses a contract that overlaps another for the same client (0003 CT1)', async () => {
    await createContractPeriod(
      input({ effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' }),
      NOW,
    )
    const result = await createContractPeriod(
      input({ effectiveFrom: '2026-03-01', effectiveTo: '2026-09-30' }),
      NOW,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/overlaps/i)
    expect(await listContractPeriods('client-a')).toHaveLength(1)
  })

  it('allows two clients to hold contracts at the same time (0013 K4)', async () => {
    await createContractPeriod(input({ clientId: 'client-a' }), NOW)
    const result = await createContractPeriod(input({ clientId: 'client-b' }), NOW)

    expect(result.ok).toBe(true)
    expect(await listAllContractPeriods()).toHaveLength(2)
  })

  it('refuses a contract with no working days (0003 CT6)', async () => {
    const result = await createContractPeriod(
      input({
        minutesPerWeek: 0,
        workPattern: MON_FRI_40H.map((entry) => ({ ...entry, minutes: 0 })),
      }),
      NOW,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/working day/i)
  })

  it('refuses a pattern that does not sum to the week (0003 CT3)', async () => {
    const result = await createContractPeriod(input({ minutesPerWeek: 2250 }), NOW)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/add up to/i)
  })

  it('updates a contract', async () => {
    const created = await createContractPeriod(input(), NOW)
    if (!created.ok) throw new Error('setup failed')

    const updated = await updateContractPeriod(
      created.period.id,
      {
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
        // 4 x 480 + 300 = 2,220, a 37.5-hour week.
        minutesPerWeek: 2220,
        workPattern: MON_FRI_40H.map((entry) =>
          entry.weekday === 4 ? { ...entry, minutes: 300 } : entry,
        ),
      },
      new Date('2026-10-14T12:00:00.000Z'),
    )

    expect(updated.ok).toBe(true)
    const stored = await listContractPeriods('client-a')
    const [first] = stored
    expect(first?.minutesPerWeek).toBe(2220)
    expect(first?.updatedAt).toBe('2026-10-14T12:00:00.000Z')
  })

  it('lets a contract be updated to start the day the previous one ends', async () => {
    const created = await createContractPeriod(
      input({ effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31' }),
      NOW,
    )
    if (!created.ok) throw new Error('setup failed')

    const updated = await updateContractPeriod(
      created.period.id,
      {
        effectiveFrom: '2026-04-01',
        effectiveTo: null,
        minutesPerWeek: 2400,
        workPattern: MON_FRI_40H,
      },
      NOW,
    )

    expect(updated.ok).toBe(true)
  })

  it('refuses an update that would overlap a sibling contract', async () => {
    await createContractPeriod(
      input({ effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' }),
      NOW,
    )
    const second = await createContractPeriod(
      input({ effectiveFrom: '2026-07-01', effectiveTo: null }),
      NOW,
    )
    if (!second.ok) throw new Error('setup failed')

    const updated = await updateContractPeriod(
      second.period.id,
      {
        effectiveFrom: '2026-03-01',
        effectiveTo: null,
        minutesPerWeek: 2400,
        workPattern: MON_FRI_40H,
      },
      NOW,
    )

    expect(updated.ok).toBe(false)
  })

  it('leaves a tombstone when deleted, so the deletion travels (0012 M6)', async () => {
    const created = await createContractPeriod(input(), NOW)
    if (!created.ok) throw new Error('setup failed')

    await deleteContractPeriod(created.period.id, NOW)

    const stored = await listContractPeriods('client-a')
    expect(stored).toHaveLength(1)
    expect(stored[0]?.deletedAt).toBe('2026-10-13T12:00:00.000Z')
  })

  it('finds the contracts overlapping a range, for the merge check (0012 M2.3)', async () => {
    await createContractPeriod(
      input({ effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' }),
      NOW,
    )
    await createContractPeriod(input({ effectiveFrom: '2026-07-01', effectiveTo: null }), NOW)

    const overlapping = await findOverlaps('client-a', '2026-05-01', '2026-05-31')
    expect(overlapping).toHaveLength(1)
    expect(overlapping[0]?.effectiveFrom).toBe('2026-01-01')
  })

  it('does not report another client’s contracts as overlapping', async () => {
    await createContractPeriod(input({ clientId: 'client-a' }), NOW)

    const overlapping = await findOverlaps('client-b', '2026-05-01', '2026-05-31')
    expect(overlapping).toHaveLength(0)
  })

  it('ignores a deleted contract when looking for overlaps', async () => {
    const created = await createContractPeriod(input(), NOW)
    if (!created.ok) throw new Error('setup failed')
    await deleteContractPeriod(created.period.id, NOW)

    const overlapping = await findOverlaps('client-a', '2026-05-01', '2026-05-31')
    expect(overlapping).toHaveLength(0)
  })
})
