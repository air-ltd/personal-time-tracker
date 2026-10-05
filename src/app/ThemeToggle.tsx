import { useId } from 'react'
import { type ThemePreference } from './theme'

const OPTIONS: readonly ThemePreference[] = ['system', 'light', 'dark']

const LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

interface Props {
  value: ThemePreference
  onChange: (next: ThemePreference) => void
}

export function ThemeToggle({ value, onChange }: Props) {
  const baseId = useId()
  return (
    // A radio group rather than a cycling button: all three options stay visible,
    // and the current one is exposed to assistive tech rather than only implied
    // by button text (0010 AC1).
    <fieldset className="theme-toggle">
      <legend className="visually-hidden">Colour theme</legend>
      {OPTIONS.map((option) => {
        // Scoped by `useId` because the id has to be unique in the document, not merely
        // within this component. A static `theme-light` is fine until there are two
        // toggles — at which point the second one's `<label for>` points at the first
        // one's radio and clicking it changes the wrong one, silently.
        const id = `${baseId}-${option}`
        return (
          <span key={option} className="theme-toggle-option">
            <input
              type="radio"
              id={id}
              // Scoped like the id. `name` decides which radios are one group, so a static
              // value merges two instances into a single control: choosing Light in the
              // second toggle would silently clear the first, because they would be the
              // same group.
              name={`${baseId}-group`}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            <label htmlFor={id}>{LABELS[option]}</label>
          </span>
        )
      })}
    </fieldset>
  )
}
