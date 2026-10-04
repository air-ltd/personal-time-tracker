/// <reference types="vite/client" />

/**
 * Vite's `?raw` import, for bundling a Markdown file as a string.
 *
 * Used by the About page to render `CHANGELOG.md` from one place. Copying the file into
 * `public/` would give the app a second copy to drift out of step, and linking to the
 * repository would break for a fork and for `npm run dev`.
 */
declare module '*.md?raw' {
  const content: string
  export default content
}
