import { useState } from 'react'
import {
  clearAppKey,
  describeKeySource,
  hasLegacyStoredKey,
  readAppKey,
} from '../../sync/appKey'
import { currentRedirectUri } from '../../sync/oauthCallback'
import { SCOPES as REQUIRED_SCOPES } from '../../sync/dropbox/config'

/**
 * Dropbox configuration display and setup instructions.
 *
 * Read-only by design. The app key used to be entered here and saved to
 * localStorage, but a saved key silently overrode the host-based selection and then
 * paired with the wrong Dropbox app's redirect URI — which Dropbox rejects as
 * "Invalid redirect_uri" without saying which half is wrong. Two built-in keys cover
 * both environments, so there is nothing left to enter.
 *
 * Showing the key and the redirect URI side by side is what makes that class of
 * mismatch diagnosable: the two must be registered on the same app.
 */

interface Props {
  onConfigured: () => void
}

export function DropboxSetup({ onConfigured }: Props) {
  const [copied, setCopied] = useState<'key' | 'redirect' | 'scopes' | null>(null)
  const [legacyCleared, setLegacyCleared] = useState(false)

  const { source, environment } = describeKeySource()
  const key = readAppKey()
  const redirectUri = currentRedirectUri()
  const hasLegacy = hasLegacyStoredKey()

  async function copy(value: string, which: 'key' | 'redirect' | 'scopes') {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(which)
    } catch {
      // Clipboard blocked. Everything needed is on screen, so this is not an error.
      setCopied(null)
    }
  }

  const sourceLabel: Record<typeof source, string> = {
    environment: 'from build configuration',
    builtin: `built in for the ${environment} environment`,
  }

  function onClearLegacy() {
    clearAppKey()
    setLegacyCleared(true)
    onConfigured()
  }

  return (
    <div className="sync-setup">
      <div className="sync-current" data-testid="sync-current">
        <h3>In use right now</h3>
        <dl>
          <dt>App key</dt>
          <dd>
            <code data-testid="current-app-key">{key}</code>
            <span className="hint"> — {sourceLabel[source]}</span>
          </dd>
          <dt>Redirect URI</dt>
          <dd>
            <code data-testid="current-redirect-uri">{redirectUri}</code>
          </dd>
        </dl>
        <p className="hint">
          These two must be registered on the <em>same</em> Dropbox app. A mismatch is reported
          only as &ldquo;Invalid redirect_uri&rdquo;, so compare them when that appears.
        </p>
        <div className="button-row">
          <button type="button" className="button" onClick={() => void copy(key, 'key')}>
            Copy app key
          </button>
          <button
            type="button"
            className="button"
            onClick={() => void copy(redirectUri, 'redirect')}
          >
            Copy redirect URI
          </button>
        </div>
        {copied && (
          <span className="hint" role="status">
            Copied
          </span>
        )}
      </div>

      {hasLegacy && !legacyCleared && (
        <div className="alert alert-warning" data-testid="legacy-key-notice">
          <p>
            An earlier version saved a Dropbox key in this browser. It is{' '}
            <strong>ignored</strong> — the key above is used — but you can remove it.
          </p>
          <button type="button" className="button" onClick={onClearLegacy}>
            Remove saved key
          </button>
        </div>
      )}
      {legacyCleared && (
        <p className="hint" role="status" data-testid="legacy-key-cleared">
          Saved key removed.
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
            On the <strong>Permissions</strong> tab, tick exactly the two scopes below. Nothing
            else is needed.
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

        <h3>Scopes to enable</h3>
        <ul className="setup-scopes">
          {REQUIRED_SCOPES.map((scope) => (
            <li key={scope}>
              <code>{scope}</code>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="button"
          onClick={() => void copy(REQUIRED_SCOPES.join('\n'), 'scopes')}
        >
          Copy scopes
        </button>

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
          match, with nothing to go on. Each app needs both URIs if you want to authorise it
          from either place.
        </p>
      </details>
    </div>
  )
}
