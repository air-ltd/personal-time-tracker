import { beforeEach, describe, expect, it } from 'vitest'
import { installTestDb } from '../test/harness'
import {
  readDefaultCurrency,
  readEntryPeriod,
  readVisibleCurrencies,
  writeDefaultCurrency,
  writeEntryPeriod,
  writeVisibleCurrencies,
} from './settingsRepo'
import { getDb } from './db'
import { resolveCurrency } from '../domain/taxonomy/money'
import type { Client } from '../domain/taxonomy/types'

/** Any stamp will do: these rows are seeded corrupt, so nothing merges them. */
const SEEDED_AT = new Date('2026-10-13T18:00:00.000Z')

/**
 * App-wide default currency (0003 CU4, CU7).
 *
 * The distinction these tests protect is between "not chosen" and "chosen to be the
 * fallback". Collapsing the two would make the resolution chain lie about where a
 * currency came from, which is the one thing the chain reports back to the UI.
 */

describe('default currency', () => {
  beforeEach(() => {
    installTestDb()
  })

  it('is unset before anything is configured', async () => {
    expect(await readDefaultCurrency()).toBeNull()
  })

  it('round-trips a chosen currency', async () => {
    await writeDefaultCurrency('GBP')
    expect(await readDefaultCurrency()).toBe('GBP')
  })

  it('normalises case and surrounding space', async () => {
    await writeDefaultCurrency('  gbp ')
    expect(await readDefaultCurrency()).toBe('GBP')
  })

  it('clears when given nothing, which is how "inherit" is set', async () => {
    await writeDefaultCurrency('GBP')
    await writeDefaultCurrency('')
    expect(await readDefaultCurrency()).toBeNull()
  })

  it('clears when given null', async () => {
    await writeDefaultCurrency('JPY')
    await writeDefaultCurrency(null)
    expect(await readDefaultCurrency()).toBeNull()
  })

  it('ignores a value that is not a string', async () => {
    // The value column is untyped by design, so a record written by another build can hold
    // anything. Reading it must not hand a number to `Intl` as if it were a code.
    const db = installTestDb()
    await db.settings.put({
      id: 'app-default-currency',
      value: 42,
      updatedAt: SEEDED_AT.toISOString(),
      deletedAt: null,
    })
    expect(await readDefaultCurrency()).toBeNull()
  })

  it('drops a code this runtime cannot offer', async () => {
    // Display tolerates an unknown code; offering it as a choice the user could not
    // re-select would not be.
    const db = installTestDb()
    await db.settings.put({
      id: 'app-default-currency',
      value: 'ZZZ',
      updatedAt: SEEDED_AT.toISOString(),
      deletedAt: null,
    })
    expect(await readDefaultCurrency()).toBeNull()
  })

  it('resolves client-less work against it (0003 CU7)', async () => {
    await writeDefaultCurrency('GBP')
    expect(resolveCurrency(null, null, await readDefaultCurrency())).toEqual({
      code: 'GBP',
      source: 'app-default',
    })
  })

  it('reports the fallback when nothing is configured anywhere', async () => {
    const resolved = resolveCurrency(null, null, await readDefaultCurrency())
    expect(resolved.source).toBe('fallback')
    expect(resolved.code).toBe('USD')
  })

  it('lets a client override the app default', async () => {
    // Precedence, asserted here rather than in the money module because the point is
    // that the *stored* default participates in the chain.
    await writeDefaultCurrency('GBP')
    const client = { currency: 'JPY' } as Client
    expect(resolveCurrency(null, client, await readDefaultCurrency())).toEqual({
      code: 'JPY',
      source: 'client',
    })
  })
})

describe('entry period (item 28)', () => {
  it('defaults to all, so nothing is remembered until something is chosen', async () => {
    expect(await readEntryPeriod()).toBe('all')
  })

  it('round-trips each period', async () => {
    for (const period of ['day', 'week', 'all'] as const) {
      await writeEntryPeriod(period)
      expect(await readEntryPeriod()).toBe(period)
    }
  })

  it('falls back to all for a corrupted value', async () => {
    // A preference that cannot be read must not be able to leave the list in a state
    // nothing can get out of.
    await writeEntryPeriod('day')
    await getDb().settings.put({
      id: 'entry-period',
      value: 'fortnightly',
      updatedAt: SEEDED_AT.toISOString(),
      deletedAt: null,
    })

    expect(await readEntryPeriod()).toBe('all')
  })
})

/**
 * Visible currencies (item 13).
 *
 * The distinction these protect is between "offer everything" and "offer nothing",
 * because they are stored differently and only one of them is a thing a user can mean
 * by leaving a list empty.
 */
describe('visible currencies', () => {
  beforeEach(() => {
    installTestDb()
  })

  it('is unnarrowed before anything is chosen', async () => {
    expect(await readVisibleCurrencies()).toBeNull()
  })

  it('round-trips a narrowed selection', async () => {
    await writeVisibleCurrencies(['GBP', 'JPY'])
    expect(await readVisibleCurrencies()).toEqual(['GBP', 'JPY'])
  })

  it('normalises an empty selection to "offer everything" rather than "offer nothing"', async () => {
    // Written directly, as an older build or a hand-edited database would leave it.
    // Taken literally it leaves every picker in the app offering only the currency each
    // record already had, and the panel gives the user no way to describe that.
    await getDb().settings.put({
      id: 'visible-currencies',
      value: [],
      updatedAt: SEEDED_AT.toISOString(),
      deletedAt: null,
    })

    expect(await readVisibleCurrencies()).toBeNull()
  })

  it('normalises a selection whose codes are all unrecognised', async () => {
    // Every code was dropped, so what remains says nothing — the same case as an empty
    // list, reached a different way.
    await getDb().settings.put({
      id: 'visible-currencies',
      value: ['ZZZ', 'QQQ'],
      updatedAt: SEEDED_AT.toISOString(),
      deletedAt: null,
    })

    expect(await readVisibleCurrencies()).toBeNull()
  })

  it('still narrows when only some codes are unrecognised', async () => {
    await getDb().settings.put({
      id: 'visible-currencies',
      value: ['GBP', 'ZZZ'],
      updatedAt: SEEDED_AT.toISOString(),
      deletedAt: null,
    })

    expect(await readVisibleCurrencies()).toEqual(['GBP'])
  })

  it('deletes the record rather than storing null, so there is one absence', async () => {
    await writeVisibleCurrencies(['GBP'])
    await writeVisibleCurrencies(null)

    expect(await getDb().settings.get('visible-currencies')).toBeUndefined()
  })
})
