import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
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

/**
 * Unmount rendered components between tests.
 *
 * Testing Library registers this automatically, but only when it can find a global
 * `afterEach`. Vitest's `globals` are off here — so that production code cannot reach
 * `describe` or `expect` by accident — which means there is no global to find and nothing
 * unmounted. Without it, rendered DOM accumulated across a file and queries matched
 * elements from earlier tests.
 */
afterEach(() => {
  cleanup()
})

export { stubMatchMedia }
