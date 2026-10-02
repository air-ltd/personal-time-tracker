import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'

beforeEach(() => {
  window.location.hash = ''
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('App shell', () => {
  // 0002 R2: a bare visit to the site root must render the app, not a blank page.
  it('renders the shell with no hash present', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Time Tracker' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('renders the placeholder route at the root', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { level: 2, name: 'Nothing here yet' }),
    ).toBeInTheDocument()
  })

  // 0002 R3: an unknown hash shows a not-found view inside the shell.
  it('renders not-found for an unrouted path without throwing', () => {
    window.location.hash = '#/definitely-not-a-route'
    render(<App />)
    expect(
      screen.getByRole('heading', { level: 2, name: 'Page not found' }),
    ).toBeInTheDocument()
    expect(screen.getByText('/definitely-not-a-route')).toBeInTheDocument()
  })

  it('ignores a query string when matching', () => {
    window.location.hash = '#/?range=week'
    render(<App />)
    expect(
      screen.getByRole('heading', { level: 2, name: 'Nothing here yet' }),
    ).toBeInTheDocument()
  })
})

describe('theme control', () => {
  // 0002 TH1: light, dark, or follow the system, with system as the default.
  it('defaults to following the system preference', () => {
    render(<App />)
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()
  })

  it('applies and persists a chosen theme', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('radio', { name: 'Dark' }))

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('tt:theme')).toBe('dark')
  })

  it('exposes all three options to assistive tech rather than hiding state', () => {
    render(<App />)
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('group', { name: 'Colour theme' })).toBeInTheDocument()
  })
})
