import { useId, useState } from 'react'
import {
  MIN_CHART_CONTRAST,
  PALETTE,
  assessColour,
  normaliseColour,
} from '../../domain/taxonomy/colour'

/**
 * Colour picker (0005 P3–P4).
 *
 * The palette is the default and the primary affordance; a free hex field exists because
 * 0005 P3 permits an override. What the picker will not do is hide the consequence: as
 * soon as a colour is typed by hand, the measured contrast against both chart backgrounds
 * is shown, including when it fails.
 *
 * A warning rather than a rejection, on purpose. The spec allows the override, so
 * forbidding it would be implementing a different product — but the user gets the actual
 * measured number rather than a vague complaint, because a chart that fails contrast is
 * worse for someone who did not know to look.
 */

export interface ColorPickerProps {
  /** `#rrggbb`. Anything unparseable is reported rather than silently defaulted. */
  value: string
  onChange: (colour: string) => void
  /** Names the group, e.g. "Project colour". */
  label: string
  /** Palette entries already used elsewhere, so the default is visibly distinct. */
  takenColours?: readonly string[]
}

export function ColorPicker({ value, onChange, label, takenColours = [] }: ColorPickerProps) {
  const [custom, setCustom] = useState(false)
  // Kept apart from `value`: the hex field is a separate thing being typed into, and
  // binding it straight to `value` meant choosing "+" pre-filled it with the palette
  // colour currently in use, so typing appended to "#2e6aae" and could never form a valid
  // hex value.
  const [customText, setCustomText] = useState('')
  const groupId = useId()
  const normalised = normaliseColour(value)
  const assessment = normalised === null ? null : assessColour(normalised)
  /*
   * Whether the current colour is one of the offered swatches.
   *
   * A `Set` rather than `PALETTE.includes(colour as never)`. The cast was working around
   * the palette being a readonly tuple of literal types, so `includes` demands one of
   * those exact literals and a `string` does not qualify — and `as never` silenced it by
   * disabling the check that was the point. It also meant the answer was decided by an
   * assertion rather than a comparison.
   */
  const offPalette = normalised !== null && !new Set<string>(PALETTE).has(normalised)

  return (
    <fieldset className="colour-picker">
      <legend>{label}</legend>

      <div className="swatches" role="radiogroup" aria-label={label}>
        {PALETTE.map((colour) => {
          const taken = takenColours.includes(colour)
          const selected = normalised === colour
          return (
            <label
              key={colour}
              className={`swatch${selected ? ' swatch-selected' : ''}${taken ? ' swatch-taken' : ''}`}
              style={{ '--swatch': colour } as React.CSSProperties}
            >
              {/*
               * A radio rather than a button: one choice from a set, arrow-key navigable,
               * screen-reader announced as "Acme colour, 3 of 12". A button per swatch would need
               * `aria-pressed` managed by hand and would not be one tab stop.
               */}
              <input
                type="radio"
                name={groupId}
                value={colour}
                checked={selected}
                onChange={() => {
                  onChange(colour)
                  setCustom(false)
                  setCustomText('')
                }}
              />
              <span className="visually-hidden">{`${label}: ${colour}`}</span>
              {taken && <span className="visually-hidden"> (already used)</span>}
            </label>
          )
        })}

        <label className={`swatch swatch-custom${custom ? ' swatch-selected' : ''}`}>
          <input
            type="radio"
            name={groupId}
            value="custom"
            checked={custom || normalised === null || offPalette}
            onChange={() => {
              setCustom(true)
              // Pre-fill only a colour that is genuinely off-palette; a palette value is
              // not what the user is here to change, so starting from it just gets in the way.
              setCustomText(offPalette ? value : '')
            }}
          />
          <span aria-hidden="true">+</span>
          <span className="visually-hidden">{`${label}: custom`}</span>
        </label>
      </div>

      {custom && (
        <div className="colour-custom">
          <label htmlFor={`${groupId}-hex`}>Custom colour</label>
          <input
            id={`${groupId}-hex`}
            type="text"
            inputMode="text"
            placeholder="#1f5fbf"
            value={customText}
            onChange={(event) => {
              setCustomText(event.target.value)
              onChange(event.target.value)
            }}
            aria-describedby={`${groupId}-assessment`}
          />
          {/*
            Always one line, for the same reason as the rate field: this element is the
            input's `aria-describedby` target, so it must not come and go, and a block
            that appears mid-typing shifts whatever sits below it — including a button the
            user is about to press.
          */}
          <p
            id={`${groupId}-assessment`}
            className={
              assessment === null ? 'hint' : assessment.ok ? 'hint' : 'alert alert-warning'
            }
            data-testid="colour-assessment"
            role={assessment !== null && !assessment.ok ? 'status' : undefined}
          >
            {assessment === null
              ? customText.trim() === ''
                ? 'Enter a hex colour, for example #1f5fbf.'
                : 'That is not a colour. Use #rrggbb, for example #1f5fbf.'
              : assessment.ok
                ? `Contrast ${assessment.lightRatio.toFixed(2)}:1 light, ${assessment.darkRatio.toFixed(2)}:1 dark.`
                : `Low contrast: ${assessment.lightRatio.toFixed(2)}:1 light, ${assessment.darkRatio.toFixed(2)}:1 dark. Below ${MIN_CHART_CONTRAST}:1, so this colour will be hard to see in charts.`}
          </p>
        </div>
      )}
    </fieldset>
  )
}
