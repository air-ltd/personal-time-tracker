import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DropboxSetup } from './DropboxSetup'
import { APP_KEY_STORAGE_KEY, readAppKey } from '../../sync/appKey'

beforeEach(() => {
  window.localStorage.clear()
})

describe('in-browser Dropbox setup (SPECS/todo.md item 6)', () => {
  it('saves a key so no rebuild is needed', async () => {
    const user = userEvent.setup()
    const onConfigured = vi.fn()
    render(<DropboxSetup onConfigured={onConfigured} />)

    await user.type(screen.getByLabelText('Dropbox App key'), '1a2b3c4d5e6f7g8')
    await user.click(screen.getByRole('button', { name: 'Save key' }))

    expect(readAppKey()).toBe('1a2b3c4d5e6f7g8')
    // Confirmation is the parent swapping in the Connect controls, not a message:
    // a "saved" notice in this component is unreachable once that swap happens.
    expect(onConfigured).toHaveBeenCalled()
  })

  it('rejects a pasted URL with a message naming the mistake', async () => {
    const user = userEvent.setup()
    render(<DropboxSetup onConfigured={() => {}} />)

    await user.type(screen.getByLabelText('Dropbox App key'), 'https://console.dropbox.com')
    await user.click(screen.getByRole('button', { name: 'Save key' }))

    const error = await screen.findByTestId('app-key-error')
    expect(error).toHaveTextContent(/App key field, not the App secret or a URL/)
    expect(window.localStorage.getItem(APP_KEY_STORAGE_KEY)).toBeNull()
  })

  it('rejects an empty submission', async () => {
    const user = userEvent.setup()
    render(<DropboxSetup onConfigured={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Save key' }))
    expect(await screen.findByTestId('app-key-error')).toHaveTextContent(/Paste the App key/)
  })

  it('forgets a stored key', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(APP_KEY_STORAGE_KEY, '1a2b3c4d5e6f7g8')
    render(<DropboxSetup onConfigured={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Forget key' }))
    expect(window.localStorage.getItem(APP_KEY_STORAGE_KEY)).toBeNull()
  })

  it('notifies the caller so the provider is rebuilt', async () => {
    const user = userEvent.setup()
    let calls = 0
    render(
      <DropboxSetup
        onConfigured={() => {
          calls += 1
        }}
      />,
    )

    await user.type(screen.getByLabelText('Dropbox App key'), '1a2b3c4d5e6f7g8')
    await user.click(screen.getByRole('button', { name: 'Save key' }))
    expect(calls).toBe(1)
  })

  // The instructions live in the app because the console's wording changes and the
  // redirect URI is the part people get wrong.
  it('shows the instructions in the browser', () => {
    render(<DropboxSetup onConfigured={() => {}} />)
    expect(screen.getByText('How to get an App key from Dropbox')).toBeInTheDocument()
    expect(screen.getByText('Redirect URIs to register')).toBeInTheDocument()
  })

  it('shows the deployed URI and the current one, both with trailing slashes', () => {
    render(<DropboxSetup onConfigured={() => {}} />)
    const uris = screen.getAllByText(/https?:\/\/.+\/$/).map((el) => el.textContent ?? '')
    expect(uris).toContain('https://air-ltd.github.io/personal-time-tracker/')
    expect(uris.some((uri) => uri.includes('/personal-time-tracker/'))).toBe(true)
    expect(uris.every((uri) => uri.endsWith('/'))).toBe(true)
  })

  it('warns that the App secret is not needed', () => {
    render(<DropboxSetup onConfigured={() => {}} />)
    expect(screen.getByText(/Ignore the App secret entirely/i)).toBeInTheDocument()
  })

  it('says the key is public rather than implying it is a secret', () => {
    render(<DropboxSetup onConfigured={() => {}} />)
    expect(screen.getByText(/Public identifier, not a password/i)).toBeInTheDocument()
  })
})
