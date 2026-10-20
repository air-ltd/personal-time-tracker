import { getDb } from './db'
import { bumpRevision } from './events'
import { validateContractPeriod } from '../domain/capacity/contract'
import type { ContractPeriod, DayPattern } from '../domain/capacity/types'
import { newId } from '../domain/time/ids'

/**
 * Storage for contract periods (0003 §ContractPeriod).
 *
 * The records are mergeable in the ordinary way — union by `id`, last write wins on
 * `updatedAt` — so nothing here needs a merge rule of its own (0012 M2). What *is* not
 * ordinary is the non-overlap invariant: two devices can each hold a valid contract
 * and the union of them can overlap (0012 M2.3). That is surfaced by `findOverlaps`
 * rather than prevented here, because it cannot be prevented on one device alone.
 */

export interface CreateContractPeriodInput {
  clientId: string
  /** Local calendar date, inclusive (0003 §ContractPeriod). */
  effectiveFrom: string
  /** Local calendar date, inclusive. Null = open-ended (0003 CT1). */
  effectiveTo: string | null
  /** Weekly contracted total, in integer minutes (0003 P6). */
  minutesPerWeek: number
  /** One entry per weekday, Monday-first (0003 CT2). */
  workPattern: DayPattern[]
}

export type CreateContractPeriodResult =
  { ok: true; period: ContractPeriod } | { ok: false; reason: string }

/**
 * Create a contract period for a client.
 *
 * The period is validated against the client's existing periods before anything is
 * written, so an overlapping contract is refused rather than stored and reported later
 * (0003 CT1, 0013 K4).
 */
export async function createContractPeriod(
  input: CreateContractPeriodInput,
  now: Date,
): Promise<CreateContractPeriodResult> {
  const existing = await listContractPeriods(input.clientId)
  const result = validateContractPeriod(input, existing)
  if (!result.ok) return { ok: false, reason: result.reason }

  const stamp = now.toISOString()
  const period: ContractPeriod = {
    id: newId(),
    clientId: input.clientId,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    minutesPerWeek: input.minutesPerWeek,
    workPattern: input.workPattern,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  }
  await getDb().contractPeriods.put(period)
  bumpRevision()
  return { ok: true, period }
}

export interface UpdateContractPeriodInput {
  effectiveFrom: string
  effectiveTo: string | null
  minutesPerWeek: number
  workPattern: DayPattern[]
}

/**
 * Update a contract period.
 *
 * Editing recomputes history, because every figure is computed at read time
 * (0013 CP1, K7). The caller is expected to warn the user before saving; the
 * validation here only refuses what cannot be stored at all.
 */
export async function updateContractPeriod(
  id: string,
  input: UpdateContractPeriodInput,
  now: Date,
): Promise<CreateContractPeriodResult> {
  const db = getDb()
  const current = await db.contractPeriods.get(id)
  if (current === undefined) {
    return { ok: false, reason: 'That contract no longer exists.' }
  }

  // Every other period for this client, including the one being edited — which is
  // excluded, because a contract always overlaps itself.
  const others = (await listContractPeriods(current.clientId)).filter(
    (period) => period.id !== id,
  )
  const candidate = { ...current, ...input }
  const result = validateContractPeriod(candidate, others)
  if (!result.ok) return { ok: false, reason: result.reason }

  const updated: ContractPeriod = { ...candidate, updatedAt: now.toISOString() }
  await db.contractPeriods.put(updated)
  bumpRevision()
  return { ok: true, period: updated }
}

/**
 * Every contract period for a client, including tombstones.
 *
 * Tombstones are included because a deleted period still occupied its dates, and
 * ignoring it would let a new contract be created inside a range that a live copy on
 * another device still covers (0012 M2.3).
 */
export async function listContractPeriods(clientId: string): Promise<ContractPeriod[]> {
  return getDb().contractPeriods.where('clientId').equals(clientId).toArray()
}

/** Every contract period, for every client. */
export async function listAllContractPeriods(): Promise<ContractPeriod[]> {
  return getDb().contractPeriods.toArray()
}

/**
 * Delete a contract period.
 *
 * A tombstone rather than a removal, so the deletion propagates to the other devices
 * and a deleted contract does not come back on the next pull (0012 M6).
 */
export async function deleteContractPeriod(id: string, now: Date): Promise<void> {
  const db = getDb()
  const current = await db.contractPeriods.get(id)
  if (current === undefined) return
  await db.contractPeriods.put({
    ...current,
    deletedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  })
  bumpRevision()
}

/**
 * The contract periods that overlap a range for a client.
 *
 * This is the check the sync merge needs: each device's own periods are valid, and
 * the union of two valid sets can overlap (0012 M2.3). The overlap is judged within a
 * client, because the scope is the client (0003 CT9).
 */
export async function findOverlaps(
  clientId: string,
  effectiveFrom: string,
  effectiveTo: string | null,
): Promise<ContractPeriod[]> {
  const periods = await listContractPeriods(clientId)
  const end = effectiveTo ?? '9999-12-31'
  return periods.filter(
    (period) =>
      period.deletedAt === null &&
      period.effectiveFrom <= end &&
      effectiveFrom <= (period.effectiveTo ?? '9999-12-31'),
  )
}
