import { useEffect, useState } from 'react'
import { listEntries } from '../../storage/entriesRepo'
import type { TimeEntry } from '../../domain/entries/types'
import { useRevision } from '../../storage/useRevision'

interface EntriesState {
  entries: TimeEntry[]
  /**
   * True only before the first read of this session.
   *
   * Deliberately not "a read is in flight". Deriving it that way — comparing the revision
   * requested against the revision loaded — makes every write flip it to true, so
   * saving an entry flashed the list back to "Loading…" for as long as IndexedDB took to
   * answer. The entries already on screen stay correct throughout a re-read, because the
   * repository is the source of truth and nothing is cleared; only the first load has
   * nothing to show.
   */
  loading: boolean
  /**
   * Why the read failed, if it did.
   *
   * Without this the catch is missing entirely and a rejected read — IndexedDB blocked in
   * private browsing, a schema that will not open, a quota error — leaves the view on
   * "Loading…" for good. That reads as "still working" rather than "this is broken", shows
   * no error, and suppresses the empty state, so the user is looking at a panel that will
   * never resolve and cannot tell why.
   *
   * `useTaxonomy` documents this exact failure as the reason it has the same field, and the
   * two hooks are siblings reading the same database. This one had the bug its sibling was
   * written to avoid.
   */
  error: string | null
}

/**
 * Reactive read of active entries.
 *
 * IndexedDB is the single source of truth (0002 S2), so this holds no independent copy:
 * it re-reads whenever the repository bumps the revision, and keeps showing the previous
 * entries until the new ones arrive.
 */
export function useEntries(): EntriesState {
  const revision = useRevision()
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void listEntries()
      .then((loaded) => {
        if (cancelled) return
        setEntries(loaded)
        setError(null)
        setLoadedOnce(true)
      })
      .catch((problem: unknown) => {
        if (cancelled) return
        // Also swallowed deliberately, and for the same reason as the neighbouring hooks:
        // an unhandled rejection fails a whole test file on an error nothing displays.
        setError(problem instanceof Error ? problem.message : String(problem))
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  // A failed read is not "still loading", for the reason the field above explains.
  return { entries, loading: !loadedOnce && error === null, error }
}
