import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { BarChart } from './BarChart'
import { ShareBar } from './ShareBar'
import { ChartFrame } from './ChartFrame'

/**
 * The chart primitives (0002 CH1–CH4, 0006 C1–C7).
 *
 * The requirements these tests exist for are accessibility ones, and they are the
 * kind that are easy to state and easy to lose: a chart that is a picture of the
 * data rather than the data, a value that can only be seen by hovering, a table
 * equivalent that cannot be reached.
 */

describe('a bar chart', () => {
  const data = [
    { label: '05', minutes: 120, colour: '#2e6aae' },
    { label: '06', minutes: 300, colour: '#f20d2b' },
  ]

  it('gives each bar a name that says what it is', () => {
    // 0002 CH4: the primitives must be accessible components rather than opaque
    // paths with a title. 0010 AC5: reachable by keyboard rather than hover-only.
    render(<BarChart title="Time by day" data={data} format={(m) => `${m}m`} />)
    const bar = screen.getByRole('img', { name: /06: 300m/ })
    expect(bar.getAttribute('tabindex')).toBe('0')
  })

  it('names the whole chart', () => {
    render(<BarChart title="Time by day" data={data} format={(m) => `${m}m`} />)
    expect(screen.getByRole('group', { name: 'Time by day' })).toBeTruthy()
  })
})

describe('a share bar', () => {
  it('gives each row a name that says what it is', () => {
    render(
      <ShareBar
        title="Where the time went"
        data={[{ label: 'Acme Ltd', percentage: 62.5, colour: '#2e6aae' }]}
        format={(p) => `${p}%`}
      />,
    )
    expect(screen.getByRole('img', { name: 'Acme Ltd: 62.5%' })).toBeTruthy()
  })
})

describe('the frame around a chart', () => {
  const table = (
    <table>
      <tbody>
        <tr>
          <td>one figure</td>
        </tr>
      </tbody>
    </table>
  )

  it('offers a table equivalent behind a button (0006 C3, 0010 AC4)', async () => {
    const user = userEvent.setup()
    render(
      <ChartFrame
        title="Time by day"
        description="How much was tracked."
        empty={false}
        table={table}
      >
        <svg role="group" aria-label="the chart" />
      </ChartFrame>,
    )

    // The table is in the document from the start — it is a sibling of the chart,
    // not a description of it — and the button is what switches between them.
    expect(
      screen.getByRole('button', { name: 'Show table' }).getAttribute('aria-expanded'),
    ).toBe('false')

    await user.click(screen.getByRole('button', { name: 'Show table' }))
    expect(
      screen.getByRole('button', { name: 'Show chart' }).getAttribute('aria-expanded'),
    ).toBe('true')
  })

  it('says so when there is nothing to show, rather than drawing an empty frame (0006 C6)', async () => {
    render(
      <ChartFrame
        title="Time by day"
        description="How much was tracked."
        empty={true}
        table={table}
      >
        <svg role="group" aria-label="the chart" />
      </ChartFrame>,
    )

    await waitFor(() =>
      expect(screen.getByText(/There is nothing to show for this period/)).toBeTruthy(),
    )
    // And no empty chart frame standing there instead.
    expect(screen.queryByRole('group', { name: 'the chart' })).toBeNull()
  })
})
