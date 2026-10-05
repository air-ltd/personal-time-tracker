import { useEffect, useState } from 'react'
import { readDefaultCurrency } from '../../storage/settingsRepo'
import { useRevision } from '../../storage/useRevision'

/**
 * The app-wide default currency (0003 CU4, item 31 of `SPECS/todo.md`).
 *
 * Exists because three components need it for the same reason — a currency to resolve
 * *against* when the entry, project and client have not said otherwise — and each one
 * grew its own copy of the read. They drifted: two of them fell back to a hardcoded
 * `GBP` and one to a hardcoded `USD`, so the app default was ignored in both, and a rate
 * preview could quote `£` for a record that would be billed in `JPY`.
 *
 * Subscribes to the revision counter, so changing the default on the settings page
 * updates every open form without a reload. Returns null until the read resolves,
 * which is exactly what `resolveCurrency` wants for "not configured yet" — it falls
 * through to its own documented last resort rather than rendering a wrong answer first.
 */
export function useAppDefaultCurrency(): string | null {
  const revision = useRevision()
  const [currency, setCurrency] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void readDefaultCurrency()
      .then((stored) => {
        if (!cancelled) setCurrency(stored)
      })
      // Swallowed deliberately, and null is the right answer for it: the fallback is
      // `resolveCurrency`'s documented last resort, and an unhandled rejection here
      // would fail a whole test file on an error nothing displays.
      .catch(() => {
        if (!cancelled) setCurrency(null)
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  return currency
}
