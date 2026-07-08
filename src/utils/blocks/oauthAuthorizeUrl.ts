import { type BlockExecutor } from '../orchestration-schema.js'
import {
  defaultOAuthScopes,
  normalizeOAuthProvider,
  normalizeOAuthRedirectOrigin,
  normalizeRelativeRedirect,
  oauthCallbackUrl,
  oauthClientId,
  pkceChallenge,
  providerAuthorizeUrl,
  randomOAuthValue,
  storeOAuthTempSession,
} from './oauthShared.js'

function normalizeScopes(value: unknown, provider: ReturnType<typeof normalizeOAuthProvider>) {
  if (!Array.isArray(value) || value.length === 0) {
    return defaultOAuthScopes(provider)
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}

/**
 * oauthAuthorizeUrl block
 * 作用：生成 OAuth provider 授权 URL，并将 state/PKCE/redirect 写入临时编排 session。
 * inputs：provider 必填；redirect 可选且只能是站内相对路径；scopes 可选。
 * outputs：redirectUrl、provider、state。
 */
export const executeOAuthAuthorizeUrlBlock: BlockExecutor = async ({ event, inputs }) => {
  const provider = normalizeOAuthProvider(inputs.provider)
  const redirect = normalizeRelativeRedirect(inputs.redirect)
  const redirectOrigin = normalizeOAuthRedirectOrigin(event, inputs.redirectOrigin)
  const state = randomOAuthValue()
  const codeVerifier = randomOAuthValue()
  const callbackUrl = oauthCallbackUrl(event, provider)
  const url = new URL(providerAuthorizeUrl(provider))

  url.searchParams.set('client_id', oauthClientId(provider))
  url.searchParams.set('redirect_uri', callbackUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', normalizeScopes(inputs.scopes, provider).join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', pkceChallenge(codeVerifier))
  url.searchParams.set('code_challenge_method', 'S256')

  if (provider === 'google') {
    url.searchParams.set('access_type', 'online')
    url.searchParams.set('prompt', 'select_account')
  }

  storeOAuthTempSession(event, {
    provider,
    state,
    codeVerifier,
    redirect,
    redirectOrigin,
    createdAt: new Date().toISOString(),
  })

  return {
    redirectUrl: url.toString(),
    provider,
    state,
  }
}
