import { ThemeToggle } from '../../app/ThemeToggle'
import type { ThemePreference } from '../../app/theme'
import { SyncPanel } from '../sync/SyncPanel'
import { BackupPanel } from '../backup/BackupPanel'
import { TaxonomySettings } from '../taxonomy/TaxonomySettings'
import { CurrenciesPanel } from './CurrenciesPanel'

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

      {/*
        A real `<h2>` like every other panel on this page.

        This was `aria-label="Currencies"` with a comment explaining that a second heading
        for the same region would be worse — and then `CurrencyPreferences` was given a
        visible `<h3>Currencies</h3>`, which is exactly the duplication the comment was
        avoiding. The comment described a problem the code had.
      */}
      <CurrenciesPanel />

      <SyncPanel />

      {/* Item 26 reduced the header menu to three buttons, which left nowhere to say what a
          backup is or that restoring merges rather than replaces. The explanation lives
          here; the actions are in both places, sharing one `useBackup`. */}
      <BackupPanel />

      {/*
        Also in the header menu, which is where "what is this?" is usually asked. This link
        stays because someone already reading settings is looking for it here, and the two
        are one line each rather than a shared abstraction — there is nothing here that
        needs to change if the route moves, because the menu's href is passed in by `App`.
      */}
      <p className="settings-footer">
        <a href="#/about">About this app and what has changed</a>
      </p>
    </>
  )
}
