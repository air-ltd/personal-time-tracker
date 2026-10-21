import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ContractSettings } from './ContractSettings'
import { installTestDb } from '../../test/harness'
import { listContractPeriods } from '../../storage/contractPeriodRepo'
import type { Client } from '../../domain/taxonomy/types'

const CLIENT: Client = {
  id: 'c1',
  name: 'Acme Ltd',
  colour: '#123456',
  defaultRateMinor: 10000,
  currency: 'GBP',
  archived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
}

const NOW = new Date('2026-10-14T12:00:00.000Z')

describe('the expected-hours panel', () => {
  beforeEach(() => {
    installTestDb()
  })

  it('says so when a client has no expected hours, rather than showing a figure', async () => {
    render(<ContractSettings clients={[CLIENT]} now={NOW} />)

    await waitFor(() => expect(screen.getByText('No expected hours set')).toBeTruthy())
  })

  it('saves a budget and shows it on the row', async () => {
    const user = userEvent.setup()
    render(<ContractSettings clients={[CLIENT]} now={NOW} />)

    await user.click(await screen.findByRole('button', { name: 'Set hours' }))
    await user.clear(screen.getByLabelText('Hours expected per week'))
    await user.type(screen.getByLabelText('Hours expected per week'), '20')
    await user.click(screen.getByRole('button', { name: 'Save expected hours' }))

    await waitFor(() => expect(screen.getByText('20 hours a week')).toBeTruthy())

    const stored = await listContractPeriods(CLIENT.id)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.minutesPerWeek).toBe(1200)
    // Monday to Friday at 240 minutes each.
    expect(stored[0]?.workPattern.find((entry) => entry.weekday === 0)?.minutes).toBe(240)
    expect(stored[0]?.workPattern.find((entry) => entry.weekday === 5)?.minutes).toBe(0)
  })

  it('refuses an uneven split and asks for the days instead (0003 CT8)', async () => {
    const user = userEvent.setup()
    render(<ContractSettings clients={[CLIENT]} now={NOW} />)

    await user.click(await screen.findByRole('button', { name: 'Set hours' }))
    await user.clear(screen.getByLabelText('Hours expected per week'))
    // The spec's own example: 2,250 minutes over four days is 562.5, and rounding it
    // would make the pattern stop summing to the week (0003 CT3).
    await user.type(screen.getByLabelText('Hours expected per week'), '37.5')
    await user.click(screen.getByRole('checkbox', { name: /Fri/ }))

    await waitFor(() =>
      expect(screen.getByText(/does not divide evenly across 4 days/)).toBeTruthy(),
    )
    expect(screen.getByLabelText('Monday hours')).toBeTruthy()
  })

  it('does not save an uneven split', async () => {
    const user = userEvent.setup()
    render(<ContractSettings clients={[CLIENT]} now={NOW} />)

    await user.click(await screen.findByRole('button', { name: 'Set hours' }))
    await user.clear(screen.getByLabelText('Hours expected per week'))
    await user.type(screen.getByLabelText('Hours expected per week'), '37.5')
    await user.click(screen.getByRole('checkbox', { name: /Fri/ }))
    await user.click(screen.getByRole('button', { name: 'Save expected hours' }))

    // Nothing is stored: a pattern that does not sum to the week is refused rather
    // than quietly preferred (0003 CT3).
    await waitFor(async () => expect(await listContractPeriods(CLIENT.id)).toHaveLength(0))
  })

  it('starts a new contract at the beginning of the current week', async () => {
    const user = userEvent.setup()
    render(<ContractSettings clients={[CLIENT]} now={NOW} />)

    await user.click(await screen.findByRole('button', { name: 'Set hours' }))
    // 2026-10-14 is a Wednesday, so the week began on Monday the 12th.
    const startField = screen.getByLabelText<HTMLInputElement>('Starting from')
    expect(startField.value).toBe('2026-10-12')

    await user.clear(screen.getByLabelText('Hours expected per week'))
    await user.type(screen.getByLabelText('Hours expected per week'), '20')
    await user.click(screen.getByRole('button', { name: 'Save expected hours' }))

    await waitFor(async () => {
      const stored = await listContractPeriods(CLIENT.id)
      expect(stored[0]?.effectiveFrom).toBe('2026-10-12')
    })
  })
})
