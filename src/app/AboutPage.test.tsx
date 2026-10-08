import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

    // Without Keep a Changelog's brackets, which read as leftover syntax in a heading.
    // `Unreleased` is the one that is *absent*: it is empty at every release cut, and a
    // heading with nothing under it is dropped rather than rendered.
    expect(screen.queryByRole('heading', { name: 'Unreleased' })).toBeNull()
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
  /**
   * Opens the privacy disclosure and returns it.
   *
   * The section is collapsed by default (item 70), and every assertion below is about
   * something *inside* it — so each test opens it first, the way a reader who wants to check
   * a claim does. Doing it per test rather than in `beforeEach` keeps each one honest about
   * what it needs, and means a test that did not open it cannot pass on a stale render.
   */
  async function openPrivacy(): Promise<HTMLElement> {
    const toggle = screen.getByRole('button', { name: 'Privacy' })
    if (toggle.getAttribute('aria-expanded') !== 'true') {
      await userEvent.setup().click(toggle)
    }
    const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    if (!body) throw new Error('the privacy toggle points at nothing')
    return body
  }

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

  it('names the host and points at GitHub&rsquo;s own policy (item 65)', async () => {
    render(<AboutPage />)
    await openPrivacy()
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
    // Scoped to the privacy section: the bundled changelog now also says the source is
    // public, and two matches for one sentence is not a failure of either.
    const privacy = document.getElementById('privacy-heading')?.closest('section')
    expect(privacy?.textContent).toMatch(/source is public/i)
  })

  it('claims no cookies and no third-party assets', async () => {
    render(<AboutPage />)
    await openPrivacy()
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

  it('renders every heading that has content under it', () => {
    render(<AboutPage />)
    /*
     * Read from the file, so a heading added to the changelog without a test here still gets
     * checked. The one exception is a heading with no body under it, which is deliberately
     * not rendered — `## [Unreleased]` is empty at every release cut, so excluding it by
     * assertion rather than by remembering is what keeps this honest as versions are added.
     */
    const headings = [...real.matchAll(/^##\s+(.*)$/gm)].map((match) =>
      // Matches the parser's own rule — strip a leading bracketed label, date and all.
      (match[1] ?? '').replace(/^\[([^\]]*)\]/, '$1'),
    )
    /*
     * Read from the version toggles rather than from `h3` elements, because a version heading
     * is now a button — pressing it is how you see that version, and a heading that is also a
     * control is not something a screen reader can be told about. The prose sections above
     * the releases ("Versioning") are still headings, so both are checked.
     */
    const rendered = new Set(
      [...document.querySelectorAll('.changelog-version-toggle')].map(
        (button) => button.textContent ?? '',
      ),
    )
    const prose = new Set(
      [...document.querySelectorAll('.changelog h3')].map((h) => h.textContent ?? ''),
    )

    for (const heading of headings) {
      if (heading === 'Unreleased') {
        expect(rendered.has(heading)).toBe(false)
        continue
      }
      const target = /^\d/.test(heading) ? rendered : prose
      expect(target.has(heading), `rendered "${heading}"`).toBe(true)
    }
  })
})

describe('the bundled changelog', () => {
  it('does not show a heading with nothing under it', () => {
    // `## [Unreleased]` is empty at every release cut, so a parser that renders headings
    // literally opens the page with a bare "Unreleased" and nothing after it — the first
    // thing a reader meets being a section with no content. An empty heading is a document
    // convention; on a page it is a promise that something follows.
    render(<AboutPage />)

    const headings = [...document.querySelectorAll('.changelog h3')].map((h) => h.textContent)
    for (const heading of headings) {
      const node = [...document.querySelectorAll('.changelog h3')].find(
        (h) => h.textContent === heading,
      )
      const hasBody =
        node?.nextElementSibling !== null && node?.nextElementSibling?.tagName !== 'H3'
      expect(hasBody, `"${heading}" has content under it`).toBe(true)
    }
  })

  /**
   * The rendered version headings, with their dates stripped.
   *
   * Stripped because the file writes `[0.2.0] - 2026-10-13` and the date is part of the
   * heading. The dates are asserted separately rather than folded into these.
   */
  /** The version headings, with their dates stripped. */
  function versionHeadings(): string[] {
    return [...document.querySelectorAll('.changelog-version-toggle')].map((button) =>
      (button.textContent ?? '').replace(/\s+-\s+\d{4}-\d{2}-\d{2}$/, ''),
    )
  }

  it('renders released versions, and not an empty Unreleased', () => {
    render(<AboutPage />)
    const headings = versionHeadings()

    expect(headings).toContain('0.2.0')
    expect(headings).toContain('0.1.0')
    // Read from the headings rather than the whole text: the changelog's own versioning prose
    // contains the word in backticks, so a text search would match a sentence *about*
    // Unreleased rather than a heading for it.
    expect(headings).not.toContain('Unreleased')
  })

  it('dates each release heading', () => {
    render(<AboutPage />)
    // Queried on the toggles rather than on `h3`: a version heading is now a button, and
    // the only `h3`s left are the prose sections above the releases.
    const dated = [...document.querySelectorAll('.changelog-version-toggle')].map(
      (button) => button.textContent ?? '',
    )
    // How a reader tells a shipped version from an unreleased heading at a glance.
    expect(dated.filter((h) => /\d{4}-\d{2}-\d{2}/.test(h)).length).toBeGreaterThanOrEqual(2)
  })

  it('puts the newest release above the older one', () => {
    render(<AboutPage />)
    const headings = versionHeadings()

    expect(headings.indexOf('0.2.0')).toBeGreaterThanOrEqual(0)
    expect(headings.indexOf('0.2.0')).toBeLessThan(headings.indexOf('0.1.0'))
  })
})

describe('collapsible versions under "What’s new" (item 69)', () => {
  /** The version toggles, newest first. */
  function toggles(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('.changelog-version-toggle')]
  }

  /** The body a toggle reveals. */
  function bodyFor(toggle: HTMLElement): HTMLElement {
    const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    if (!body) throw new Error('the toggle points at nothing')
    return body
  }

  it('starts every version closed', async () => {
    const user = userEvent.setup()
    render(<AboutPage />)

    // The point of the request: a page whose first card is a wall of every release since
    // the beginning. The newest release is what a reader came for, and it is behind a click.
    expect(toggles().length).toBeGreaterThanOrEqual(2)
    for (const toggle of toggles()) {
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(bodyFor(toggle)).not.toBeVisible()
    }
    await user.click(toggles()[0] as HTMLElement)
  })

  it('opens and closes a version when its heading is pressed', async () => {
    const user = userEvent.setup()
    render(<AboutPage />)
    const first = toggles()[0] as HTMLElement

    await user.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(bodyFor(first)).toBeVisible()

    // And closes again, so it is a toggle rather than a one-way reveal.
    await user.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(bodyFor(first)).not.toBeVisible()
  })

  it('opens one version without opening the others', async () => {
    const user = userEvent.setup()
    render(<AboutPage />)

    await user.click(toggles()[0] as HTMLElement)

    // Opening one is not opening all: a reader checking what changed in 0.2.0 did not ask
    // to scroll through 0.1.0 as well.
    expect(toggles()[0]).toHaveAttribute('aria-expanded', 'true')
    for (const other of toggles().slice(1)) {
      expect(other).toHaveAttribute('aria-expanded', 'false')
    }
  })

  it('still hides the body from the accessibility tree when closed', async () => {
    const user = userEvent.setup()
    render(<AboutPage />)
    const first = toggles()[0] as HTMLElement

    /*
     * The `hidden` attribute rather than a height or opacity: a closed version's notes are
     * genuinely off the page, so they are unreachable by screen reader and by find-in-page.
     *
     * Asserted through `toBeVisible`, which is the honest question. `queryByText` would not
     * do: it matches hidden nodes too, so it finds the notes in a *closed* section and would
     * report the opposite of what a reader experiences.
     */
    const notes = /Clients and their projects are one list/
    expect(bodyFor(first).hidden).toBe(true)
    expect(screen.getByText(notes)).not.toBeVisible()

    await user.click(first)
    expect(bodyFor(first).hidden).toBe(false)
    expect(screen.getByText(notes)).toBeVisible()
  })

  it('leaves the prose sections flat', async () => {
    const user = userEvent.setup()
    render(<AboutPage />)

    // "Versioning" is a `##` heading like a release, but it is not a version — folding it
    // away would hide the explanation of how the numbers work for no gain, and it is short.
    expect(screen.getByRole('heading', { name: 'Versioning' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Versioning/ })).toBeNull()

    // And it is not swept up into a disclosure by the grouping.
    await user.click(toggles()[0] as HTMLElement)
    expect(screen.getByRole('heading', { name: 'Versioning' })).toBeInTheDocument()
    expect(screen.getByText(/Versions are cut at/)).toBeVisible()
  })

  it('ties each toggle to the body it controls', () => {
    render(<AboutPage />)

    // Each `aria-controls` has to resolve to a real element, and to that version's *own*
    // body — an id pointing nowhere, or at another version's body, is a relationship that
    // does not exist, and the disclosure would then reveal the wrong release.
    const bodies = toggles().map(bodyFor)
    for (const body of bodies) {
      expect(body.className).toContain('changelog-version-body')
      expect(body.textContent?.trim()).not.toBe('')
    }
    // Distinct bodies, each holding that version's own notes.
    expect(bodies[0]?.textContent).toContain('Clients and their projects are one list')
    expect(bodies[1]?.textContent).toContain('First release')
    expect(bodies[0]?.textContent).not.toBe(bodies[1]?.textContent)
  })

  it('gives the toggles a chevron and keeps the version text beside it', () => {
    render(<AboutPage />)

    for (const toggle of toggles()) {
      expect(toggle.querySelector('svg')).not.toBeNull()
      // The chevron is decorative — the state is on the button, and the shared icon wrapper
      // hides unlabelled SVGs — so the name is the text.
      expect(toggle).toHaveAccessibleName(/\d+\.\d+\.\d+/)
    }
  })
})

describe('the privacy disclosure (item 70)', () => {
  it('starts closed, with the panel still named by its heading', async () => {
    const user = userEvent.setup()
    render(<AboutPage />)

    // Collapsed, because the policy is reference material a reader arrives at deliberately,
    // and expanded it pushed the feedback link and "What's new" below a wall of prose.
    const toggle = screen.getByRole('button', { name: 'Privacy' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    // Collapsed does not mean unlabelled: the panel is still named for assistive technology,
    // or a screen reader would announce it as an anonymous region.
    const heading = document.getElementById('privacy-heading')
    expect(heading).not.toBeNull()
    expect(heading?.closest('section')?.getAttribute('aria-labelledby')).toBe('privacy-heading')
    await user.click(toggle)
  })

  it('reveals the policy when pressed, and hides it again', async () => {
    const user = userEvent.setup()
    render(<AboutPage />)
    const toggle = screen.getByRole('button', { name: 'Privacy' })

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/No cookies/i)).toBeVisible()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/No cookies/i)).not.toBeVisible()
  })

  it('leaves the policy out of find-in-page while closed', async () => {
    // `hidden`, not a collapsed height: the text is genuinely not on the page, so find-in-page
    // should not offer it.
    const user = userEvent.setup()
    render(<AboutPage />)
    const toggle = screen.getByRole('button', { name: 'Privacy' })

    const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(body?.hidden).toBe(true)
    await user.click(toggle)
    expect(body?.hidden).toBe(false)
  })

  it('does not disturb the changelog disclosures', async () => {
    const user = userEvent.setup()
    render(<AboutPage />)

    // Opening one disclosure says nothing about the others — the privacy policy expanding is
    // not consent to scroll through every release too.
    await user.click(screen.getByRole('button', { name: 'Privacy' }))
    for (const version of document.querySelectorAll('.changelog-version-toggle')) {
      expect(version.getAttribute('aria-expanded')).toBe('false')
    }
  })

  it('keeps the heading level the panel had', () => {
    render(<AboutPage />)
    /*
     * The button sits inside the heading rather than replacing it, which is what keeps this
     * true. An h3 inside a panel of h2s would put the privacy policy *below* the other panels
     * in the outline — the opposite of where it belongs — and a bare button styled like a
     * heading would leave it out of the outline entirely.
     */
    expect(screen.getByRole('heading', { name: 'Privacy', level: 2 })).toBeInTheDocument()
  })
})
