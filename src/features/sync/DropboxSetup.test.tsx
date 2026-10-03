import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DropboxSetup } from './DropboxSetup'
import { currentRedirectUri, deployedRedirectUri } from '../../sync/redirect'
import { APP_KEY_STORAGE_KEY, readAppKey } from '../../sync/appKey'
import { BUILT_IN_KEYS } from '../../sync/appKey'

/**
 * The panel is read-only now.
 *
 * It used to collect and save a key, which silently overrode host selection and then
 * paired with the other Dropbox app's redirect URI — reported by Dropbox only as
 * "Invalid redirect_uri". Showing the key and the redirect URI together is what makes
 * that class of mismatch diagnosable.
 */
beforeEach(() => {
  window.localStorage.clear()
})

describe('what is in use', () => {
  it('shows the key and the redirect URI together', () => {
    render(<DropboxSetup onConfigured={() => {}} />)

    expect(screen.getByTestId('current-app-key')).toHaveTextContent(BUILT_IN_KEYS.development)
    // Asserted against runtime values, not a hardcoded URL: jsdom uses a different
    // port and vitest does not apply the build's base path. What matters is that the
    // URI shown is the one the OAuth request actually sends, which is what has to be
    // registered with Dropbox.
    expect(screen.getByTestId('current-redirect-uri')).toHaveTextContent(
      `${window.location.origin}/`,
    )
  })

  it('says where the key came from', () => {
    render(<DropboxSetup onConfigured={() => {}} />)
    expect(screen.getByText(/built in for the development environment/i)).toBeInTheDocument()
  })

  it('warns that the two must be registered on the same app', () => {
    render(<DropboxSetup onConfigured={() => {}} />)
    expect(screen.getByText(/must be registered on the/i)).toBeInTheDocument()
  })

  it('offers copies of both values', () => {
    render(<DropboxSetup onConfigured={() => {}} />)
    expect(screen.getByRole('button', { name: 'Copy app key' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy redirect URI' })).toBeInTheDocument()
  })
})

describe('a key saved by an earlier version', () => {
  it('is announced as ignored rather than silently affecting behaviour', () => {
    window.localStorage.setItem(APP_KEY_STORAGE_KEY, 'somelegacykey1')
    render(<DropboxSetup onConfigured={() => {}} />)

    const notice = screen.getByTestId('legacy-key-notice')
    expect(notice).toHaveTextContent(/ignored/i)
    // And it genuinely does not change what is used.
    expect(readAppKey()).toBe(BUILT_IN_KEYS.development)
  })

  it('can be removed, and the notice goes with it', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(APP_KEY_STORAGE_KEY, 'somelegacykey1')
    render(<DropboxSetup onConfigured={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Remove saved key' }))
    expect(window.localStorage.getItem(APP_KEY_STORAGE_KEY)).toBeNull()
    expect(await screen.findByTestId('legacy-key-cleared')).toBeInTheDocument()
  })

  it('offers no removal when there is nothing to remove', () => {
    render(<DropboxSetup onConfigured={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Remove saved key' })).not.toBeInTheDocument()
  })

  it('notifies the caller so the provider is rebuilt', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(APP_KEY_STORAGE_KEY, 'somelegacykey1')
    const onConfigured = vi.fn()
    render(<DropboxSetup onConfigured={onConfigured} />)

    await user.click(screen.getByRole('button', { name: 'Remove saved key' }))
    expect(onConfigured).toHaveBeenCalled()
  })
})

describe('instructions', () => {
  // The console's wording changes and the redirect URI is the part people get wrong,
  // so the steps live in the app rather than only in a file.
  it('shows the setup steps', () => {
    render(<DropboxSetup onConfigured={() => {}} />)
    expect(screen.getByText('How to get an App key from Dropbox')).toBeInTheDocument()
  })

  it('lists exactly the two scopes needed', () => {
    render(<DropboxSetup onConfigured={() => {}} />)
    expect(screen.getByText('files.content.read')).toBeInTheDocument()
    expect(screen.getByText('files.content.write')).toBeInTheDocument()
    expect(screen.getByText(/exactly the two scopes below/i)).toBeInTheDocument()
  })

  it('shows both redirect URIs with trailing slashes', () => {
    render(<DropboxSetup onConfigured={() => {}} />)
    const uris = screen.getAllByText(/^https?:\/\/.+\/$/).map((el) => el.textContent ?? '')
    // Expected from the same helpers the panel uses, not written out: the deployed path
    // follows the configured base so a renamed repository cannot leave the panel telling
    // the user to register a URI that no longer exists.
    expect(uris).toContain(deployedRedirectUri())
    expect(uris).toContain(currentRedirectUri())
    expect(uris.every((uri) => uri.endsWith('/'))).toBe(true)
  })

  it('warns that the App secret is not needed', () => {
    render(<DropboxSetup onConfigured={() => {}} />)
    expect(screen.getByText(/Ignore the App secret entirely/i)).toBeInTheDocument()
  })
})
