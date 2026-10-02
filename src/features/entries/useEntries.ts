import { useEffect, useState, useSyncExternalStore } from 'react'
import { listEntries } from '../../storage/entriesRepo'
import { getRevision, subscribe } from '../../storage/events'
import type { TimeEntry } from '../../domain/entries/types'

interface Loaded {
  revision: number
  entries: TimeEntry[]
}

interface EntriesState {
  entries: TimeEntry[]
  loading: boolean
}

/**
 * Reactive read of active entries.
 *
 * IndexedDB is the single source of truth (0002 S2), so this holds no independent
 * copy: it re-reads whenever the repository bumps the revision. `loading` is
 * derived from which revision has landed rather than reset inside the effect, so
 * a write does not trigger a cascading render.
 */
export function useEntries(): EntriesState {
  const revision = useSyncExternalStore(subscribe, getRevision, getRevision)
  const [loaded, setLoaded] = useState<Loaded>({ revision: -1, entries: [] })

  useEffect(() => {
    let cancelled = false
    void listEntries().then((entries) => {
      if (!cancelled) setLoaded({ revision, entries })
    })
    return () => {
      cancelled = true
    }
  }, [revision])

  return { entries: loaded.entries, loading: loaded.revision !== revision }
}
