/**
 * The invoice (0006 I1–I6).
 *
 * A derived view: a client, a date range, and line items produced by grouping
 * billable entries by project. Nothing is stored (I6), so the same data and range
 * always yield the same invoice (I5) — and if a rate is edited afterwards, the
 * invoice changes with it. That is the accepted trade for a personal tool.
 *
 * **The line totals sum to the invoice total exactly** (I2). The rounding is applied
 * to the duration once, before the rate is multiplied (RD4), which is what makes the
 * sum reconcile: rounding per line after the multiplication does not.
 */
import { billableDurationMs } from './rounding'
import type { ReportEntry } from './report'

export interface InvoiceLine {
  /** The project's name, used as the line's description. */
  description: string
  /** The rounded billable duration, in minutes (0006 RD2). */
  quantityMinutes: number
  /** The number of entries behind the line. */
  entryCount: number
  /**
   * The rate actually applied, in minor units per hour (0006 I3).
   *
   * The *resolved* rate, not the project's default: an entry with an override bills
   * at the override, and a line that mixed the two would not be a line at all.
   */
  rateMinorPerHour: number
  /** The line total, in minor units. */
  totalMinor: number
  /** The currency the line is in. */
  currency: string
}

export interface InvoiceSubtotal {
  currency: string
  /** The sum of the line totals in this currency. */
  totalMinor: number
}

export interface Invoice {
  /** The client's name, for the heading. */
  clientName: string
  /** The lines, ordered by total descending, then by description. */
  lines: InvoiceLine[]
  /** One subtotal per currency — never a single total across currencies (0003 CU2). */
  subtotals: InvoiceSubtotal[]
  /** The number of billable entries behind the invoice. */
  entryCount: number
}

/**
 * Build an invoice for a client over a range.
 *
 * Only billable entries appear, and only those with a resolved rate: an entry with
 * no rate has no money in it, and putting it on an invoice would be claiming
 * something that is not there.
 *
 * The line items are grouped by project, and a project's line uses the rate of its
 * entries — so an entry with a different override is its own line rather than being
 * averaged into a rate that was never charged (0006 I3).
 */
export function buildInvoice(
  clientName: string,
  entries: readonly ReportEntry[],
  durations: readonly (number | null)[],
  incrementMinutes: number,
): Invoice {
  // The rate and the currency a project bills at, when its entries agree.
  interface LineKey {
    projectId: string
    rateMinorPerHour: number
    currency: string
  }

  const lines = new Map<string, { key: LineKey; quantityMinutes: number; entryCount: number }>()

  entries.forEach((item, index) => {
    if (!item.entry.billable) return
    if (item.amountMinor === null || item.currency === null) return
    const duration = durations[index] ?? null
    if (duration === null) return

    // The rate is the entry's resolved rate. The domain has already resolved it, and
    // an entry with an override must bill at the override.
    const rateMinor = item.rateMinorPerHour
    if (rateMinor === null) return

    const projectId = item.project?.id ?? 'unassigned'
    const key: LineKey = { projectId, rateMinorPerHour: rateMinor, currency: item.currency }
    const mapKey = `${projectId}@${rateMinor}`

    const existing = lines.get(mapKey)
    // The quantity is the *rounded* duration, in minutes, because that is what the
    // line is sold at (0006 I2, RD2). Rounding the duration and then multiplying by
    // the rate is what makes the lines sum to the total exactly (0006 RD4).
    const quantityMinutes = billableDurationMs(duration, incrementMinutes) / 60_000
    if (existing === undefined) {
      lines.set(mapKey, { key, quantityMinutes, entryCount: 1 })
    } else {
      existing.quantityMinutes += quantityMinutes
      existing.entryCount += 1
    }
  })

  const built: InvoiceLine[] = [...lines.values()].map(
    ({ key, quantityMinutes, entryCount }) => ({
      description:
        key.projectId === 'unassigned'
          ? 'Unassigned'
          : (entries.find((item) => item.project?.id === key.projectId)?.project?.name ??
            'Unassigned'),
      quantityMinutes,
      entryCount,
      rateMinorPerHour: key.rateMinorPerHour,
      totalMinor: Math.round((quantityMinutes / 60) * key.rateMinorPerHour),
      currency: key.currency,
    }),
  )

  // Ordered by total descending, then by name — so the same data always yields the
  // same invoice (0006 I5).
  built.sort((a, b) => {
    if (a.totalMinor !== b.totalMinor) return b.totalMinor - a.totalMinor
    return a.description.localeCompare(b.description)
  })

  const subtotals: InvoiceSubtotal[] = []
  for (const line of built) {
    const existing = subtotals.find((row) => row.currency === line.currency)
    if (existing === undefined)
      subtotals.push({ currency: line.currency, totalMinor: line.totalMinor })
    else existing.totalMinor += line.totalMinor
  }

  return {
    clientName,
    lines: built,
    subtotals,
    entryCount: built.reduce((total, line) => total + line.entryCount, 0),
  }
}
