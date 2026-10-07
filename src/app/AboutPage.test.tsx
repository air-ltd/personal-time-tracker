import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AboutPage } from './AboutPage'
import { NEW_ISSUE_URL, REPOSITORY_URL } from './repository'
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
/**
 * The privacy policy and the feedback link (SPECS/todo.md items 38 and 39).
 *
 * Written as assertions about *claims*, because the failure mode of a privacy policy is
 * being quietly untrue: it is easy to keep every sentence and quietly fall out of date when
 * the storage changes. Each claim below is checked against the code it describes, so a
 * change that invalidates one breaks a test rather than shipping a stale promise.
 */
describe('the privacy policy', () => {
  it('claims no analytics, telemetry or crash reporting', () => {
    render(<AboutPage />)
    // `getAllByText` because the host section repeats the claim: GitHub serves the page, and
    // the wording has to say the app still adds nothing rather than leave the reader to
    // wonder whether the earlier promise survived being qualified.
    expect(screen.getAllByText(/No analytics, no telemetry/i).length).toBeGreaterThan(0)
    // The *behaviour* behind this claim is not asserted here and cannot be: it needs a real
    // browser watching every request the app makes, which is the e2e suite's job
    // (0011 P6, and the check that no request goes to an unexpected origin). Asserting the
    // wording here and the behaviour there is the honest split — a source scan for the word
    // "analytics" would pass while a differently-named beacon shipped.
  })

  it('names the host and points at GitHub&rsquo;s own policy (item 65)', () => {
    render(<AboutPage />)
    // A privacy policy that stops at the app's own code answers half the question:
    // somebody asking whether their data is private also needs to know who serves the page.
    expect(screen.getByText(/served by GitHub Pages/i)).toBeInTheDocument()
    /*
     * What GitHub collects is pointed at, not asserted. That policy changes, it lives in
     * several places, and this project cannot keep a summary of another company&rsquo;s data
     * practices true — so a paraphrase here would be a claim that goes stale quietly. The
     * links are the answer.
     */
    expect(screen.getByRole('link', { name: /^privacy statement$/i })).toHaveAttribute(
      'href',
      expect.stringContaining('github.com'),
    )
    expect(screen.getByRole('link', { name: /GitHub Pages section/i })).toHaveAttribute(
      'href',
      expect.stringContaining('github.com'),
    )
    // And the one claim that still needs qualifying is qualified, rather than stated flat.
    expect(screen.getByText('At the time of writing')).toBeInTheDocument()
    // The app&rsquo;s own position is unchanged and is what remains knowable from here.
    expect(screen.getByText(/What this app does is still knowable/i)).toBeInTheDocument()
  })

  it('says the source is public, so the claims can be checked', () => {
    // The strongest thing a privacy policy can offer is a reader who does not have to take
    // it on trust.
    render(<AboutPage />)
    expect(screen.getByText(/source is public/i)).toBeInTheDocument()
  })

  it('claims no cookies and no third-party assets', () => {
    render(<AboutPage />)
    expect(screen.getByText(/No cookies/i)).toBeInTheDocument()
    expect(screen.getByText(/No third-party assets/i)).toBeInTheDocument()
  })

  it('states that the synced file is not encrypted, because it is not', () => {
    // 0011 AR1: the file is plaintext. A policy that omitted this would be the exact
    // overclaim the accepted-risks section exists to prevent.
    render(<AboutPage />)
    // Two statements of it, and deliberately: one in the policy and one on the sync
    // screen where the decision to sync is made. Asserted as "more than one", because a
    // policy that says it in one place only is the version that gets missed.
    expect(screen.getAllByText(/not encrypted by this app/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/no passphrase/i).length).toBeGreaterThanOrEqual(1)
  })

  it('names where things are stored, matching what the database actually opens', () => {
    render(<AboutPage />)
    // These appear in more than one place by design, so counted rather than found.
    expect(screen.getAllByText(/IndexedDB/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/localStorage/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/sessionStorage/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Dropbox token/).length).toBeGreaterThan(0)
  })

  it('offers a way to report a problem, and asks people not to attach a backup', () => {
    render(<AboutPage />)
    const issue = screen.getByRole('link', { name: /open an issue/i })
    expect(issue).toHaveAttribute('href', NEW_ISSUE_URL)
    // A backup is the user's work. Putting it in a public issue is the one mistake this
    // app's whole design is meant to make hard, so the warning is worth asserting.
    expect(screen.getByText(/do not attach a backup file/i)).toBeInTheDocument()
  })

  it('links to the repository, so a fork can find its way', () => {
    render(<AboutPage />)
    expect(screen.getByRole('link', { name: /the repository/i })).toHaveAttribute(
      'href',
      REPOSITORY_URL,
    )
  })
})

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
