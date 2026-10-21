import { useId } from 'react'

/**
 * A bar chart over time (0006 C1, 0002 CH1–CH4).
 *
 * Hand-rolled SVG on a small shared set of primitives, because the data is a handful
 * of numbers and a charting library would be the largest dependency in the project for
 * no benefit (0002 CH1).
 *
 * **Each bar is focusable and carries its own value.** 0002 CH4 requires the
 * primitives to be accessible components rather than opaque paths with a `title`, and
 * 0010 AC5 requires charts to be explorable by keyboard rather than hover-only. A
 * `title` is a hover tooltip, and a hover tooltip is not reachable: so the bar is a
 * focusable element whose accessible name is the label and the value.
 *
 * **Nothing is revealed on hover.** 0006 C4 forbids a value that can only be seen by
 * hovering, so the value is in the accessible name and in the table beside the chart.
 */
export interface BarChartDatum {
  /** The bar's label — a day, a week. */
  label: string
  /** The value, in minutes. */
  minutes: number
  /** The colour, as `#rrggbb`, from the shared palette (0002 CH3). */
  colour: string
}

export interface BarChartProps {
  data: readonly BarChartDatum[]
  /** The axis label, for the screen-reader announcement of the whole chart. */
  title: string
  /** Formats a value for display. The app's own, so the figures match (0006 C7). */
  format: (minutes: number) => string
}

export function BarChart({ data, title, format }: BarChartProps) {
  const titleId = useId()
  const width = 640
  const height = 200
  const padding = { top: 12, right: 12, bottom: 34, left: 44 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const max = Math.max(...data.map((d) => d.minutes), 0)
  const slot = data.length === 0 ? plotWidth : plotWidth / data.length
  const barWidth = Math.max(2, Math.min(36, slot * 0.7))

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-labelledby={titleId}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={titleId}>{title}</title>

      {/*
        The axis. 0002 CH2 names it as one of the shared primitives, and 0006 C7 says
        its formatting must match the rest of the app — so the labels are the same
        numbers the table and the entry list use.
      */}
      <g className="chart-axis" aria-hidden="true">
        <line
          x1={padding.left}
          y1={padding.top + plotHeight}
          x2={padding.left + plotWidth}
          y2={padding.top + plotHeight}
        />
        {max > 0 && (
          <>
            <text x={padding.left - 6} y={padding.top + 6} textAnchor="end">
              {format(max)}
            </text>
            <text x={padding.left - 6} y={padding.top + plotHeight} textAnchor="end">
              {format(0)}
            </text>
          </>
        )}
      </g>

      {data.map((datum, index) => {
        const barHeight = max === 0 ? 0 : (datum.minutes / max) * plotHeight
        const x = padding.left + index * slot + (slot - barWidth) / 2
        const y = padding.top + plotHeight - barHeight
        return (
          <g
            key={datum.label}
            className="chart-bar"
            tabIndex={0}
            role="img"
            aria-label={`${datum.label}: ${format(datum.minutes)}`}
          >
            {/*
              The title is a pointer affordance — a tooltip on hover — and not the
              accessible name. The `aria-label` above is the name, and it is what a
              screen reader announces when the bar is reached.
            */}
            <title>{`${datum.label}: ${format(datum.minutes)}`}</title>
            <rect x={x} y={y} width={barWidth} height={barHeight} fill={datum.colour} />
            <text x={x + barWidth / 2} y={height - 12} textAnchor="middle">
              {datum.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
