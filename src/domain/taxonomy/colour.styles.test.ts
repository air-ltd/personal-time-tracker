// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHART_BACKGROUNDS, contrastRatio, MIN_CHART_CONTRAST } from './colour'

/**
 * The palette is verified against background colours duplicated in `colour.ts`, because
 * a computed style is not readable outside a browser. This asserts the duplicates still
 * match the stylesheet, so a theme change cannot quietly invalidate every contrast
 * figure in `colour.test.ts`.
 *
 * Runs in the node environment so it can read the file; the jsdom test environment
 * returns an empty string for a `?raw` stylesheet import.
 */
const stylesheet = readFileSync(
  fileURLToPath(new URL('../../styles.css', import.meta.url)),
  'utf8',
)

/** The value of a custom property declared anywhere in the stylesheet. */
function token(name: string): string {
  const found = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(stylesheet)
  if (!found?.[1]) throw new Error(`--${name} is not declared as a hex colour in styles.css`)
  return found[1]
}

/**
 * A property as one theme declares it.
 *
 * Needed because the theme blocks hold different values for the same name: the first
 * textual match would silently be the light theme, and a contrast check against only one
 * of the two is exactly the check that passes while a colour is invisible in the other.
 */
function tokenIn(theme: 'light' | 'dark', name: string): string {
  const block =
    theme === 'light'
      ? /:root,\s*:root\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/
      : /:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/
  const found = block.exec(stylesheet)?.[1]
  if (!found) throw new Error(`no ${theme} theme block in styles.css`)
  const value = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(found)?.[1]
  if (!value) throw new Error(`--${name} is not a hex colour in the ${theme} theme`)
  return value
}

describe('chart backgrounds', () => {
  it('matches the light theme', () => {
    expect(stylesheet).toContain(`--bg: ${CHART_BACKGROUNDS.light};`)
  })

  it('matches the dark theme', () => {
    expect(stylesheet).toContain(`--bg: ${CHART_BACKGROUNDS.dark};`)
  })
})

/**
 * Sync status colours (0002 TH3, WCAG 2.2 SC 1.4.11).
 *
 * These three were the only colours in the stylesheet that were not tokens, and one of
 * them failed: the amber measured 2.85:1 on the light background, below the 3:1 that
 * SC 1.4.11 requires of meaningful non-text content, and below `MIN_CHART_CONTRAST` — the
 * bar this project holds every project colour to. It was a dot beside a text label, which
 * caps the severity, but nothing else in the app was quietly under the standard.
 *
 * Asserted here because a dot's contrast is otherwise checked by squinting at it. The
 * worst case over both themes is what matters, since one value serves both.
 */
describe('sync status colours', () => {
  it.each(['sync-ok', 'sync-warn', 'sync-error'])(
    '--%s clears 3:1 on both backgrounds',
    (name) => {
      const colour = token(name)
      for (const background of [CHART_BACKGROUNDS.light, CHART_BACKGROUNDS.dark]) {
        const ratio = contrastRatio(colour, background)
        expect(ratio, `--${name} (${colour}) against ${background}`).toBeGreaterThanOrEqual(
          MIN_CHART_CONTRAST,
        )
      }
    },
  )

  it('clears 3:1 on the raised surface the button actually sits on', () => {
    // The dot is inside a button, so the surface it is drawn over is `--surface`, not
    // `--bg`. Checking only the page background would have passed a colour that is hard
    // to see in the place it is used — and in each theme, which are different values.
    for (const name of ['sync-ok', 'sync-warn', 'sync-error']) {
      const colour = token(name)
      for (const theme of ['light', 'dark'] as const) {
        expect(
          contrastRatio(colour, tokenIn(theme, 'surface')),
          `--${name} (${colour}) on the ${theme} surface`,
        ).toBeGreaterThanOrEqual(MIN_CHART_CONTRAST)
      }
    }
  })

  it('resolves through tokens rather than literals (0002 TH3)', () => {
    // A component must not hard-code a colour. The previous version passed every check
    // above while being three hex literals, because a literal needs no token to break.
    expect(stylesheet).toContain('background: var(--sync-ok);')
    expect(stylesheet).toContain('background: var(--sync-warn);')
    expect(stylesheet).toContain('background: var(--sync-error);')
  })
})

/**
 * Declared tokens, because a `var(--x, fallback)` silently falls back to the literal
 * when `--x` does not exist — which is invisible, unmeasured, and was true of
 * `--surface-2` at five call sites before this check existed.
 */
describe('every token used with a fallback is actually declared', () => {
  /**
   * Properties set from JavaScript rather than declared here.
   *
   * `--swatch` is the colour of the individual button being rendered, which cannot live
   * in a stylesheet because there is one per swatch. Its inline fallback is the real
   * thing it protects — an unselected custom swatch still needs a background.
   */
  const setInline = new Set(['--swatch'])

  const declared = new Set(
    [...stylesheet.matchAll(/(^|\s)(--[\w-]+)\s*:/gm)].map((match) => match[2] as string),
  )

  it('has no undefined custom property', () => {
    const used = new Set(
      [...stylesheet.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1] as string),
    )
    expect([...used].filter((name) => !declared.has(name) && !setInline.has(name))).toEqual([])
  })

  it('leaves no inline colour fallbacks on tokens that are declared', () => {
    // Once declared, a fallback is a second copy of a value that can drift. This is what
    // let `--danger` be defined only for the dark theme while the light theme used an
    // inline literal, and `--surface-2` be used at five sites while existing nowhere.
    const withFallback = [...stylesheet.matchAll(/var\(\s*(--[\w-]+)\s*,/g)].map(
      (match) => match[1] as string,
    )
    expect([...new Set(withFallback)].filter((name) => declared.has(name))).toEqual([])
  })

  it('declares both palettes of any token that differs between them', () => {
    // `--danger` was declared only under the dark theme, so the light theme silently used
    // the inline fallback. Catching that needs both halves of the file, not one token.
    const lightBlock = /:root,\s*:root\[data-theme='light'\]\s*\{([^}]*)\}/.exec(
      stylesheet,
    )?.[1]
    const darkBlock = /:root\[data-theme='dark'\]\s*\{([^}]*)\}/.exec(stylesheet)?.[1]
    expect(lightBlock).toBeDefined()
    expect(darkBlock).toBeDefined()
    const inBlock = (block: string) =>
      new Set([...block.matchAll(/(^|\s)(--[\w-]+)\s*:/gm)].map((match) => match[2] as string))
    const light = inBlock(lightBlock as string)
    const dark = inBlock(darkBlock as string)
    expect([...light].filter((name) => !dark.has(name))).toEqual([])
  })
})
