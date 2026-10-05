import { useId, useState } from 'react'
import { CurrencySelect } from './CurrencySelect'
import { RateField } from './RateField'
import { ColorPicker } from './ColorPicker'
import { createClientWithDefaultProject, updateClient } from '../../storage/taxonomyRepo'
import { useAppDefaultCurrency } from '../settings/useAppDefaultCurrency'
import { currencyLabel } from '../../domain/taxonomy/currencies'
import { FALLBACK_CURRENCY } from '../../domain/taxonomy/money'
import { suggestColour } from '../../domain/taxonomy/colour'
import type { Client } from '../../domain/taxonomy/types'

/**
 * Create or edit a client.
 *
 * One component because the form appears in two places that must not drift apart: the
 * settings list, and the timer panel's per-client buttons (item 12 of `SPECS/todo.md`).
 * Two copies would mean the "changing a client renames its projects" rule is enforced in
 * one and forgotten in the other.
 *
 * Creating also creates the client's default project, because item 12 wants a timer's
 * time recorded against that project's client by default, and a client with no project
 * cannot be recorded against at all.
 */
export interface ClientFormProps {
  /** Absent for a new client. */
  client?: Client | undefined
  /**
   * Colours already in use, so the default is visibly distinct (0005 P4).
   *
   * Now the seed for a new client's colour as well as the picker's exclusions, which is
   * what it was documented to be. It used to be passed and only used for exclusions, so a
   * new client always opened as `PALETTE[0]`.
   */
  takenColours?: readonly string[]
  now: Date
  onDone: () => void
  report: (problem: unknown) => void
  /** Reported after a successful write, so a caller showing a stored list can re-read. */
  onSaved?: (() => void) | undefined
}

export function ClientForm({
  client,
  takenColours = [],
  now,
  onDone,
  report,
  onSaved,
}: ClientFormProps) {
  const id = useId()
  const [name, setName] = useState(client?.name ?? '')
  /*
   * A new client's currency starts at the app default (item 31), not at a hardcoded GBP.
   *
   * Setting the default currency and then adding a client that ignores it is worse than
   * having no default at all: the user has told the app what they bill in, and every
   * subsequent client has to be corrected by hand.
   *
   * The picked currency is derived, not seeded once. Seeding it in `useState` captured
   * whatever was known on the first render — which is the fallback, because the stored
   * default has not been read yet — and then the late read had nothing to update. That is
   * why it is `picked ?? appDefaultCurrency ?? FALLBACK_CURRENCY` rather than a single
   * initial value.
   */
  const appDefaultCurrency = useAppDefaultCurrency()
  const [picked, setPicked] = useState<string | null>(client?.currency ?? null)
  const currency = picked ?? appDefaultCurrency ?? FALLBACK_CURRENCY

  const [rate, setRate] = useState<number | null>(client?.defaultRateMinor ?? null)
  /**
   * A new client's colour, chosen rather than hardcoded.
   *
   * It was `'#2e6aae'`, which is `PALETTE[0]` written out — so every client ever created
   * opened as the same blue, and a new project opened as the same blue too. `takenColours`
   * is threaded in for exactly this, and had nothing to do.
   */
  const [colour, setColour] = useState(
    () => client?.colour ?? suggestColour(takenColours ?? []),
  )
  // 0005 P8: only worth warning about when editing. On creation there is no history to
  // relabel, so the same warning would be noise.
  const [currencyChanged, setCurrencyChanged] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      if (client) {
        await updateClient(client.id, { name, currency, defaultRateMinor: rate, colour }, now)
      } else {
        await createClientWithDefaultProject({
          name,
          currency,
          defaultRateMinor: rate,
          colour,
          now,
        })
      }
      onSaved?.()
      onDone()
    } catch (problem) {
      report(problem)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="taxonomy-form"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="field">
        <label htmlFor={`${id}-name`}>Client name</label>
        <input
          id={`${id}-name`}
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required={client === undefined}
        />
      </div>

      <CurrencySelect
        label="Billing currency"
        inheritLabel="Choose a currency"
        value={currency}
        onChange={(code) => {
          const next = code ?? FALLBACK_CURRENCY
          setPicked(next)
          if (client !== undefined) setCurrencyChanged(next !== client.currency)
        }}
      />

      <RateField
        label="Default hourly rate"
        currency={currency}
        value={rate}
        onChange={setRate}
        hint="Used by this client's projects unless they set their own."
      />

      <ColorPicker
        label="Client colour"
        value={colour}
        onChange={setColour}
        takenColours={takenColours}
      />

      {/* 0005 P8: historical figures display in the new currency, and the user has to be
          told, because relabelling money already billed retroactively would be worse. */}
      {currencyChanged && (
        <p className="alert alert-warning" role="status" data-testid="currency-change-warning">
          Entries already recorded will display in {currencyLabel(currency)} from now on. Money
          already billed is not rewritten.
        </p>
      )}

      {client === undefined && (
        <p className="hint">
          A project called General is created with this client, so its timer button has
          somewhere to record time.
        </p>
      )}

      <div className="button-row">
        <button
          type="submit"
          className="button button-primary"
          disabled={busy}
          data-testid="client-form-submit"
        >
          {client === undefined ? 'Add client' : 'Save client'}
        </button>
        <button type="button" className="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}
