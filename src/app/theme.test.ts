import { describe, expect, it } from 'vitest'
import { applyTheme, isThemePreference, resolveTheme, THEME_STORAGE_KEY } from './theme'
import { stubMatchMedia } from '../test/setup'

describe('resolveTheme', () => {
  it('passes explicit preferences through', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  // 0002 TH2: `system` is the default and follows the OS.
  it('follows the OS preference for system', () => {
    stubMatchMedia(true)
    expect(resolveTheme('system')).toBe('dark')
    stubMatchMedia(false)
    expect(resolveTheme('system')).toBe('light')
  })
})

describe('applyTheme', () => {
  // 0002 TH3: the theme is expressed as an attribute so CSS owns all colour.
  it('sets data-theme on the document element', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('isThemePreference', () => {
  it('accepts the three known values', () => {
    expect(isThemePreference('light')).toBe(true)
    expect(isThemePreference('dark')).toBe(true)
    expect(isThemePreference('system')).toBe(true)
  })

  // Guards the localStorage mirror in index.html against a tampered value.
  it('rejects anything else', () => {
    expect(isThemePreference('sepia')).toBe(false)
    expect(isThemePreference(null)).toBe(false)
    expect(isThemePreference(undefined)).toBe(false)
  })
})

describe('theme storage key', () => {
  // 0011 R5: this is the only localStorage key the app may use.
  it('is the single allowlisted key', () => {
    expect(THEME_STORAGE_KEY).toBe('tt:theme')
  })
})
