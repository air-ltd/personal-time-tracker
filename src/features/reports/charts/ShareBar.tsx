import { useId } from 'react'

/**
 * A share bar (0002 CH2) — a breakdown as proportional bars.
 *
 * The horizontal form of a bar chart, for a breakdown by project or client: the
 * names are long and the numbers are shares, so a row per group reads better than a
 * column.
 *
 * As with the bar chart, each row is focusable and carries its own value, and
 * nothing is revealed on hover alone (0002 CH4, 0006 C4, 0010 AC5).
 */
export interface ShareBarDatum {
  /** The group's name. */
  label: string
  /** The group's share of the total, as a percentage. */
  percentage: number
  /** The group's colour, from the shared palette (0002 CH3). */
  colour: string
}

export interface ShareBarProps {
  data: readonly ShareBarDatum[]
  title: string
  /** Formats the value for display. The app's own (0006 C7). */
  format: (percentage: number) => string
}

export function ShareBar({ data, title, format }: ShareBarProps) {
  const titleId = useId()

  return (
    <svg
      className="chart-svg chart-share"
      viewBox={`0 0 640 ${Math.max(1, data.length) * 26 + 8}`}
      role="group"
      aria-labelledby={titleId}
      preserveAspectRatio="xMinYMin meet"
    >
      <title id={titleId}>{title}</title>

      {data.map((datum, index) => {
        const y = index * 26 + 4
        const width = Math.max(0, (datum.percentage / 100) * 500)
        return (
          <g
            key={datum.label}
            className="chart-bar"
            tabIndex={0}
            role="img"
            aria-label={`${datum.label}: ${format(datum.percentage)}`}
          >
            <title>{`${datum.label}: ${format(datum.percentage)}`}</title>
            <rect x={0} y={y} width={500} height={18} className="chart-share-track" />
            <rect x={0} y={y} width={width} height={18} fill={datum.colour} />
            <text x={508} y={y + 13}>
              {format(datum.percentage)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
