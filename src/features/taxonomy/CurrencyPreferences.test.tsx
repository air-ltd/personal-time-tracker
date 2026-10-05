import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { CurrencyPreferences } from './CurrencyPreferences'
import { CurrencySelect } from './CurrencySelect'
import { installTestDb } from '../../test/harness'
import { readVisibleCurrencies } from '../../storage/settingsRepo'
import { getDb } from '../../storage/db'

/**
 * Currency preferences (items 13 and 14 of `SPECS/todo.md`).
 *
 * The thing worth protecting is that narrowing never makes a picker unusable. Offering
 * fewer currencies is the point; offering a select whose current value is not among the
 * options is a data-loss bug, because saving the form would write something else.
 */

beforeEach(() => {
  installTestDb()
})

function setup() {
  const user = userEvent.setup()
  render(<CurrencyPreferences />)
  return user
}

describe('collapsing (item 14)', () => {
  it('starts collapsed', () => {
    setup()
    expect(screen.getByTestId('currency-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('group', { name: 'Currencies to offer' })).toBeNull()
  })

  it('says so when nothing is chosen, without expanding to show an empty list', () => {
    setup()
    expect(screen.getByTestId('currency-collapsed-summary')).toHaveTextContent(
      /No currencies chosen/i,
    )
  })

  it('expands and collapses again', async () => {
    const user = setup()
    await user.click(screen.getByTestId('currency-toggle'))
    expect(screen.getByRole('group', { name: 'Currencies to offer' })).toBeInTheDocument()

    await user.click(screen.getByTestId('currency-toggle'))
    expect(screen.queryByRole('group', { name: 'Currencies to offer' })).toBeNull()
  })

  it('shows what is chosen while collapsed, so the answer needs no expanding', async () => {
    const user = setup()
    await user.click(screen.getByTestId('currency-toggle'))
    await user.click(screen.getByRole('checkbox', { name: /^GBP/ }))
    await user.click(screen.getByRole('checkbox', { name: /^JPY/ }))
    await user.click(screen.getByRole('button', { name: 'Save currency selection' }))
    await user.click(screen.getByTestId('currency-toggle'))

    expect(screen.getByTestId('currency-collapsed-summary')).toHaveTextContent('GBP')
    expect(screen.getByTestId('currency-collapsed-summary')).toHaveTextContent('JPY')
  })
})

describe('grouping (item 14)', () => {
  it('puts chosen currencies in their own group above the rest', async () => {
    const user = setup()
    await user.click(screen.getByTestId('currency-toggle'))
    await user.click(screen.getByRole('checkbox', { name: /^GBP/ }))

    const chosen = screen.getByRole('group', { name: 'Currencies to offer' })
    const group = within(chosen).getByRole('heading', { name: 'Chosen' })
    const chosenList = group.nextElementSibling as HTMLElement

    expect(within(chosenList).getByText(/GBP/)).toBeInTheDocument()
    // And the unchosen list is a separate group, so the two cannot interleave.
    expect(within(chosen).getByRole('heading', { name: 'All currencies' })).toBeInTheDocument()
  })

  it('keeps the chosen group first even when the list is filtered', async () => {
    const user = setup()
    await user.click(screen.getByTestId('currency-toggle'))
    await user.click(screen.getByRole('checkbox', { name: /^GBP/ }))
    await user.type(screen.getByLabelText('Filter currencies'), 'pound')

    const chosen = screen.getByRole('group', { name: 'Currencies to offer' })
    const headings = within(chosen)
      .getAllByRole('heading')
      .map((node) => node.textContent)
    expect(headings[0]).toBe('Chosen')
  })
})

describe('applying (item 13)', () => {
  it('saves nothing until asked, so a stray click cannot narrow every picker', async () => {
    const user = setup()
    await user.click(screen.getByTestId('currency-toggle'))
    await user.click(screen.getByRole('checkbox', { name: /^GBP/ }))

    expect(await readVisibleCurrencies()).toBeNull()
  })

  it('persists the selection', async () => {
    const user = setup()
    await user.click(screen.getByTestId('currency-toggle'))
    await user.click(screen.getByRole('checkbox', { name: /^GBP/ }))
    await user.click(screen.getByRole('button', { name: 'Save currency selection' }))

    await waitFor(async () => {
      expect(await readVisibleCurrencies()).toEqual(['GBP'])
    })
  })

  it('goes back to offering everything', async () => {
    const user = setup()
    await user.click(screen.getByTestId('currency-toggle'))
    await user.click(screen.getByRole('checkbox', { name: /^GBP/ }))
    await user.click(screen.getByRole('button', { name: 'Save currency selection' }))
    await waitFor(async () => {
      expect(await readVisibleCurrencies()).toEqual(['GBP'])
    })

    await user.click(screen.getByRole('button', { name: /Offer every currency/ }))
    await waitFor(async () => {
      expect(await readVisibleCurrencies()).toBeNull()
    })
  })

  it('treats clearing the list as "offer everything", not as "offer nothing"', async () => {
    // The hint above the list promises exactly this. Storing `[]` would instead leave
    // every picker in the app offering only the currency each record already had — a
    // state reached by following the instructions, and one the user cannot describe.
    //
    // Asserted against the stored record rather than `readVisibleCurrencies()`, which
    // normalises `[]` to `null` on read. Reading back `null` would pass whether the save
    // wrote the right thing or the read repaired it, and the two fail independently —
    // an older build or a hand-edited database has the bad value without this panel.
    const user = setup()
    await user.click(screen.getByTestId('currency-toggle'))
    await user.click(screen.getByRole('checkbox', { name: /^GBP/ }))
    await user.click(screen.getByRole('button', { name: 'Save currency selection' }))
    await waitFor(async () => {
      expect(await readVisibleCurrencies()).toEqual(['GBP'])
    })

    await user.click(screen.getByRole('checkbox', { name: /^GBP/ }))
    await user.click(screen.getByRole('button', { name: 'Save currency selection' }))
    await waitFor(async () => {
      // `settings`, not `meta`: this row moved in schema v4 (SPECS/todo.md item 46).
      // Asserting against `meta` here would have gone quietly vacuous — `meta` no longer
      // holds the row, so "it is undefined" would pass whether or not the untick deleted
      // anything, and the mutation gate is what caught that rather than a failing test.
      expect(await getDb().settings.get('visible-currencies')).toBeUndefined()
    })
  })

  it('treats unticking everything one by one the same way', async () => {
    const user = setup()
    await user.click(screen.getByTestId('currency-toggle'))
    await user.click(screen.getByRole('checkbox', { name: /^GBP/ }))
    await user.click(screen.getByRole('checkbox', { name: /^JPY/ }))
    await user.click(screen.getByRole('button', { name: 'Save currency selection' }))
    await waitFor(async () => {
      expect(await readVisibleCurrencies()).toEqual(['GBP', 'JPY'])
    })

    await user.click(screen.getByRole('checkbox', { name: /^GBP/ }))
    await user.click(screen.getByRole('checkbox', { name: /^JPY/ }))
    await user.click(screen.getByRole('button', { name: 'Save currency selection' }))
    await waitFor(async () => {
      expect(await readVisibleCurrencies()).toBeNull()
    })
  })

  it('leaves the pickers offering everything after a cleared selection', async () => {
    // The end-to-end consequence of the previous test: not "no currencies", which is
    // what the raw stored value would do to a `CurrencySelect`.
    const user: UserEvent = userEvent.setup()
    render(
      <>
        <CurrencyPreferences />
        <CurrencySelect
          label="Billing currency"
          inheritLabel="Choose a currency"
          value="GBP"
          onChange={() => {}}
        />
      </>,
    )
    await user.click(screen.getByTestId('currency-toggle'))
    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    await user.click(screen.getByRole('button', { name: 'Save currency selection' }))

    await waitFor(async () => {
      expect(await readVisibleCurrencies()).toBeNull()
    })
    const options = screen.getAllByRole('option').length
    expect(options).toBeGreaterThan(100)
  })
})

describe('effect on pickers', () => {
  function picker(value: string | null) {
    const user: UserEvent = userEvent.setup()
    render(
      <>
        <CurrencyPreferences />
        <CurrencySelect
          label="Billing currency"
          inheritLabel="Choose a currency"
          value={value}
          onChange={() => {}}
        />
      </>,
    )
    return { user, select: screen.getByLabelText<HTMLSelectElement>('Billing currency') }
  }

  async function narrowTo(user: UserEvent, code: string): Promise<void> {
    await user.click(screen.getByTestId('currency-toggle'))
    await user.click(screen.getByRole('checkbox', { name: new RegExp(`^${code}`) }))
    await user.click(screen.getByRole('button', { name: 'Save currency selection' }))
  }

  it('offers the whole list before anything is chosen', () => {
    const { select } = picker(null)
    expect(select.options.length).toBeGreaterThan(100)
  })

  it('offers only the chosen currencies afterwards', async () => {
    const { user, select } = picker(null)
    await narrowTo(user, 'GBP')

    await waitFor(() => {
      const codes = [...select.options].map((option) => option.value)
      expect(codes).toContain('GBP')
      expect(codes).not.toContain('JPY')
    })
  })

  it('keeps offering a value the filter would hide', async () => {
    // Otherwise the select's value is not among its own options, and saving writes
    // whatever the browser defaults to — a silently changed currency.
    const { user, select } = picker('JPY')
    await narrowTo(user, 'GBP')

    await waitFor(() => {
      const codes = [...select.options].map((option) => option.value)
      expect(codes).toContain('GBP')
      expect(codes).toContain('JPY')
    })
  })
})
