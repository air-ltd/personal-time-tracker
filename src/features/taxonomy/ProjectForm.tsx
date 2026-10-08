import { useState } from 'react'
import { ColorPicker } from './ColorPicker'
import { CurrencySelect } from './CurrencySelect'
import { RateField } from './RateField'
import { suggestColour } from '../../domain/taxonomy/colour'
import { currencyLabel } from '../../domain/taxonomy/currencies'
import { resolveCurrency } from '../../domain/taxonomy/money'
import type { Client, Project } from '../../domain/taxonomy/types'

/**
 * The project fields, for both creating and editing.
 *
 * Extracted because the project form had been written out twice — once in the section's
 * create panel and once in the row's edit panel — and the two copies had already drifted
 * on exactly the parts nobody checks: the create copy passed `takenColours` to the colour
 * picker and supplied the rate hint, the edit copy passed neither, and only the create copy
 * reset its fields on success. Each also computed the rate's currency from a chain
 * character-for-character identically, which is the kind of duplication that survives
 * review because both copies look right.
 *
 * The two differ in wrapper and in one behaviour, and both differences are kept rather than
 * smoothed over:
 *
 * - Create is a real `<form>`, so Enter submits and the browser applies `required` to the
 *   name. Edit is a `<div>`, because the row it replaces is already inside the section and a
 *   nested form would not submit.
 * - Only the create path clears the fields afterwards, since editing ends the edit.
 */
export interface ProjectFormProps {
  /** Absent for a new project, and its presence is what decides create or edit. */
  project?: Project | undefined
  clients: Client[]
  /** The app default, the last link in the rate's currency chain. */
  defaultCurrency: string | null
  /** Colours already in use, so a new project's is visibly distinct (0005 P4). */
  takenColours: readonly string[]
  /** `''` for the create form, the project id for the edit form. */
  idPrefix: string
  /**
   * The client to preselect when creating from that client's own row.
   *
   * Ignored when editing: a record's stored client is its client, and an edit that silently
   * re-homed the project would be a data change nobody asked for.
   */
  initialClientId?: string | undefined
  report: (problem: unknown) => void
  onSubmit: (fields: ProjectFields) => Promise<void>
  onCancel: () => void
}

/** What the form collects; `clientId: null` is internal work, not "unset". */
export interface ProjectFields {
  name: string
  clientId: string | null
  defaultRateMinor: number | null
  currency: string | null
  colour: string
}

export function ProjectForm({
  project,
  clients,
  defaultCurrency,
  takenColours,
  idPrefix,
  initialClientId,
  report,
  onSubmit,
  onCancel,
}: ProjectFormProps) {
  const creating = project === undefined
  const [name, setName] = useState(project?.name ?? '')
  /*
   * Seeded from `initialClientId` when the form was opened from a client's own row (item 55),
   * so adding work under a client does not mean picking that client out of a dropdown that
   * already lists the client you clicked. The select stays editable: a wrong button press
   * should be recoverable, and locking it would also make internal work unreachable from
   * here.
   */
  const [clientId, setClientId] = useState<string | null>(
    project?.clientId ?? initialClientId ?? null,
  )
  const [rate, setRate] = useState<number | null>(project?.defaultRateMinor ?? null)
  const [currency, setCurrency] = useState<string | null>(project?.currency ?? null)

  /**
   * A new project's colour, seeded from the ones already in use.
   *
   * `suggestColour([])` short-circuits to `PALETTE[0]`, so seeding from an empty list gave
   * every new project the same blue — and `takenColours` was threaded all the way here for
   * the picker, where it did nothing but exclude options. An edit keeps the record's own
   * colour, which is why its own colour joins the taken list rather than replacing it.
   */
  const [colour, setColour] = useState<string>(
    () => project?.colour ?? suggestColour(takenColours),
  )

  const client = clients.find((c) => c.id === clientId) ?? null
  /*
   * The rate field needs a currency to know the exponent, so it follows the same chain the
   * saved record will resolve by: what this form has picked, then the client, then the app
   * default. It used to end at a hardcoded `GBP`, so a user whose default is JPY was shown
   * a rate in pounds and saved a rate that is interpreted in yen.
   */
  const effectiveCurrency = resolveCurrency({ currency }, client, defaultCurrency).code

  async function save(): Promise<void> {
    try {
      await onSubmit({ name, clientId, defaultRateMinor: rate, currency, colour })
      if (!creating) return
      setName('')
      setRate(null)
      setCurrency(null)
      /*
       * The colour was the one field the create flow did not reset, so the second project
       * silently reused the first one's — and the third, and so on. Two projects the same
       * colour is a chart that needs its legend decoded, which is what 0005 P3 exists to
       * prevent.
       *
       * Composed against the colour just used rather than re-read from props: the reload
       * that brings the new project back has not happened yet, so `takenColours` is still
       * the list from before it and a plain re-suggest would see it as empty.
       */
      const justUsed = colour
      setColour((previous) => suggestColour([...takenColours, previous, justUsed]))
    } catch (problem) {
      report(problem)
    }
  }

  const nameFieldId = `${idPrefix}-name`
  const clientFieldId = `${idPrefix}-client`

  const fields = (
    <>
      <div className="field">
        <label htmlFor={nameFieldId}>Project name</label>
        <input
          id={nameFieldId}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          // Only create: an edit is triggered by its own button, and browser validation
          // there would surface as a bubble the row's layout has nowhere to put.
          required={creating}
        />
      </div>
      <div className="field">
        <label htmlFor={clientFieldId}>Client</label>
        <select
          id={clientFieldId}
          value={clientId ?? ''}
          onChange={(e) => setClientId(e.target.value || null)}
        >
          {/* 0005 R1/U1: no client is a legitimate state, so it is offered as a choice
              rather than being an absent option. */}
          <option value="">No client — internal work</option>
          {clients
            .filter((c) => !c.archived)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </div>
      <RateField
        label="Default hourly rate"
        currency={effectiveCurrency}
        value={rate}
        onChange={setRate}
        // Always supplied, so the line is already there when the rate commits: a hint that
        // appears the moment focus leaves the field moves the button under the pointer
        // mid-click. See the note on `.rate-feedback`.
        hint={
          rate === null
            ? 'A rate here makes new entries for this project billable.'
            : 'Entries for this project will default to billable.'
        }
      />
      <CurrencySelect
        label="Currency override"
        inheritLabel={
          client ? `Use the client’s ${currencyLabel(client.currency)}` : 'Use the default'
        }
        value={currency}
        onChange={setCurrency}
      />
      <ColorPicker
        label="Project colour"
        value={colour}
        onChange={setColour}
        {...(creating ? { takenColours } : {})}
      />
      <div className="button-row">
        {creating ? (
          <button type="submit" className="button button-primary">
            Add project
          </button>
        ) : (
          <button type="button" className="button button-primary" onClick={() => void save()}>
            Save
          </button>
        )}
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  )

  if (creating) {
    return (
      <form
        className="taxonomy-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {fields}
      </form>
    )
  }

  return <div className="taxonomy-edit">{fields}</div>
}
