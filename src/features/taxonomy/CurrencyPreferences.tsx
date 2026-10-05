import { useId, useMemo, useState } from 'react'
import { currencyName, CURRENCY_CODES } from '../../domain/taxonomy/currencies'
import { useVisibleCurrencies } from './useVisibleCurrencies'

/**
 * Currency preferences (items 13 and 14 of `SPECS/todo.md`).
 *
 * "Allow user to select relevant currencies and hide others", then "make the currency
 * selection list a collapsible display, and default collapsed. The selected currencies
 * should be grouped at the top of the list."
 *
 * Collapsed by default because the list is over 180 entries and the overwhelmingly common
 * case is a user who has already made their choice and is looking at something else. What
 * is chosen stays visible when collapsed, grouped above the rest, because the one thing
 * that must be answerable without expanding anything is "what have I picked".
 *
 * Checkboxes with a filter box rather than a multi-select, since a multi-select gives no
 * way to search a list this long. Nothing is applied until Save: if every click re-filtered
 * every picker in the app, an accidental click would silently remove 179 currencies.
 */
export function CurrencyPreferences() {
  const { codes: stored, set } = useVisibleCurrencies()
  const id = useId()
  const [filter, setFilter] = useState('')
  const [draft, setDraft] = useState<Set<string> | null>(null)
  const [expanded, setExpanded] = useState(false)

  // Null draft means "unmodified", so the stored preference stays the source of truth
  // until something is actually changed. Memoised so the grouping below does not rebuild
  // on every render.
  const chosen = useMemo(() => draft ?? new Set(stored ?? []), [draft, stored])
  const narrowed = stored !== null

  const all = useMemo(
    () =>
      CURRENCY_CODES.map((code) => ({ code, name: currencyName(code) })).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [],
  )

  /**
   * Split into chosen-then-rest, each in name order.
   *
   * Both groups filter by the search box, so a narrowed list still leads with what is
   * already chosen — otherwise searching hides the selection at the top, which is the one
   * thing the grouping was for.
   */
  const { chosenRows, otherRows } = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const matches = (row: { code: string; name: string }) =>
      needle === '' ||
      row.name.toLowerCase().includes(needle) ||
      row.code.toLowerCase() === needle
    return {
      chosenRows: all.filter((row) => matches(row) && chosen.has(row.code)),
      otherRows: all.filter((row) => matches(row) && !chosen.has(row.code)),
    }
  }, [all, chosen, filter])

  const dirty = draft !== null && !sameSet(chosen, new Set(stored ?? []))

  function toggle(code: string): void {
    const next = new Set(chosen)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    setDraft(next)
  }

  return (
    <div className="settings-block">
      <h3>Currencies</h3>
      <p className="hint">
        Every currency picker offers these first. Clear the list, or leave nothing ticked, to go
        back to the full ISO 4217 list.
      </p>

      {expanded && (
        <div className="field">
          <label htmlFor={`${id}-filter`}>Filter currencies</label>
          <input
            id={`${id}-filter`}
            type="search"
            value={filter}
            placeholder="pound, dollar, yen…"
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      )}

      <div className="button-row">
        <button
          type="button"
          className="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls="currency-picker-list"
          data-testid="currency-toggle"
        >
          {expanded ? 'Hide all currencies' : 'Show all currencies'}
        </button>
      </div>

      {!expanded ? (
        <p className="hint" data-testid="currency-collapsed-summary">
          {chosenRows.length === 0
            ? 'No currencies chosen — every picker offers the full list.'
            : `Chosen: ${chosenRows.map((row) => row.code).join(', ')}`}
        </p>
      ) : (
        <fieldset className="currency-picker-list" id="currency-picker-list">
          <legend className="visually-hidden">Currencies to offer</legend>

          <div className="button-row">
            <button
              type="button"
              className="button"
              onClick={() => setDraft(new Set(all.map((row) => row.code)))}
              disabled={chosen.size === all.length}
            >
              Select all
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setDraft(new Set())}
              disabled={chosen.size === 0}
            >
              Clear selection
            </button>
          </div>

          {chosenRows.length > 0 && (
            <section className="currency-group">
              <h4>Chosen</h4>
              <ul className="currency-picker-options">
                {chosenRows.map((row) => (
                  <CurrencyRow
                    key={row.code}
                    code={row.code}
                    name={row.name}
                    chosen={chosen}
                    toggle={toggle}
                  />
                ))}
              </ul>
            </section>
          )}

          <section className="currency-group">
            {chosenRows.length > 0 && <h4>All currencies</h4>}
            {otherRows.length === 0 ? (
              <p className="hint">No currency matches “{filter.trim()}”.</p>
            ) : (
              <ul className="currency-picker-options">
                {otherRows.map((row) => (
                  <CurrencyRow
                    key={row.code}
                    code={row.code}
                    name={row.name}
                    chosen={chosen}
                    toggle={toggle}
                  />
                ))}
              </ul>
            )}
          </section>
        </fieldset>
      )}

      <p className="hint" aria-live="polite" data-testid="currency-choice">
        {narrowed
          ? `${chosen.size} of ${all.length} currencies offered.`
          : `All ${all.length} currencies are offered. Tick the ones you bill in to shorten the pickers.`}
      </p>

      <div className="button-row">
        <button
          type="button"
          className="button button-primary"
          disabled={!dirty}
          // An empty selection means "offer everything", exactly as the hint above
          // says. Storing `[]` instead would be a different thing entirely — every
          // picker in the app would offer only the one currency each record already
          // had — and the panel promises the opposite in the text a user follows to get
          // there. `null` is that promise; the full list is already what `null` means
          // everywhere else, including on read.
          onClick={() =>
            set(chosen.size === 0 || chosen.size === all.length ? null : [...chosen])
          }
        >
          Save currency selection
        </button>
        {narrowed && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setDraft(null)
              set(null)
            }}
          >
            Offer every currency
          </button>
        )}
      </div>
    </div>
  )
}

function CurrencyRow({
  code,
  name,
  chosen,
  toggle,
}: {
  code: string
  name: string
  chosen: Set<string>
  toggle: (code: string) => void
}) {
  return (
    <li>
      <label>
        <input type="checkbox" checked={chosen.has(code)} onChange={() => toggle(code)} />{' '}
        {code} — {name}
      </label>
    </li>
  )
}

/** Order-insensitive comparison, because the order chosen happens to be the check order. */
function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) if (!b.has(value)) return false
  return true
}
