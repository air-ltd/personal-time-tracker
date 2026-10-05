import { useEffect, useState } from 'react'
import { listClients, listProjects, listTags } from '../../storage/taxonomyRepo'
import type { Client, Project, Tag } from '../../domain/taxonomy/types'
import { useRevision } from '../../storage/useRevision'

/**
 * Reactive read of the taxonomy.
 *
 * The same shape and the same reasoning as `useEntries`: IndexedDB is the source of
 * truth, so this holds no independent copy and re-reads when the repository bumps the
 * revision. Settings writes bump the revision, so an edit is reflected without any
 * cross-component messaging.
 */
export interface Taxonomy {
  projects: Project[]
  clients: Client[]
  tags: Tag[]
  loading: boolean
  /**
   * Why the read failed, if it did.
   *
   * Without this the catch is missing entirely and a rejected read — IndexedDB blocked,
   * a schema that will not open — leaves the panel on "Loading…" for good, which reads as
   * "still working" rather than "this is broken" and gives the user nothing to act on.
   */
  error: string | null
}

/**
 * Read the taxonomy, archived records included.
 *
 * Archived records are always loaded and filtered by the view, not here. A picker wants
 * them hidden by default but reachable via "show archived" (0005 A2), and the settings
 * view is where that control lives — loading without them and re-fetching on toggle
 * would make the same data available under two code paths.
 */
export function useTaxonomy(): Taxonomy {
  const revision = useRevision()
  const [projects, setProjects] = useState<Project[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      listProjects({ includeArchived: true }),
      listClients({ includeArchived: true }),
      listTags(),
    ])
      .then(([loadedProjects, loadedClients, loadedTags]) => {
        if (cancelled) return
        setProjects(loadedProjects)
        setClients(loadedClients)
        setTags(loadedTags)
        setError(null)
        setLoadedOnce(true)
      })
      .catch((problem: unknown) => {
        if (cancelled) return
        setError(problem instanceof Error ? problem.message : String(problem))
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  // A failed read is not "still loading" — reporting it as such would leave the panel on
  // a spinner next to the error explaining that it has stopped.
  return { projects, clients, tags, loading: !loadedOnce && error === null, error }
}
