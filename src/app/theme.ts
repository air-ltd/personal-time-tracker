/**
 * Theme handling (0002 TH1–TH6).
 *
 * The stored preference is one of three values. `system` is the default because a
 * user who has set a dark OS theme has already expressed a preference, and asking
 * again is friction.
 */
export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

/**
 * The only localStorage key this app may use (0011 R5). Anything personal belongs
 * in IndexedDB; this exists solely so the theme can be applied before first paint.
 */
export const THEME_STORAGE_KEY = 'tt:theme'

export const DEFAULT_THEME: ThemePreference = 'system'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') {
    return systemPrefersDark() ? 'dark' : 'light'
  }
  return preference
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference)
  document.documentElement.dataset.theme = resolved
  return resolved
}

/** Read the preference, ignoring anything unrecognised rather than throwing. */
export function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : DEFAULT_THEME
  } catch {
    // localStorage can throw under strict privacy settings.
    return DEFAULT_THEME
  }
}

export function storePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Losing the mirror only costs a flash of the wrong theme on next load.
  }
}
