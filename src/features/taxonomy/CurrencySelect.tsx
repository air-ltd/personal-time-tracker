import { useId } from 'react'
import { currencyOptions, currencyLabel } from '../../domain/taxonomy/currencies'
import { useVisibleCurrencies } from './useVisibleCurrencies'

/**
 * Currency select (0005 P7).
 *
 * Options are labelled "GBP — British Pound" and sorted by currency name, so the
 * picker is navigable without knowing codes. The stored value stays the bare code.
 *
 * `required` is deliberately off and an explicit "inherit" option is offered instead:
 * a project's currency is an override, and forcing a choice would defeat the resolution
 * chain it exists to sit on top of.
 */

export interface CurrencySelectProps {
  value: string | null
  onChange: (code: string | null) => void
  /** Names the group, e.g. "Currency". */
  label: string
  /**
   * Text for the "inherit" option.
   *
   * Supplied by the caller because what is being inherited differs: a project's
   * override inherits from its client, a client's has nothing above it. Naming the
   * fallback currency instead would be a lie — the fallback is only reached when
   * project, client and app default have all declined.
   */
  inheritLabel: string
  /** Whether the stored code should be included even if the runtime no longer lists it. */
  includeUnknown?: boolean
}

export function CurrencySelect({
  value,
  onChange,
  label,
  inheritLabel,
  includeUnknown = true,
}: CurrencySelectProps) {
  const id = useId()
  const { codes: visible } = useVisibleCurrencies()
  const all = currencyOptions()

  // A code restored from a backup can be one this runtime does not list. Dropping it
  // silently would change a stored value on save; offering it keeps what the user chose
  // visible and correctable.
  const missing = value !== null && !all.some((option) => option.code === value)

  // Narrowed to the currencies this user cares about (item 13), but the current value is
  // always kept. Hiding the currency a record already uses would show a select whose
  // value is not in it, which reads as a corrupted record rather than as a filter.
  const options =
    visible === null
      ? all
      : all.filter((option) => visible.includes(option.code) || option.code === value)

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{inheritLabel}</option>
        {missing && includeUnknown && (
          <option value={value ?? ''}>{currencyLabel(value ?? '')} (not recognised)</option>
        )}
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
