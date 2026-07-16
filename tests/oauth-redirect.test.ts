import { afterEach, describe, expect, it } from 'vitest'
import { oauthLoginRedirectUrl, type OAuthTempSession } from '../src/utils/blocks/oauthShared.js'

const originalOAuthAppBaseUrl = process.env.OAUTH_APP_BASE_URL

afterEach(() => {
  if (originalOAuthAppBaseUrl === undefined) delete process.env.OAUTH_APP_BASE_URL
  else process.env.OAUTH_APP_BASE_URL = originalOAuthAppBaseUrl
})

describe('OAuth login redirect', () => {
  it('returns OAuth failures to website login while preserving an editor retry target', () => {
    process.env.OAUTH_APP_BASE_URL = 'https://www.mokelay.com'
    const session: OAuthTempSession = {
      provider: 'google',
      state: 'state',
      codeVerifier: 'verifier',
      redirect: '/#/pages/example',
      redirectOrigin: 'https://editor.mokelay.com',
      createdAt: new Date().toISOString(),
    }

    const redirect = new URL(oauthLoginRedirectUrl('provider_denied', session))
    expect(redirect.origin).toBe('https://www.mokelay.com')
    expect(redirect.pathname).toBe('/login')
    expect(redirect.searchParams.get('oauth_error')).toBe('provider_denied')
    expect(redirect.searchParams.get('redirect')).toBe('/#/pages/example')
    expect(redirect.searchParams.get('redirect_origin')).toBe('https://editor.mokelay.com')
  })
})
