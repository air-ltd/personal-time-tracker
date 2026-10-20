import { useEffect, useState } from 'react'
import { listAllContractPeriods } from '../../storage/contractPeriodRepo'
import type { ContractPeriod } from '../../domain/capacity/types'
import { useRevision } from '../../storage/useRevision'

/**
 * Reactive read of the contract periods.
 *
 * The same shape and the same reasoning as `useTaxonomy`: IndexedDB is the source of
 * truth, so this holds no independent copy and re-reads when the repository bumps the
 * revision. A write to a contract bumps the revision, so the panel updates without any
 * cross-component messaging.
 */
export interface Contracts {
  periods: ContractPeriod[]
  loading: boolean
  /** Why the read failed, if it did. */
  error: string | null
}

export function useContracts(): Contracts {
  const revision = useRevision()
  const [periods, setPeriods] = useState<ContractPeriod[]>([])
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void listAllContractPeriods()
      .then((loaded) => {
        if (cancelled) return
        setPeriods(loaded)
        setError(null)
        setLoadedOnce(true)
      })
      .catch((problem: unknown) => {
        if (cancelled) return
        setError(problem instanceof Error ? problem.message : String(problem))
        setLoadedOnce(true)
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  // A failed read is not "still loading" — reporting it as such would leave the panel
  // on a spinner next to the error explaining that it has stopped.
  return { periods, loading: !loadedOnce && error === null, error }
}
