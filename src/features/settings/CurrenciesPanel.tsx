import { useCallback, useState } from 'react'
import { CurrencySelect } from '../taxonomy/CurrencySelect'
import { CurrencyPreferences } from '../taxonomy/CurrencyPreferences'
import { useAppDefaultCurrency } from './useAppDefaultCurrency'
import { writeDefaultCurrency } from '../../storage/settingsRepo'
import { FALLBACK_CURRENCY } from '../../domain/taxonomy/money'

/**
 * Both currency settings, in one panel.
 *
 * The default currency used to be rendered inside `TaxonomySettings`, under its own
 * "Default currency" heading, while the list of currencies to *offer* lived in a separate
 * panel. Two answers to "where do I set my currencies?", in two panels, one of them filed
 * under taxonomy — where it does not belong, since it is not a record and its own hook was
 * already in `features/settings`. The panel is named "Currencies" and the two settings are
 * siblings inside it.
 */
export function CurrenciesPanel() {
  const defaultCurrency = useAppDefaultCurrency()

  /*
   * A local copy of the error, because this panel has no shared error banner to write to.
   * `TaxonomySettings` had one; this is what replacing it means, and it is small enough that
   * a second error channel on the same page would be worse than one.
   */
  const [error, setError] = useState<string | null>(null)
  const report = useCallback((problem: unknown) => {
    setError(problem instanceof Error ? problem.message : String(problem))
  }, [])

  return (
    <section className="panel" aria-labelledby="currencies-heading">
      <h2 id="currencies-heading">Currencies</h2>

      {/* 0003 CU4: the last link in the resolution chain, for client-less work. */}
      <div className="settings-block">
        <h3>Default currency</h3>
        <CurrencySelect
          label="Currency for work with no client"
          inheritLabel={`Not set — fall back to ${FALLBACK_CURRENCY}`}
          value={defaultCurrency}
          // No local copy: `writeDefaultCurrency` bumps the revision and the hook re-reads on
          // that. A second copy of this value in component state is the thing 0002 S2 exists
          // to avoid, and it is how the value on screen and the value being resolved could
          // come to disagree.
          onChange={(code) => {
            setError(null)
            void writeDefaultCurrency(code).catch(report)
          }}
        />
        <p className="hint">
          Reports show money in the project&rsquo;s currency, then the client&rsquo;s, then this
          one.
        </p>
        {error !== null && (
          <p className="alert alert-error" role="alert" data-testid="currency-error">
            {error}{' '}
            <button type="button" className="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </p>
        )}
      </div>

      {/*
        The visible-currency list brings its own `Currencies` heading, which is what made the
        old `aria-label="Currencies"` on this section a duplicate: two identical names for one
        region, announced one after the other, with nothing to tell them apart. The inner
        heading is now the only one — it names the list, and this panel names the subject.
      */}
      <CurrencyPreferences />
    </section>
  )
}
