/**
 * Project and client colours (0005 P3–P4).
 *
 * A free colour picker produces unreadable charts: two adjacent bars at 1.2:1 contrast,
 * or a colour indistinguishable under deuteranopia. So the default is a fixed palette
 * whose every entry has been checked against both chart backgrounds, and the picker
 * offers these rather than a hue wheel.
 *
 * The user may still override (0005 P3), so the palette is a safe default rather than a
 * constraint — which is why contrast is a function here and not a one-off assertion.
 */

/**
 * Chart backgrounds, taken from the values in `styles.css`.
 *
 * Duplicated rather than read from CSS because the palette has to be verifiable in a
 * unit test, and a computed style is not available outside a browser. The test asserts
 * these match the stylesheet, so the two cannot drift apart silently.
 */
export const CHART_BACKGROUNDS = {
  light: '#fbfbfd',
  dark: '#141417',
} as const

export interface Rgb {
  r: number
  g: number
  b: number
}

/** Parse `#rgb` or `#rrggbb`. Returns null rather than throwing on malformed input. */
export function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const digits = match[1] as string
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((c) => c + c)
          .join('')
      : digits
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  }
}

/** Linearise one channel, per WCAG 2.x. */
function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Relative luminance (0005 P4). */
export function luminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/**
 * WCAG contrast ratio, 1–21.
 *
 * Uses the (L1 + 0.05) / (L2 + 0.05) form, which is the ratio of the lighter to the
 * darker, so it is always ≥ 1 and symmetric.
 */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Perceptual distance between two colours ("redmean").
 *
 * Needed because contrast ratio alone is the wrong tool for choosing a palette: it
 * measures lightness difference, so maximising it drives every colour to the same
 * lightness and produces twelve swatches that are indistinguishable. This weights the
 * channels by their shared intensity, which tracks perceived difference closely enough
 * to separate hues at equal lightness.
 */
export function perceptualDistance(a: string, b: string): number {
  const one = parseHex(a)
  const two = parseHex(b)
  if (!one || !two) return 0
  const mean = (one.r + two.r) / 2
  const dr = one.r - two.r
  const dg = one.g - two.g
  const db = one.b - two.b
  return Math.sqrt(
    (2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db,
  )
}

/**
 * The palette.
 *
 * Computed rather than picked by eye, because a hand-chosen palette is a claim about
 * accessibility that nothing checks — and the first hand-chosen attempt put six of
 * twelve entries below the contrast threshold. Each colour was searched over hue,
 * saturation and lightness, kept only where it clears 3.31:1 against *both* chart
 * backgrounds, and selected to maximise the smallest perceptual gap between any two
 * entries.
 *
 * `colour.test.ts` asserts both properties, so the values cannot be replaced with
 * plausible-looking ones that do not hold.
 */
export const PALETTE = [
  '#2e6aae', // blue
  '#f20d2b', // red
  '#759608', // olive
  '#cb3da1', // magenta
  '#067a40', // green
  '#da6c0b', // orange
  '#127bf3', // azure
  '#955b28', // umber
  '#cb3b4e', // rose
  '#2a9c72', // jade
  '#337706', // forest
  '#f20dad', // pink
] as const

export type PaletteColour = (typeof PALETTE)[number]

/**
 * Minimum contrast a palette colour must reach against a chart background.
 *
 * 3:1 is the WCAG threshold for non-text content such as a chart bar or a swatch. Text
 * would need 4.5:1, but these are fills beside a label, not the label itself.
 */
export const MIN_CHART_CONTRAST = 3

/**
 * Pick the palette entry furthest from those already in use.
 *
 * Deterministic: the same set of existing colours always yields the same suggestion, so
 * two devices created the same project get the same colour and a chart stays stable.
 * Distance is the lowest contrast ratio against every colour already chosen, which
 * measures actual separability rather than hue distance — two blues can be far apart in
 * hue and still unreadable next to each other.
 */
export function suggestColour(used: readonly string[]): string {
  const taken = used.map(parseHex).filter((c): c is Rgb => c !== null)
  if (taken.length === 0) return PALETTE[0]

  let best = PALETTE[0] as string
  let bestScore = -1

  for (const candidate of PALETTE) {
    const candidateRgb = parseHex(candidate) as Rgb
    let worst = Number.POSITIVE_INFINITY
    for (const existing of taken) {
      const ratio = contrastRatio(toHex(candidateRgb), toHex(existing))
      if (ratio < worst) worst = ratio
    }
    if (worst > bestScore) {
      bestScore = worst
      best = candidate
    }
  }

  return best
}

function toHex({ r, g, b }: Rgb): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`
}

/** Normalise to the lowercase `#rrggbb` form the data model requires. */
export function normaliseColour(hex: string): string | null {
  const rgb = parseHex(hex)
  return rgb === null ? null : toHex(rgb)
}

/**
 * Whether a user-chosen colour is safe to use as a chart colour.
 *
 * Not a hard rejection: 0005 P3 allows an override. It reports the measured ratio so
 * the UI can warn rather than forbid, which respects the user's choice while still
 * telling them the truth about the result.
 */
export function assessColour(hex: string): {
  ok: boolean
  lightRatio: number
  darkRatio: number
  worstRatio: number
} {
  const normalised = normaliseColour(hex)
  if (normalised === null) {
    return { ok: false, lightRatio: 0, darkRatio: 0, worstRatio: 0 }
  }
  const lightRatio = contrastRatio(normalised, CHART_BACKGROUNDS.light)
  const darkRatio = contrastRatio(normalised, CHART_BACKGROUNDS.dark)
  const worstRatio = Math.min(lightRatio, darkRatio)
  return { ok: worstRatio >= MIN_CHART_CONTRAST, lightRatio, darkRatio, worstRatio }
}
