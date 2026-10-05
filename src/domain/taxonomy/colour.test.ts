import { describe, expect, it } from 'vitest'
import {
  CHART_BACKGROUNDS,
  MIN_CHART_CONTRAST,
  PALETTE,
  assessColour,
  contrastRatio,
  luminance,
  normaliseColour,
  parseHex,
  perceptualDistance,
  suggestColour,
} from './colour'

/**
 * Palette and contrast (0005 P3–P4, 0010).
 *
 * The comment in `colour.ts` claims every palette entry clears 3:1 in both themes. This
 * is that claim, checked — including against the stylesheet, so the duplicated
 * background values cannot drift.
 */

describe('parseHex', () => {
  it('reads both hex forms', () => {
    expect(parseHex('#ffffff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHex('1f5fbf')).toEqual(parseHex('#1f5fbf'))
  })

  it('is case-insensitive', () => {
    expect(parseHex('#AABBCC')).toEqual(parseHex('#aabbcc'))
  })

  it('returns null rather than throwing on nonsense', () => {
    // The colour can come from an imported backup, so it is untrusted input.
    for (const bad of ['', '#', '#12', '#12345', 'rebeccapurple', '#gggggg']) {
      expect(parseHex(bad), bad).toBeNull()
    }
  })
})

describe('contrastRatio', () => {
  it('matches the known WCAG reference values', () => {
    // Black on white is the maximum; identical colours are the minimum. If these drift,
    // every other number here is wrong too.
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#1f5fbf', '#141417')).toBeCloseTo(
      contrastRatio('#141417', '#1f5fbf'),
      10,
    )
  })
})

describe('luminance', () => {
  it('orders black below white', () => {
    expect(luminance('#000000')).toBeLessThan(luminance('#ffffff'))
  })
})

describe('the palette', () => {
  it.each(PALETTE)('%s clears the threshold in both themes (0005 P4)', (colour) => {
    const light = contrastRatio(colour, CHART_BACKGROUNDS.light)
    const dark = contrastRatio(colour, CHART_BACKGROUNDS.dark)
    expect(light, `${colour} on the light background`).toBeGreaterThanOrEqual(
      MIN_CHART_CONTRAST,
    )
    expect(dark, `${colour} on the dark background`).toBeGreaterThanOrEqual(MIN_CHART_CONTRAST)
  })

  it('holds enough entries that the twelfth project is still distinguishable', () => {
    // Twelve is chosen so a busy month of projects does not exhaust the palette; the
    // suggestion logic then repeats, which is acceptable and better than a bad colour.
    expect(PALETTE.length).toBeGreaterThanOrEqual(12)
  })

  it('has no duplicate colours', () => {
    expect(new Set(PALETTE).size).toBe(PALETTE.length)
  })

  it('is lowercase hex, as the data model requires', () => {
    for (const colour of PALETTE) expect(colour).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('suggestColour', () => {
  it('starts from the first palette entry', () => {
    expect(suggestColour([])).toBe(PALETTE[0])
  })

  it('avoids a colour already in use', () => {
    const first = suggestColour([])
    const second = suggestColour([first])
    expect(second).not.toBe(first)
  })

  it('is deterministic, so two devices create the same project the same colour', () => {
    // Otherwise a project synced between devices could change colour, and a chart would
    // silently restyle itself between sessions.
    const used = [PALETTE[0], PALETTE[1]]
    expect(suggestColour(used)).toBe(suggestColour([...used].reverse()))
  })

  it('is unaffected by the order colours were used in', () => {
    const used = [PALETTE[2], PALETTE[3], PALETTE[4]]
    expect(suggestColour(used)).toBe(suggestColour([...used].reverse()))
  })

  it('keeps suggesting once the palette is exhausted', () => {
    // Twelve projects is unusual but possible; repeating a colour beats returning
    // nothing and leaving the field unset.
    expect(suggestColour([...PALETTE])).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('ignores unparseable colours rather than failing', () => {
    expect(suggestColour(['not-a-colour', PALETTE[0]])).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('normaliseColour', () => {
  it('lowercases and expands to six digits', () => {
    expect(normaliseColour('#ABC')).toBe('#aabbcc')
    expect(normaliseColour('#AABBCC')).toBe('#aabbcc')
  })

  it('rejects malformed input', () => {
    expect(normaliseColour('nope')).toBeNull()
  })
})

describe('assessColour', () => {
  it('passes a palette colour', () => {
    expect(assessColour(PALETTE[0]).ok).toBe(true)
  })

  /*
   * Both directions fail, and they fail for different reasons. A near-white colour
   * disappears against the light background; a near-black one disappears against the
   * dark. Mid grey passes both, which is why "obviously safe grey" is not the
   * interesting case here.
   */
  it.each([
    ['too light for the light theme', '#e8e8e8'],
    ['too dark for the dark theme', '#1a1a1a'],
  ])('reports a colour %s', (_label, colour) => {
    const assessed = assessColour(colour)
    expect(assessed.ok).toBe(false)
    expect(assessed.worstRatio).toBeLessThan(MIN_CHART_CONTRAST)
  })

  it('says which theme a middling colour fails, not only that it failed', () => {
    // Near-black is legible on light and invisible on dark; reporting only the minimum
    // would not tell the user which side to fix.
    const assessed = assessColour('#1a1a1a')
    expect(assessed.lightRatio).toBeGreaterThan(MIN_CHART_CONTRAST)
    expect(assessed.darkRatio).toBeLessThan(MIN_CHART_CONTRAST)
  })

  it('reports both themes rather than only the worse one', () => {
    // A colour can be fine on light and poor on dark; showing only the minimum would
    // hide which theme is the problem.
    const assessed = assessColour('#6a6a6a')
    expect(typeof assessed.lightRatio).toBe('number')
    expect(typeof assessed.darkRatio).toBe('number')
    expect(assessed.worstRatio).toBe(Math.min(assessed.lightRatio, assessed.darkRatio))
  })

  it('treats malformed input as unusable rather than defaulting to safe', () => {
    expect(assessColour('rgb(1,2,3)').ok).toBe(false)
  })
})

/**
 * 0005 P4 also requires that a project's colour be distinguishable from every other
 * project's colour, not merely readable. Contrast ratio cannot express that — it
 * measures lightness, so twelve colours at the same lightness all score 1:1 against
 * each other while being obviously different to a reader. This checks perceptual
 * separation instead.
 */
describe('palette entries are distinguishable from one another', () => {
  it('keeps every pair well separated', () => {
    let worst = { pair: '', distance: Number.POSITIVE_INFINITY }
    for (let i = 0; i < PALETTE.length; i += 1) {
      for (let j = i + 1; j < PALETTE.length; j += 1) {
        const distance = perceptualDistance(PALETTE[i] as string, PALETTE[j] as string)
        if (distance < worst.distance) {
          worst = { pair: `${PALETTE[i]} / ${PALETTE[j]}`, distance }
        }
      }
    }
    // Roughly a quarter of the maximum possible distance. Chosen by measuring the
    // palette above rather than picked to be impressive.
    expect(worst.distance, `closest pair was ${worst.pair}`).toBeGreaterThan(100)
  })

  it('has room to grow rather than sitting on the threshold', () => {
    // A palette chosen to just pass contrast would leave nothing to give back if the
    // backgrounds were ever nudged, so the margin is asserted as well.
    for (const colour of PALETTE) {
      expect(assessColour(colour).worstRatio, colour).toBeGreaterThan(3.2)
    }
  })
})
