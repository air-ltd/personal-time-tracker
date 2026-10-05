import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AboutPage } from './AboutPage'
import changelog from '../../CHANGELOG.md?raw'

/**
 * The About page and the changelog it renders.
 *
 * The thing worth protecting is that the changelog is rendered as React elements rather
 * than as HTML. Bundling a Markdown file and injecting it with `dangerouslySetInnerHTML`
 * would turn a file anyone can edit into a place to inject markup, and the failure would be
 * invisible until someone tried it.
 */

describe('About', () => {
  it('says where the data lives and what is not stored', () => {
    render(<AboutPage />)

    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()
    expect(screen.getByText(/runs entirely in your browser/i)).toBeInTheDocument()
    expect(screen.getByText(/never appears in a backup/i)).toBeInTheDocument()
  })

  it('references the changelog', () => {
    render(<AboutPage />)

    expect(screen.getByRole('heading', { name: /What.s new/ })).toBeInTheDocument()
    expect(screen.getByText('CHANGELOG.md')).toBeInTheDocument()
  })

  it('renders the changelog headings', () => {
    render(<AboutPage />)

    // "Unreleased" without Keep a Changelog's brackets, which read as leftover syntax in a
    // rendered heading.
    expect(screen.getByRole('heading', { name: 'Unreleased' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Versioning' })).toBeInTheDocument()
    // The file's own title is dropped: the card already has a heading, and two h1s on one
    // page is an outline problem.
    expect(screen.queryByRole('heading', { name: 'Changelog' })).toBeNull()
  })

  it('renders bullets and bold text', () => {
    const { container } = render(<AboutPage />)
    const changelog = container.querySelector('.changelog') as HTMLElement

    expect(changelog.querySelectorAll('li').length).toBeGreaterThan(10)
    expect(changelog.querySelectorAll('strong').length).toBeGreaterThan(0)
  })

  it('renders the file as text, never as markup', () => {
    const { container } = render(<AboutPage />)
    const changelog = container.querySelector('.changelog') as HTMLElement

    expect(changelog.querySelector('script')).toBeNull()
    expect(changelog.innerHTML).not.toContain('<script')
    expect(changelog.querySelectorAll('strong').length).toBeGreaterThan(0)
  })

  it('shows a link as its text, since repository paths do not exist in a bundle', () => {
    const { container } = render(<AboutPage />)
    const changelog = container.querySelector('.changelog') as HTMLElement

    // The changelog links to SPECS/todo.md. A live link would 404 in the deployed app, so
    // it is shown as text instead.
    expect(changelog.textContent).toContain('SPECS/todo.md')
    expect(screen.queryByRole('link', { name: /SPECS\/todo/ })).toBeNull()
  })
})

/**
 * Prose handling in the changelog renderer.
 *
 * `CHANGELOG.md` wraps at about 95 columns with no indentation, so a paragraph arrives as
 * several source lines. Two things were wrong with that, and neither was covered:
 *
 *  - a wrapped *prose* line became its own `<p>`, so paragraphs rendered split mid-sentence
 *    with margins between the halves, under the first heading a user sees;
 *  - any paragraph before the first heading was dropped entirely, by a `blocks.length > 0`
 *    guard written to skip the file's own `# Changelog` title — which `level === 1`
 *    already handled. The preamble was omitted by accident while still being bundled.
 *
 * The second is worth a test on its own: the bytes were in the JavaScript for every visitor
 * to download and the renderer threw them away.
 */
describe('the changelog parser and wrapped prose', () => {
  /**
   * The real file, through the same import the component uses.
   *
   * Not read off disk: the point of these is that *this* parser handles *this* file, and
   * a second copy read a different way could drift from what the component is given.
   */
  const real = changelog

  it('keeps the preamble that comes before the first heading', () => {
    render(<AboutPage />)

    // Keep a Changelog's two opening lines. Rendered nowhere before this fix.
    expect(screen.getByText(/All notable changes to this project/i)).toBeInTheDocument()
  })

  it('joins wrapped prose into one paragraph rather than one per source line', () => {
    const { container } = render(<AboutPage />)
    const changelog = container.querySelector('.changelog') as HTMLElement

    // Find the paragraph beginning "Versions are cut at" — it is three wrapped lines in
    // the file — and assert it is a single element holding all of them.
    const paragraphs = [...changelog.querySelectorAll('p')]
    const joined = paragraphs.find((p) => p.textContent?.includes('Versions are cut at'))

    expect(joined, 'the paragraph was not rendered at all').toBeDefined()
    expect(joined?.textContent).toContain('development convenience')
    // If it had been split, the half containing "phase boundary" would be its own element
    // and would not also contain the start of the sentence.
    expect(
      paragraphs.filter((p) => p.textContent?.includes('Versions are cut at')),
    ).toHaveLength(1)
  })

  it('does not split a sentence across two paragraph elements', () => {
    const { container } = render(<AboutPage />)
    const changelog = container.querySelector('.changelog') as HTMLElement

    for (const paragraph of changelog.querySelectorAll('p')) {
      const text = paragraph.textContent ?? ''
      // Every rendered paragraph ends in terminal punctuation or a colon. One that stops
      // mid-clause is a wrap that was not joined.
      expect(
        /[.:!?—]$/.test(text.trim()),
        `paragraph ends mid-sentence: "${text.trim().slice(-60)}"`,
      ).toBe(true)
    }
  })

  it('still separates paragraphs on a blank line', () => {
    // The other half of the rule: joining must not merge two distinct paragraphs, which is
    // what a naive "join everything until a heading" would do.
    const paragraphs = [
      ...(
        render(<AboutPage />).container.querySelector('.changelog') as HTMLElement
      ).querySelectorAll('p'),
    ]
    const texts = paragraphs.map((p) => (p.textContent ?? '').trim())
    expect(new Set(texts).size).toBe(texts.length)
  })

  it('renders every heading in the file', () => {
    render(<AboutPage />)
    const headings = [...real.matchAll(/^##\s+(.*)$/gm)].map((match) =>
      (match[1] ?? '').replace(/^\[(.*)\]$/, '$1'),
    )

    for (const heading of headings) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    }
  })
})
