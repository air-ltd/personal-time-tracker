/**
 * Capacity entities (0003 §ContractPeriod, 0013).
 *
 * A contract period says how many hours a week are expected on one client, and what
 * shape that week has. It is scoped to a client rather than to a project, because a
 * project's hours are already a subset of its client's — a project-level contract
 * would double-count against its own client (0003 CT9).
 *
 * `deletedAt` is here for the same reason as on every other entity: `merge.ts` is
 * generic and requires the tombstone, so an entity without it could not be deleted
 * and would reappear on the next pull (0012 M2).
 */

/**
 * One weekday's contracted minutes.
 *
 * `weekday` is Monday-first: 0 is Monday, 6 is Sunday (0003 CT2, 0013 K3). JavaScript's
 * `Date.getDay()` is Sunday-first and is a reliable source of off-by-one bugs, so the
 * conversion lives in exactly one place — `mondayFirstWeekday` in `domain/time/days.ts`
 * — and is never written inline.
 */
export interface DayPattern {
  /** 0 = Monday … 6 = Sunday. */
  weekday: number
  /** Contracted minutes for that weekday. 0 means a non-working day (0003 CT5). */
  minutes: number
}

export interface ContractPeriod {
  id: string
  /** The scope. Required: a contract with no client has nothing to compare against (0003 CT9). */
  clientId: string
  /** Local calendar date, inclusive (0003 §ContractPeriod). */
  effectiveFrom: string
  /** Local calendar date, inclusive. Null = open-ended (0003 CT1). */
  effectiveTo: string | null
  /** Weekly contracted total, in integer minutes (0003 P6). */
  minutesPerWeek: number
  /** One entry per weekday, Monday-first (0003 CT2). */
  workPattern: DayPattern[]
  createdAt: string
  updatedAt: string
  /** Tombstone for sync (0012 M6). */
  deletedAt: string | null
}
