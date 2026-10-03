import '@testing-library/jest-dom/vitest'
// IndexedDB is absent in jsdom, and every repository call needs it. Installed
// globally so component tests exercise the real storage path rather than a mock,
// which is what makes the integration tests worth having (0010 Q1, Q2).
import 'fake-indexeddb/auto'

/**
 * jsdom does not implement `matchMedia`, and every theme resolution path consults
 * it (0002 TH1) to honour `system`. Without this stub, rendering `App` throws.
 *
 * Tests that need a dark system preference override `window.matchMedia`
 * themselves; this default reports light.
 */
function stubMatchMedia(matches: boolean): void {
  // A test may opt into the node environment to read a file from disk, and there is no
  // `window` there. Stubbing is a DOM concern, so skip it rather than failing.
  if (typeof window === 'undefined') return

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
