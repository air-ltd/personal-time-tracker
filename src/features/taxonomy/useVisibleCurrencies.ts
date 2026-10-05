import { useCallback, useEffect, useState } from 'react'
import { readVisibleCurrencies, writeVisibleCurrencies } from '../../storage/settingsRepo'
import { useRevision } from '../../storage/useRevision'

/**
 * The currencies offered in pickers (item 13 of `SPECS/todo.md`).
 *
 * The ISO 4217 list runs to over 180 entries, nearly all of them currencies this user
 * will never invoice in. Narrowing the list is a display preference about *this* user,
 * not data about their work, so it sits alongside the app default currency in `meta`
 * rather than on the records themselves.
 *
 * `null` means "not narrowed" and offers everything. That is deliberately distinct from
 * an empty array, which would offer nothing at all.
 */
export interface VisibleCurrencies {
  /** Null until loaded, and after the user chooses to see everything again. */
  codes: string[] | null
  set: (codes: readonly string[] | null) => void
}

export function useVisibleCurrencies(): VisibleCurrencies {
  const revision = useRevision()
  const [codes, setCodes] = useState<string[] | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void readVisibleCurrencies()
      .then((stored) => {
        if (cancelled) return
        setCodes(stored)
        setLoaded(true)
      })
      // A rejected read is swallowed deliberately, and that is safe here because the
      // fallback is "offer everything": a failure to read the preference must not leave
      // every currency picker in the app empty. Without this the rejection is unhandled,
      // which fails a whole test file on an error it does not otherwise show.
      .catch(() => {
        if (cancelled) return
        setCodes(null)
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  const set = useCallback((next: readonly string[] | null) => {
    // Applied optimistically so the picker does not wait on a write it just made. The
    // revision bump re-reads the stored value and confirms it.
    setCodes(next === null ? null : [...next])
    void writeVisibleCurrencies(next)
  }, [])

  return { codes: loaded ? codes : null, set }
}
