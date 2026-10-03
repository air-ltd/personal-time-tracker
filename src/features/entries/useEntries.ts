import { useEffect, useState, useSyncExternalStore } from 'react'
import { listEntries } from '../../storage/entriesRepo'
import { getRevision, subscribe } from '../../storage/events'
import type { TimeEntry } from '../../domain/entries/types'

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
}

/**
 * Reactive read of active entries.
 *
 * IndexedDB is the single source of truth (0002 S2), so this holds no independent copy:
 * it re-reads whenever the repository bumps the revision, and keeps showing the previous
 * entries until the new ones arrive.
 */
export function useEntries(): EntriesState {
  const revision = useSyncExternalStore(subscribe, getRevision, getRevision)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loadedOnce, setLoadedOnce] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listEntries().then((loaded) => {
      if (cancelled) return
      setEntries(loaded)
      setLoadedOnce(true)
    })
    return () => {
      cancelled = true
    }
  }, [revision])

  return { entries, loading: !loadedOnce }
}
