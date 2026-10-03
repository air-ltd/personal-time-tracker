import { useState } from 'react'
import { APP_KEY_STORAGE_KEY, clearAppKey, isValidAppKey, writeAppKey } from '../../sync/appKey'
import { currentRedirectUri } from '../../sync/oauthCallback'

/**
 * In-browser Dropbox setup (item 6 of `SPECS/todo.md`).
 *
 * The app key is an OAuth client id, not a secret, so it can be entered here rather
 * than baked into a build (0012 AU3, AR6). Instructions live alongside the field
 * because the console's wording changes and the redirect URI in particular is easy
 * to get subtly wrong — a mismatch fails authorisation with no useful error.
 */

interface Props {
  onConfigured: () => void
}

export function DropboxSetup({ onConfigured }: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const redirectUri = currentRedirectUri()

  function onSave() {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Paste the App key from the Dropbox App Console.')
      return
    }
    if (!isValidAppKey(trimmed)) {
      setError(
        'That does not look like an App key. It is a short lowercase alphanumeric string — paste the App key field, not the App secret or a URL.',
      )
      return
    }
    if (!writeAppKey(trimmed)) {
      // Stored for this session only; private browsing can block localStorage.
      setError(
        'Could not save the key. It will work for this session but not survive a reload.',
      )
    } else {
      setError(null)
    }
    // No success message: a valid key makes the parent swap this panel for the
    // Connect controls, and that swap is the confirmation. An on-screen "saved"
    // notice here would be unreachable in the real app.
    onConfigured()
  }

  function onForget() {
    clearAppKey()
    setValue('')
    setError(null)
    onConfigured()
  }

  return (
    <div className="sync-setup">
      <div className="field">
        <label htmlFor="dropbox-app-key">Dropbox App key</label>
        <input
          id="dropbox-app-key"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. 1a2b3c4d5e6f7g8"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          aria-describedby="dropbox-app-key-hint dropbox-app-key-error"
        />
        <p id="dropbox-app-key-hint" className="hint">
          Public identifier, not a password. Stored only in this browser, and never included in
          an export.
        </p>
      </div>

      <div className="button-row">
        <button type="button" className="button button-primary" onClick={onSave}>
          Save key
        </button>
        <button type="button" className="button" onClick={onForget}>
          Forget key
        </button>
      </div>

      {error && (
        <p className="alert alert-error" role="alert" data-testid="app-key-error">
          {error}
        </p>
      )}
      <details className="sync-setup-instructions">
        <summary>How to get an App key from Dropbox</summary>
        <ol className="setup-steps">
          <li>
            Sign in to Dropbox and open the{' '}
            <a href="https://console.dropbox.com" target="_blank" rel="noreferrer">
              App Console
            </a>
            . Use the same Dropbox account you want syncing to.
          </li>
          <li>
            Choose <strong>Create app</strong>. Set access type to{' '}
            <strong>Scoped access</strong>.
          </li>
          <li>
            Name the app, and choose <strong>App Folder</strong> for content access. This app
            writes a single file, and App Folder is the least access required.
          </li>
          <li>
            On the <strong>Permissions</strong> tab, enable: <code>files.content.read</code>,{' '}
            <code>files.content.write</code>, <code>files.metadata.read</code>,{' '}
            <code>account_info.read</code>. If the console offers{' '}
            <code>files.metadata.write</code>, enable it too — it is what makes a concurrent
            edit conflict instead of overwriting.
          </li>
          <li>
            Add <strong>both</strong> redirect URIs below, then save. A mismatch fails with no
            useful message, so copy them exactly.
          </li>
          <li>
            Copy the <strong>App key</strong> from the app&apos;s settings. Ignore the App
            secret entirely — this app uses PKCE and has no secret to keep.
          </li>
        </ol>

        <h3>Redirect URIs to register</h3>
        <ul className="setup-uris">
          <li>
            <code>https://air-ltd.github.io/personal-time-tracker/</code> — the deployed site
          </li>
          <li>
            <code>{redirectUri}</code> — this page, right now
          </li>
        </ul>
        <p className="hint">
          The trailing slash matters. Without it Dropbox reports only that the URI does not
          match, with nothing to go on.
        </p>
      </details>
    </div>
  )
}

export { APP_KEY_STORAGE_KEY }
