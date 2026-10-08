import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HeaderMenu } from './HeaderMenu'
import { installTestDb } from '../../test/harness'

/**
 * The header menu (items 18, 26 and 29).
 *
 * The menu was reduced to a fixed set of named actions because a menu has nowhere to explain
 * a button. That reasoning is about *prose*, not about the count — and About arrived later
 * as a fourth item, so the count assertion here is four while the "no prose, each action
 * named" rule still holds.
 *
 * The browser suite covers the geometry, since stacking and the 320px layout are only real
 * questions in a real browser. These cover the things a browser cannot be asked about as
 * easily: the accessible names, and whether the menu closes itself.
 */

let user: UserEvent

beforeEach(() => {
  installTestDb()
  user = userEvent.setup()
})

/** Open the menu and return its panel, which is unmounted while closed. */
async function open(): Promise<HTMLElement> {
  render(<HeaderMenu settingsHref="#/settings" aboutHref="#/about" />)
  await user.click(screen.getByTestId('header-menu-toggle'))
  return screen.getByTestId('header-menu-panel')
}

describe('the header menu', () => {
  it('holds settings, the two backup actions and About', async () => {
    const panel = await open()

    expect(
      [...panel.querySelectorAll('.header-menu-item')].map((item) => item.textContent?.trim()),
    ).toEqual(['Settings', 'download', 'import', 'About'])
  })

  it('names each action with the word beside its icon, not an aria-label', async () => {
    const panel = await open()

    // A control whose visible text and accessible name differ is announced twice and
    // confuses voice-control users. The word on the control is the name.
    for (const name of ['Settings', 'download', 'import', 'About']) {
      const item = within(panel).getByText(name).closest('.header-menu-item')
      expect(item, `no control labelled ${name}`).not.toBeNull()
      expect(item?.getAttribute('aria-label')).toBeNull()
    }
  })

  it('carries an icon on every action', async () => {
    const panel = await open()

    expect(panel.querySelectorAll('.header-menu-item svg')).toHaveLength(4)
  })

  it('points About at the route it was given, rather than a hard-coded path', async () => {
    await open()

    expect(screen.getByTestId('header-menu-about')).toHaveAttribute('href', '#/about')
  })

  it('closes behind About, so the panel does not sit over the page it opened', async () => {
    await open()
    await user.click(screen.getByTestId('header-menu-about'))

    // Without this the panel stays mounted over the About page, and the menu toggle still
    // reads as expanded on a screen that is not the home screen.
    expect(screen.queryByTestId('header-menu-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('header-menu-toggle')).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the file picker from the import button', async () => {
    /*
     * The second of two dead restore buttons.
     *
     * `useBackup` created the ref, dereferenced it in `chooseFile`, and returned neither,
     * so this component attached its *own* ref to the input and left the hook's `null`.
     * `chooseFile` ran `null?.click()`, which does nothing — no error, no state change.
     * The whole import half of 0008 was unreachable from here.
     *
     * Asserted per surface, because both surfaces render a backup control and either one
     * can drift back to owning its own ref. Nothing about the ref crossing a module
     * boundary is visible to the type system here, so it needs a test rather than a type.
     */
    render(<HeaderMenu settingsHref="#/settings" aboutHref="#/about" />)
    await user.click(screen.getByTestId('header-menu-toggle'))
    const input = document.querySelector<HTMLInputElement>('[data-testid="backup-file"]')
    if (!input) throw new Error('no file input')
    const clicked = vi.fn()
    input.click = clicked

    await user.click(screen.getByTestId('header-menu-restore'))

    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape and gives the toggle its focus back', async () => {
    await open()
    await user.keyboard('{Escape}')

    expect(screen.queryByTestId('header-menu-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('header-menu-toggle')).toHaveFocus()
  })

  it('renders nothing but the toggle while closed', () => {
    render(<HeaderMenu settingsHref="#/settings" aboutHref="#/about" />)

    // Mounting the whole panel to keep it out of the DOM would run the backup reads on
    // every page load, which is the thing item 26 moved the panel out of.
    expect(screen.queryByTestId('header-menu-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('header-menu-toggle')).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes when the hash changes without a click', async () => {
    render(<HeaderMenu settingsHref="#/settings" aboutHref="#/about" />)
    // The two menu links close themselves on click, which covers every route the menu
    // offers and nothing else. Back, forward, or a typed URL change the hash with no click,
    // and the panel used to survive — an absolutely-positioned overlay on the page the user
    // just went to, swallowing the clicks meant for it. Found by the browser suite, which
    // navigates the way a browser does rather than the way a test usually does.
    await user.click(screen.getByTestId('header-menu-toggle'))
    expect(screen.getByTestId('header-menu-panel')).toBeInTheDocument()

    window.location.hash = '#/settings'

    await waitFor(() => expect(screen.queryByTestId('header-menu-panel')).toBeNull())
  })
})
