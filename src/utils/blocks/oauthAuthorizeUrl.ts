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
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "oauthAuthorizeUrl",
 *   "displayName": "生成 OAuth 授权地址",
 *   "category": "auth",
 *   "description": "生成 OAuth provider 授权 URL，并将 state、PKCE verifier 和 redirect 写入临时编排 session。",
 *   "inputs": [
 *     { "key": "provider", "type": "google|github", "required": true, "description": "OAuth provider。" },
 *     { "key": "redirect", "type": "string", "required": false, "description": "授权完成后的站内相对跳转地址。" },
 *     { "key": "redirectOrigin", "type": "string", "required": false, "description": "前端跳转 origin；未传时从请求推导。" },
 *     { "key": "scopes", "type": "string[]", "required": false, "description": "OAuth scope；未传时使用 provider 默认值。" }
 *   ],
 *   "outputs": [
 *     { "key": "redirectUrl", "type": "string", "description": "Provider 授权 URL。" },
 *     { "key": "provider", "type": "string", "description": "标准化后的 provider。" },
 *     { "key": "state", "type": "string", "description": "本次授权 state。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_OAUTH_PROVIDER_INVALID", "description": "provider 不受支持。" },
 *     { "code": "BLOCK_OAUTH_REDIRECT_INVALID", "description": "redirect 或 redirectOrigin 不合法。" },
 *     { "code": "BLOCK_OAUTH_CONFIG_MISSING", "description": "provider client id 配置缺失。" }
 *   ],
 *   "config": [
 *     { "key": "GOOGLE_OAUTH_CLIENT_ID", "type": "string", "required": false, "description": "Google OAuth client id。" },
 *     { "key": "GITHUB_OAUTH_CLIENT_ID", "type": "string", "required": false, "description": "GitHub OAuth client id。" }
 *   ],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "sideEffect", "type": "string", "value": "set-cookie", "description": "会写入临时 OAuth session。" }
 *   ],
 *   "examples": [
 *     { "title": "开始 Google OAuth", "block": { "uuid": "oauth_google_start", "functionName": "oauthAuthorizeUrl", "inputs": { "provider": "google", "redirect": "/dashboard" }, "outputs": ["redirectUrl", "provider", "state"], "nextBlock": null } }
 *   ]
 * }
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
