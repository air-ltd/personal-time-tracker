import { beforeEach, describe, expect, it } from 'vitest'
import { installTestDb } from '../test/harness'
import {
  readDefaultCurrency,
  readEntryPeriod,
  writeDefaultCurrency,
  writeEntryPeriod,
} from './settingsRepo'
import { getDb } from './db'
import { resolveCurrency } from '../domain/taxonomy/money'
import type { Client } from '../domain/taxonomy/types'

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
    // `meta` is untyped by design, so a record written by another build can hold
    // anything. Reading it must not hand a number to `Intl` as if it were a code.
    const db = installTestDb()
    await db.meta.put({ key: 'app-default-currency', value: 42 })
    expect(await readDefaultCurrency()).toBeNull()
  })

  it('drops a code this runtime cannot offer', async () => {
    // Display tolerates an unknown code; offering it as a choice the user could not
    // re-select would not be.
    const db = installTestDb()
    await db.meta.put({ key: 'app-default-currency', value: 'ZZZ' })
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
    await getDb().meta.put({ key: 'entry-period', value: 'fortnightly' })

    expect(await readEntryPeriod()).toBe('all')
  })
})
