import { Fragment, type ReactNode } from 'react'
import changelog from '../../CHANGELOG.md?raw'
import { NEW_ISSUE_URL, REPOSITORY_URL } from './repository'

/**
 * About, and the release notes.
 *
 * The changelog is bundled from the repository file rather than copied into `public/` or
 * linked to the repository. A copy in `public/` is a second source that silently drifts;
 * a repository URL breaks for a fork and for `npm run dev`. Bundling it means the notes
 * shipped are the notes in the commit, offline and on any host.
 *
 * Rendering is done by building React elements rather than an HTML string. That is not
 * incidental: `dangerouslySetInnerHTML` would make this a place to inject markup, whereas
 * text nodes are escaped by React itself, so a changelog entry can never become script.
 *
 * The parser handles the subset the changelog actually uses — headings, list items,
 * paragraphs, and `**bold**` — and renders anything it does not recognise as text. It is
 * not a general Markdown implementation and is not trying to be.
 */
export function AboutPage() {
  return (
    <>
      <section className="panel" aria-labelledby="about-heading">
        <h2 id="about-heading">About</h2>

        <p>
          A personal time tracker that runs entirely in your browser. There is no server and no
          account: your entries live in this browser, and optionally in your own Dropbox.
        </p>

        <h3>Where your data is</h3>
        <ul>
          <li>
            Entries, projects, clients and tags are stored in this browser&rsquo;s IndexedDB.
          </li>
          <li>
            Syncing copies one file to the Dropbox account you connect yourself. Disconnecting
            leaves everything here untouched.
          </li>
          <li>
            A backup is a single JSON file you control. It is the only copy that does not depend
            on a third party, so it works with or without Dropbox.
          </li>
        </ul>

        <h3>What is not stored</h3>
        <ul>
          <li>Your Dropbox login never appears in a backup.</li>
          <li>Nothing is sent anywhere unless you connect Dropbox yourself.</li>
        </ul>

        <p className="hint">
          Your preferences — default currency, which currencies you work in, entries period —
          travel with you when you sync. Your theme does not, because it has to be readable
          before the page paints and only <code>localStorage</code> can do that.
        </p>
      </section>

      {/*
        Items 38 and 39. Kept on the About page rather than a separate document because a
        privacy policy behind a link is a privacy policy nobody opens, and the facts it has to
        state — what is stored, where, and what a stolen account would expose — are the same
        facts a user is already on this page to check.
      */}
      <section className="panel" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">Privacy</h2>

        <p className="hint">
          This app has no interest in your data, and the shortest way to show that is to say
          what it cannot do.
        </p>

        <h3>What this app does not do</h3>
        <ul>
          <li>
            <strong>No analytics, no telemetry, no crash reporting, no session replay.</strong>{' '}
            There is no code path in it that sends usage data. If a page view were interesting
            enough to record, it would have somewhere to go — it does not.
          </li>
          <li>
            <strong>No cookies</strong>, and no third-party cookies. Nothing on this page sets
            one.
          </li>
          <li>
            <strong>No third-party assets.</strong> No CDN scripts, no hosted fonts, no
            analytics tags. Fonts are your operating system&rsquo;s, so loading this page does
            not tell anyone else you visited it.
          </li>
          <li>
            <strong>No accounts and no server.</strong> The app is a static site. It cannot see
            who you are because it has nobody to tell.
          </li>
        </ul>

        {/*
          The host, stated plainly (item 65).

          Everything above is about the app. Somebody asking whether their data is private
          also has to know who is serving them the page, and the honest answer is that it is
          not this project: it is a static site on GitHub Pages. The app adds nothing — no
          beacon, no third-party request — but the host processes ordinary web server logs
          whatever the app does, and a privacy policy that stops at the app's own code is
          answering half the question.

          No log contents or retention periods are spelled out here because this project
          cannot verify them and would only be guessing; GitHub's own privacy statement is
          the authority, and it is linked rather than paraphrased.
        */}
        <h3>Who serves this page</h3>
        <ul>
          <li>
            This is a <strong>static site served by GitHub Pages</strong> from a public{' '}
            <a href={REPOSITORY_URL}>GitHub repository</a>. There is no application server: the
            page you are reading is files, and nothing you type reaches one.
          </li>
          <li>
            <strong>GitHub serves the traffic</strong>, so GitHub processes the ordinary web
            server logs any web host does — the address the request came from, the browser and
            version, the time, and the path asked for — and runs its own security monitoring.
            None of that is the app&rsquo;s doing, and none of it can be turned off from inside
            the page. What GitHub collects and why is set out in{' '}
            <a href="https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement">
              GitHub&rsquo;s privacy statement
            </a>
            , which is the authority here rather than a summary of it.
          </li>
          <li>
            <strong>The app itself still sends nothing.</strong> The list above is unchanged: no
            analytics, no telemetry, no third-party requests. Serving the files is the only
            thing GitHub does on this page&rsquo;s behalf, and it does it the same way for every
            site it hosts.
          </li>
          <li>
            <strong>The source is public.</strong> It is an open repository, so anyone can read
            the code that claims all of the above — including this page. If you are checking
            whether the claim is true, you do not have to take the word of whoever wrote it.
          </li>
        </ul>

        <h3>Where your data lives</h3>
        <ul>
          <li>
            Your entries, projects, clients and tags, and your Dropbox token, are in this
            browser&rsquo;s <strong>IndexedDB</strong>. They are not encrypted by this app —
            they are as protected as the browser profile they sit in.
          </li>
          <li>
            Your theme choice and the Dropbox app id are in <code>localStorage</code>. Neither
            is personal data, and neither is a credential: the app id is a public identifier
            that ships in the JavaScript anyway.
          </li>
          <li>
            While you are signing in to Dropbox, a piece of pending OAuth state sits in{' '}
            <code>sessionStorage</code> and is cleared when the redirect finishes.
          </li>
          <li>
            A Content Security Policy restricts what this page is allowed to load and connect
            to. The only external origins it permits are Dropbox&rsquo;s two APIs, and nothing
            works without that permission.
          </li>
        </ul>

        <h3>If you connect Dropbox</h3>
        <ul>
          <li>
            Syncing writes <strong>one JSON file</strong> to your own Dropbox account, and
            nothing is written anywhere else.
          </li>
          <li>
            <strong>That file is not encrypted by this app.</strong> It is ordinary JSON, in
            readable text, in your Dropbox account. Dropbox encrypts it at rest and controls who
            can read it, but there is no passphrase from this app on top. Anyone with access to
            the file can read your work history, and so can Dropbox under a court order or a
            service change. That was a deliberate choice over client-side encryption, not an
            oversight — see 0011 &sect;Accepted risks.
          </li>
          <li>
            So the protection on that account is entirely your account&rsquo;s: a strong unique
            password, two-factor authentication, and app-specific authorisation where Dropbox
            offers it.
          </li>
          <li>
            Disconnecting stops syncing and deletes the stored token. It does not touch what is
            already in your Dropbox, and it does not touch this browser either.
          </li>
        </ul>

        <h3>If you want it gone</h3>
        <p>
          Clearing this site&rsquo;s data in your browser removes everything, including the
          running timer. Deleting the file from your Dropbox removes the copy that left this
          device. There is nothing else, because there is nowhere else.
        </p>
      </section>

      <section className="panel" aria-labelledby="feedback-heading">
        <h2 id="feedback-heading">Found a problem?</h2>
        <p>
          This is a small project and problems are read and usually fixed. If something did not
          work, or worked in a way you did not expect,{' '}
          <a className="link-button" href={NEW_ISSUE_URL} rel="noreferrer noopener">
            open an issue
          </a>
          . A sentence about what you did and what you expected is worth more than a
          reproduction you have not had time to write down.
        </p>
        <p className="hint">
          Please do not attach a backup file to an issue. A backup contains your work, and a
          public issue is the last place it belongs. If a specific entry is the problem,
          describe it in words. The code is at{' '}
          <a href={REPOSITORY_URL} rel="noreferrer noopener">
            the repository
          </a>
          .
        </p>
      </section>

      <section className="panel about-changelog" aria-labelledby="changelog-heading">
        <div className="panel-header">
          <h2 id="changelog-heading">What&rsquo;s new</h2>
        </div>
        <p className="hint">
          The full history, from the same file this is rendered from: <code>CHANGELOG.md</code>{' '}
          in the repository.
        </p>
        <Changelog source={changelog} />
      </section>
    </>
  )
}

/**
 * Render the changelog subset.
 *
 * Kept deliberately small. A general Markdown renderer would be more code than the thing it
 * renders, and more surface for something to go subtly wrong.
 */
function Changelog({ source }: { source: string }): ReactNode {
  const blocks: ReactNode[] = []
  let list: string[] = []
  /**
   * Prose being accumulated, flushed when a heading, a bullet or a blank line interrupts.
   *
   * Null means "no paragraph in progress", which is different from an empty one — a blank
   * line has to end the current paragraph rather than start an empty one. The text is
   * buffered rather than accumulated into already-rendered nodes, because joining into a
   * React element would mean reading it back out again to append to it.
   */
  let paragraph: string | null = null

  function flushParagraph(): void {
    if (paragraph === null) return
    blocks.push(<p key={`p-${blocks.length}`}>{inline(paragraph)}</p>)
    paragraph = null
  }

  function flushList(): void {
    if (list.length === 0) return
    const items = list
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {items.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </ul>,
    )
    list = []
  }

  for (const raw of source.split('\n')) {
    const line = raw.trimEnd()

    if (line.trim() === '') {
      // A blank line ends both a paragraph and a list. Forgetting the paragraph is how
      // wrapped prose ended up as one `<p>` per source line.
      flushParagraph()
      flushList()
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      const level = (heading[1] ?? '').length
      // Keep a Changelog writes versions as `[Unreleased]` / `[0.1.0]`. The brackets are
      // link syntax for GitHub, and they read as leftover syntax in a rendered heading.
      const text = (heading[2] ?? '').replace(/^\[(.*)\]$/, '$1')
      // The file's own title is dropped: the card already has a heading, and two h1s on one
      // page is a document outline problem, not a style preference.
      if (level === 1) continue
      blocks.push(
        <Fragment key={`h-${blocks.length}`}>
          {level === 2 ? <h3>{inline(text)}</h3> : <h4>{inline(text)}</h4>}
        </Fragment>,
      )
      continue
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      flushParagraph()
      list.push(bullet[1] ?? '')
      continue
    }

    /*
     * Anything else is prose, and both halves of the old handling of it were wrong.
     *
     * The file wraps at ~95 columns with no indentation, so a wrapped paragraph arrives as
     * several lines that have to become ONE `<p>`. The old guard joined a continuation only
     * when a bullet list was open (`list.length > 0`), so every wrapped *prose* line became
     * its own paragraph — split mid-sentence, with margins between the halves, directly
     * under the first heading a user sees.
     *
     * It also dropped every paragraph before the first heading, via `blocks.length > 0`.
     * That clause was doing double duty: `level === 1` above already handles the file's own
     * `# Changelog` title, so the test silently discarded the preamble while it stayed in
     * the bundle for every visitor to download. Omitted by accident, by a guard written to
     * solve a different problem.
     *
     * The text is buffered rather than accumulated into already-rendered nodes, because
     * joining into a React element would mean reading it back out again to append to it.
     */
    paragraph = paragraph === null ? line.trim() : `${paragraph} ${line.trim()}`
  }
  flushParagraph()
  flushList()

  return <div className="changelog">{blocks}</div>
}

/** `**bold**` and `` `code` ``, as React nodes. Nothing is ever injected as markup. */
function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(<strong key={match.index}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      nodes.push(<code key={match.index}>{token.slice(1, -1)}</code>)
    } else {
      // Links appear in the changelog pointing at repository files, which do not exist in
      // a deployed bundle. Shown as their text rather than as a link that 404s.
      const label = /\[([^\]]+)\]/.exec(token)?.[1] ?? token
      nodes.push(<em key={match.index}>{label}</em>)
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}
