import '@testing-library/jest-dom/vitest'

/**
 * jsdom does not implement `matchMedia`, and every theme resolution path consults
 * it (0002 TH1) to honour `system`. Without this stub, rendering `App` throws.
 *
 * Tests that need a dark system preference override `window.matchMedia`
 * themselves; this default reports light.
 */
function stubMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

stubMatchMedia(false)

export { stubMatchMedia }
