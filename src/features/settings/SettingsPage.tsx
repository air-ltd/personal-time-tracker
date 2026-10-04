import { ThemeToggle } from '../../app/ThemeToggle'
import type { ThemePreference } from '../../app/theme'
import { SyncPanel } from '../sync/SyncPanel'
import { TaxonomySettings } from '../taxonomy/TaxonomySettings'
import { CurrencyPreferences } from '../taxonomy/CurrencyPreferences'

/**
 * The settings page (items 9, 10 and 13 of `SPECS/todo.md`).
 *
 * Three separate requests to put things here, and they agree on one answer: the header
 * was carrying controls that are either used once or are detail.
 *
 * - Theme (item 9): a three-way radio group in the header on every screen, for a
 *   preference nobody changes mid-entry.
 * - Sync (item 10): the header keeps the indicator, because knowing whether your other
 *   device is current is a glance; what to *do* about it is a decision, and belongs here.
 * - Currencies (item 13): never in the header at all.
 *
 * Sections are separate components that own their own state rather than one form with
 * every control in it, so a section that fails to load cannot take the others with it.
 */
export interface SettingsPageProps {
  now: Date
  theme: ThemePreference
  onThemeChange: (next: ThemePreference) => void
}

export function SettingsPage({ now, theme, onThemeChange }: SettingsPageProps) {
  return (
    <>
      <section className="panel" aria-labelledby="appearance-heading">
        <h2 id="appearance-heading">Appearance</h2>
        <ThemeToggle value={theme} onChange={onThemeChange} />
        <p className="hint">
          System follows your operating system and changes with it. The choice is kept in this
          browser.
        </p>
      </section>

      <TaxonomySettings now={now} />

      <section className="panel" aria-labelledby="currencies-heading">
        <h2 id="currencies-heading" className="visually-hidden">
          Currencies
        </h2>
        <CurrencyPreferences />
      </section>

      <SyncPanel />
    </>
  )
}
