import { useCallback, useEffect, useState } from 'react'
import { readEntryPeriod, writeEntryPeriod } from '../../storage/settingsRepo'
import type { Period } from '../../domain/entries/summary'
import { useRevision } from '../../storage/useRevision'

/**
 * The entries period, remembered (item 28).
 *
 * "Entry type (daily/weekly/all) should be remembered." A control that resets on every
 * reload is a control the user sets again every time, which is how a preference ends up
 * ignored.
 *
 * Starts at "all" and adopts the stored value once it reads. The stored value is the one
 * already shown in storage, so nothing waits on it and nothing is lost if the read is slow
 * or fails — the worst case is one frame of the wrong period.
 */
export function useEntryPeriod(): [Period, (next: Period) => void] {
  const revision = useRevision()
  const [period, setPeriod] = useState<Period>('all')

  useEffect(() => {
    let cancelled = false
    void readEntryPeriod()
      .then((stored) => {
        if (!cancelled) setPeriod(stored)
      })
      // Swallowed deliberately: the fallback is "all", which is a usable state, and an
      // unhandled rejection here would fail a whole test file on an error nothing shows.
      .catch(() => {
        if (!cancelled) setPeriod('all')
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  const choose = useCallback((next: Period) => {
    // Applied immediately so the control does not wait on a write it just made; the
    // revision bump re-reads the stored value and confirms it.
    setPeriod(next)
    void writeEntryPeriod(next)
  }, [])

  return [period, choose]
}
