import { useId, useState } from 'react'
import {
  formatMinor,
  minorToMajorString,
  parseRateMinor,
} from '../../domain/taxonomy/currencies'

/**
 * Hourly rate input (0003 P3, 0005 P5).
 *
 * The user types major units — "1,250.00" — because that is what a rate is quoted in.
 * The value stored is integer minor units, because that is what money is stored in
 * (0003 P3): a float rate is a rounding bug waiting for an invoice.
 *
 * The displayed text is kept as the user typed it while they are typing, and only
 * reformatted on blur. Normalising on every keystroke moves the caret and fights the
 * user — typing "1250" must not become "1,250.00" before they have finished.
 */

export interface RateFieldProps {
  /** Minor units, or null for no rate configured. */
  value: number | null
  onChange: (minor: number | null) => void
  /** Resolved currency, which decides the exponent and the formatting. */
  currency: string
  label: string
  hint?: string | undefined
}

export function RateField({ value, onChange, currency, label, hint }: RateFieldProps) {
  const id = useId()
  const [text, setText] = useState(() =>
    value === null ? '' : minorToMajorString(value, currency),
  )
  const [error, setError] = useState<string | null>(null)

  /*
   * Reformat when the currency changes, since that changes what the stored number means:
   * 1100 minor units is £11.00 but ¥1100, so the same stored value needs different text.
   *
   * Adjusted during render rather than in an effect. An effect fires *after* paint, so
   * the field would briefly show the old figure in the old currency — exactly the kind of
   * transient wrongness the loading-flash fix in this codebase was about. This is React's
   * documented pattern for deriving state from props.
   *
   * Keyed on the currency and not on the value, deliberately: `onChange` writes the value
   * back on blur, so syncing on every value change would reformat the field in response to
   * the user's own keystrokes.
   */
  const [syncedCurrency, setSyncedCurrency] = useState(currency)
  if (syncedCurrency !== currency) {
    setSyncedCurrency(currency)
    setText(value === null ? '' : minorToMajorString(value, currency))
  }

  function commit() {
    if (text.trim() === '') {
      onChange(null)
      setError(null)
      return
    }
    const parsed = parseRateMinor(text, currency)
    if (parsed === null) {
      setError('That is not an amount.')
      return
    }
    setError(null)
    // 0 is a real rate and is kept as one rather than collapsed to null, so a deliberate
    // zero rate is distinguishable from no rate at all.
    onChange(parsed)
    setText(minorToMajorString(parsed, currency))
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        placeholder={
          value === null ? `No rate — e.g. ${minorToMajorString(10000, currency)}` : undefined
        }
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        aria-describedby={hint ? `${id}-hint` : undefined}
        aria-invalid={error === null ? undefined : true}
      />
      {/*
        Always rendered, even with no hint, so the field keeps a constant height. See
        `.rate-feedback` for why a line appearing on blur is worse than a wasted line.
      */}
      <p id={`${id}-hint`} className="hint">
        {hint ?? '\u00a0'}
      </p>
      {/*
        Exactly one of these three lines is always rendered, so the field never changes
        height.

        This is not cosmetic. The rate is committed on blur, so the "Stored as …" line
        appears at the moment focus leaves the field — which is the same moment the user is
        reaching for Save. A button that moves under the pointer as it is being pressed
        does not get pressed: the mouse goes down on it and comes up a line lower, the
        click never fires, and the form silently does not submit. Reserve the space and the
        button stays where it was put.
      */}
      <div className="rate-feedback">
        {error !== null ? (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        ) : value !== null ? (
          <p className="hint" data-testid="rate-formatted">
            Stored as {formatMinor(value, currency)} per hour.
          </p>
        ) : (
          <p className="hint">Leave empty for no rate.</p>
        )}
      </div>
    </div>
  )
}
