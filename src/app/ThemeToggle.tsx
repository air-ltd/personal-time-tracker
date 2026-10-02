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
  return (
    // A radio group rather than a cycling button: all three options stay visible,
    // and the current one is exposed to assistive tech rather than only implied
    // by button text (0010 AC1).
    <fieldset className="theme-toggle">
      <legend className="visually-hidden">Colour theme</legend>
      {OPTIONS.map((option) => {
        const id = `theme-${option}`
        return (
          <span key={option} className="theme-toggle-option">
            <input
              type="radio"
              id={id}
              name="theme"
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
