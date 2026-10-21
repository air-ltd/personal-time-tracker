import { useId, useState, type ReactNode } from 'react'

/**
 * The frame every chart sits in (0006 C3, C6, 0002 CH3, 0010 AC4–AC5).
 *
 * **A chart is never the only way to read the data.** 0006 C3 requires an accessible
 * non-visual equivalent — a data table with the same figures — and 0010 AC4 requires
 * the *toggle* to switch between them to be keyboard reachable. A chart alone fails a
 * user who cannot see it, and fails a screen reader outright.
 *
 * So the table is a real sibling of the chart rather than a description of it, and the
 * switch is a `<button>`, which is focusable and activates on Enter and Space without
 * any extra handling.
 *
 * **The chart's own marks are accessible too.** 0002 CH4 requires each primitive to
 * be a component in its own right rather than an opaque `<path>` with a `<title>`,
 * and 0010 AC5 requires charts to be explorable by keyboard rather than hover-only.
 * That is why the bars are focusable and carry their value in an accessible name —
 * a `title` alone is a hover tooltip, and a hover tooltip is not reachable.
 */
export interface ChartFrameProps {
  /** The chart's heading. It names what the chart is about. */
  title: string
  /** A sentence under the heading, for the reader who cannot see the chart. */
  description: string
  /** The chart itself. Hidden from assistive technology when the table is showing. */
  children: ReactNode
  /** The table with the same figures. */
  table: ReactNode
  /** True when there is nothing to draw, so the chart is replaced by a message. */
  empty: boolean
}

export function ChartFrame({ title, description, children, table, empty }: ChartFrameProps) {
  const [showTable, setShowTable] = useState(false)
  const headingId = useId()
  const tableId = useId()

  if (empty) {
    // 0006 C6: an empty state renders an explanatory message, not an empty frame.
    // A blank grid reads as "broken" or "still loading", and both are wrong.
    return (
      <div className="chart-frame">
        <h3 id={headingId}>{title}</h3>
        <p className="hint">{description} There is nothing to show for this period.</p>
      </div>
    )
  }

  return (
    <div className="chart-frame">
      <div className="chart-frame-header">
        <h3 id={headingId}>{title}</h3>
        <button
          type="button"
          className="button"
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable((value) => !value)}
        >
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      <p className="hint">{description}</p>

      {/*
        The chart is hidden from assistive technology when the table is showing, and the
        table when the chart is showing. Both are in the document either way, so the
        toggle is a change of what is *announced*, not of what exists — and a reader
        using a screen reader is handed the table, which is the one that reads.

        The chart is not `display: none` when hidden, because that would remove it from
        the tab order; `aria-hidden` plus the CSS class keeps the marks out of the way
        without leaving focusable things nobody can see.
      */}
      <div className={showTable ? 'chart-hidden' : undefined} aria-hidden={showTable}>
        {children}
      </div>

      <div id={tableId} className={showTable ? undefined : 'chart-hidden'}>
        {table}
      </div>
    </div>
  )
}
