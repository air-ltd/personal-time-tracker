// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHART_BACKGROUNDS } from './colour'

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

describe('chart backgrounds', () => {
  it('matches the light theme', () => {
    expect(stylesheet).toContain(`--bg: ${CHART_BACKGROUNDS.light};`)
  })

  it('matches the dark theme', () => {
    expect(stylesheet).toContain(`--bg: ${CHART_BACKGROUNDS.dark};`)
  })
})
