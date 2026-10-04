import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AboutPage } from './AboutPage'

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
