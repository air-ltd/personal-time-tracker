import { useMemo, useState } from 'react'
import { buildInvoice } from '../../domain/reports/invoice'
import { formatMinor } from '../../domain/taxonomy/currencies'
import { formatMinutes } from '../../domain/time/duration'
import type { ReportEntry } from '../../domain/reports/report'

/**
 * The invoice (0006 I1–I6).
 *
 * A derived view of a client's billable work over a range. Nothing is stored, so
 * the same data and range always yield the same invoice (0006 I5), and an edited
 * rate changes an old invoice — which is the accepted trade for a personal tool
 * (0006 I6).
 *
 * The line totals sum to the totals exactly (0006 I2). The rounding is applied to
 * the duration once, before the rate is multiplied (0006 RD4), which is what makes
 * that true.
 */
export interface InvoiceViewProps {
  /** The client being invoiced, or null when there is no client to invoice. */
  clientId: string | null
  clientName: string
  entries: readonly ReportEntry[]
  durations: readonly (number | null)[]
  incrementMinutes: number
}

export function InvoiceView({
  clientId,
  clientName,
  entries,
  durations,
  incrementMinutes,
}: InvoiceViewProps) {
  const [open, setOpen] = useState(false)

  const invoice = useMemo(() => {
    if (clientId === null) return null
    const indices = entries
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.clientId === clientId)
      .map(({ index }) => index)
    const clientEntries = indices.map((index) => entries[index] as ReportEntry)
    const clientDurations = indices.map((index) => durations[index] ?? null)
    return buildInvoice(clientName, clientEntries, clientDurations, incrementMinutes)
  }, [clientId, clientName, entries, durations, incrementMinutes])

  if (clientId === null || invoice === null) return null

  if (invoice.lines.length === 0) {
    return (
      <section className="panel" aria-labelledby="invoice-heading">
        <h2 id="invoice-heading">Invoice</h2>
        <p className="hint">
          No billable work for {clientName} in this period, so there is nothing to invoice.
        </p>
      </section>
    )
  }

  return (
    <section className="panel" aria-labelledby="invoice-heading">
      <h2 id="invoice-heading">Invoice — {clientName}</h2>

      {/*
        The invoice is behind a control rather than always on the page, because it is
        the one report a user looks at deliberately. It is still a real section when
        open, and the button says what it will do.
      */}
      <button
        type="button"
        className="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide the invoice' : 'Show the invoice'}
      </button>

      {open && (
        <>
          <table className="capacity-table">
            <caption className="visually-hidden">
              Invoice for {clientName}, grouped by project
            </caption>
            <thead>
              <tr>
                <th scope="col">Description</th>
                <th scope="col">Quantity</th>
                <th scope="col">Rate</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={`${line.description}@${line.rateMinorPerHour}`}>
                  <th scope="row">{line.description}</th>
                  <td>{formatMinutes(line.quantityMinutes)}</td>
                  <td>{formatMinor(line.rateMinorPerHour, line.currency)} per hour</td>
                  <td>{formatMinor(line.totalMinor, line.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {invoice.subtotals.map((subtotal) => (
                <tr key={subtotal.currency}>
                  <th scope="row">Total</th>
                  <td colSpan={3}>{formatMinor(subtotal.totalMinor, subtotal.currency)}</td>
                </tr>
              ))}
            </tfoot>
          </table>

          {/*
            0006 I4 and 0003 CU2: a total that spans two currencies is not a number,
            so the totals are split per currency rather than summed. The rows above
            show one total per currency, and there is no grand total above them.
          */}
          {invoice.subtotals.length > 1 && (
            <p className="hint">
              This invoice spans more than one currency, so the totals are shown separately.
              They are not added together, because a pound and a euro do not make a number.
            </p>
          )}

          <p className="hint">
            Nothing here is stored. It is worked out from your entries each time, so changing a
            rate changes an old invoice — which is the trade for a personal tool, and the reason
            an invoice can be regenerated later and compared.
          </p>
        </>
      )}
    </section>
  )
}
