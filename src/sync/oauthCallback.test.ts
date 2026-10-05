import { beforeEach, describe, expect, it } from 'vitest'
import { completeAuthFromRedirect } from './oauthCallback'
import { indexedDbTokenStore } from '../storage/secretsRepo'
import { installTestDb } from '../test/harness'
import { resetProvider } from './providerFactory'

/**
 * The OAuth redirect handler (0012 AU8).
 *
 * These cover the failure behind `SPECS/todo.md` item 7, where an authorisation
 * appeared to succeed and then reported "not connected".
 */

function setQuery(params: Record<string, string>) {
  const search = new URLSearchParams(params).toString()
  window.history.replaceState({}, '', `/personal-time-tracker/${search ? `?${search}` : ''}`)
}

beforeEach(() => {
  installTestDb()
  resetProvider()
  indexedDbTokenStore.clear().catch(() => undefined)
  window.sessionStorage.clear()
  setQuery({})
})

describe('with no OAuth parameters', () => {
  it('does nothing and leaves the query string alone', async () => {
    expect(await completeAuthFromRedirect()).toBe(false)
    expect(window.location.search).toBe('')
  })
})

describe('when Dropbox reports a problem', () => {
  // A declined consent or a missing scope arrives as an error parameter. Swallowing
  // it silently is what made the original symptom undiagnosable.
  it('logs and does not throw', async () => {
    const warn = console.warn
    const messages: string[] = []
    // Capture every argument: the label and the actual reason are logged separately.
    console.warn = (...args: unknown[]) => messages.push(args.map(String).join(' '))
    try {
      setQuery({ error: 'access_denied', error_description: 'The user denied the request' })
      expect(await completeAuthFromRedirect()).toBe(false)
    } finally {
      console.warn = warn
    }
    // The full reason is included, not just a generic failure.
    expect(messages.join(' ')).toMatch(/denied the request/)
  })

  it('clears the code from the URL so a reload cannot replay it', async () => {
    const warn = console.warn
    console.warn = () => undefined
    try {
      setQuery({ error: 'access_denied' })
      await completeAuthFromRedirect()
    } finally {
      console.warn = warn
    }
    expect(window.location.search).toBe('')
  })
})

describe('when there is no pending authorisation', () => {
  it('fails without attempting a token exchange', async () => {
    const warn = console.warn
    console.warn = () => undefined
    try {
      setQuery({ code: 'stray-code', state: 'stray-state' })
      expect(await completeAuthFromRedirect()).toBe(false)
      expect(await indexedDbTokenStore.read()).toBeNull()
    } finally {
      console.warn = warn
    }
  })
})
