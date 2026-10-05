import { Fragment, type ReactNode } from 'react'
import changelog from '../../CHANGELOG.md?raw'

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
          Your display preferences — theme, chosen currencies, entries period — are kept per
          device rather than synced. They are preferences rather than data, and they are not
          included in a backup either.
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
