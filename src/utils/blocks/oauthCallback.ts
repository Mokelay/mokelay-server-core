import { type BlockExecutor } from '../orchestration-schema.js'
import { mokelayError } from '../mokelay-error.js'
import { setSessionValue } from '../session.js'
import {
  consumeOAuthTempSession,
  exchangeOAuthCode,
  githubProfileFromTokenResponse,
  googleProfileFromTokenResponse,
  normalizeOAuthProvider,
  oauthCallbackUrl,
  oauthFinalRedirectUrl,
  oauthLoginRedirectUrl,
  resolveOAuthUser,
} from './oauthShared.js'

function stringInput(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function booleanInput(value: unknown, defaultValue: boolean) {
  return typeof value === 'boolean' ? value : defaultValue
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "oauthCallback",
 *   "displayName": "处理 OAuth 回调",
 *   "category": "auth",
 *   "description": "处理 OAuth callback，创建或绑定 Mokelay employee，并写入 user session。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "Mokelay 用户库数据源，对应 ${datasource}_DATABASE_URL。" },
 *     { "key": "provider", "type": "google|github", "required": true, "description": "OAuth provider。" },
 *     { "key": "code", "type": "string", "required": false, "description": "Provider callback code。" },
 *     { "key": "state", "type": "string", "required": false, "description": "Provider callback state。" },
 *     { "key": "error", "type": "string", "required": false, "description": "Provider callback error。" },
 *     { "key": "autoCreateEnterprise", "type": "boolean", "required": false, "defaultValue": true, "description": "首次登录时是否自动创建企业。" }
 *   ],
 *   "outputs": [
 *     { "key": "user", "type": "EmployeeSession|null", "description": "登录成功后的用户 session；失败时为 null。" },
 *     { "key": "isNewUser", "type": "boolean", "description": "是否新建了用户。" },
 *     { "key": "linkedIdentity", "type": "boolean", "description": "是否新绑定了第三方身份。" },
 *     { "key": "provider", "type": "string", "description": "标准化后的 provider。" },
 *     { "key": "redirectUrl", "type": "string", "description": "最终跳转地址。" },
 *     { "key": "errorCode", "type": "string|null", "description": "业务失败原因；成功时为 null。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_OAUTH_PROVIDER_INVALID", "description": "provider 不受支持。" },
 *     { "code": "BLOCK_OAUTH_PROVIDER_FAILED", "description": "Provider token/profile 请求失败或 callback 处理失败。" },
 *     { "code": "BLOCK_OAUTH_EMAIL_UNVERIFIED", "description": "Provider 邮箱未验证。" },
 *     { "code": "BLOCK_OAUTH_ACCOUNT_CONFLICT", "description": "第三方身份与已有账号冲突。" }
 *   ],
 *   "config": [
 *     { "key": "GOOGLE_OAUTH_CLIENT_ID", "type": "string", "required": false, "description": "Google OAuth client id。" },
 *     { "key": "GOOGLE_OAUTH_CLIENT_SECRET", "type": "string", "required": false, "description": "Google OAuth client secret。" },
 *     { "key": "GITHUB_OAUTH_CLIENT_ID", "type": "string", "required": false, "description": "GitHub OAuth client id。" },
 *     { "key": "GITHUB_OAUTH_CLIENT_SECRET", "type": "string", "required": false, "description": "GitHub OAuth client secret。" }
 *   ],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要 datasource，用于读取/写入 employee 与 OAuth identity。" },
 *     { "key": "sideEffect", "type": "string", "value": "set-cookie-and-database-write", "description": "成功时写入用户 session，必要时创建用户或绑定身份。" }
 *   ],
 *   "examples": [
 *     { "title": "处理 Google OAuth callback", "block": { "uuid": "handle_google_callback", "functionName": "oauthCallback", "inputs": { "datasource": "Mokelay", "provider": "google", "code": { "template": "{{request.query.code}}" }, "state": { "template": "{{request.query.state}}" }, "error": { "template": "{{request.query.error}}" } }, "outputs": ["user", "isNewUser", "linkedIdentity", "provider", "redirectUrl", "errorCode"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeOAuthCallbackBlock: BlockExecutor = async ({ event, inputs, executeSql, databaseType }) => {
  const provider = normalizeOAuthProvider(inputs.provider)
  const providerError = stringInput(inputs.error)

  if (providerError) {
    return {
      user: null,
      isNewUser: false,
      linkedIdentity: false,
      provider,
      redirectUrl: oauthLoginRedirectUrl('provider_denied'),
      errorCode: 'provider_denied',
    }
  }

  const code = stringInput(inputs.code)
  const state = stringInput(inputs.state)

  if (!code) {
    return {
      user: null,
      isNewUser: false,
      linkedIdentity: false,
      provider,
      redirectUrl: oauthLoginRedirectUrl('missing_code'),
      errorCode: 'missing_code',
    }
  }

  let session

  try {
    session = consumeOAuthTempSession(event)
  } catch {
    return {
      user: null,
      isNewUser: false,
      linkedIdentity: false,
      provider,
      redirectUrl: oauthLoginRedirectUrl('invalid_state'),
      errorCode: 'invalid_state',
    }
  }

  if (session.provider !== provider || !state || session.state !== state) {
    return {
      user: null,
      isNewUser: false,
      linkedIdentity: false,
      provider,
      redirectUrl: oauthLoginRedirectUrl('invalid_state', session),
      errorCode: 'invalid_state',
    }
  }

  try {
    const tokenResponse = await exchangeOAuthCode(provider, code, session.codeVerifier, oauthCallbackUrl(event, provider))
    const profile = provider === 'google'
      ? googleProfileFromTokenResponse(tokenResponse)
      : await githubProfileFromTokenResponse(tokenResponse)
    const result = await resolveOAuthUser(
      executeSql,
      profile,
      booleanInput(inputs.autoCreateEnterprise, true),
      databaseType,
    )

    setSessionValue(event, 'user', result.user)

    return {
      user: result.user,
      isNewUser: result.isNewUser,
      linkedIdentity: result.linkedIdentity,
      provider,
      redirectUrl: oauthFinalRedirectUrl(session),
      errorCode: null,
    }
  } catch (error) {
    const code = typeof error === 'object'
      && error
      && 'data' in error
      && typeof error.data === 'object'
      && error.data
      && 'code' in error.data
      ? error.data.code
      : undefined

    if (code === 'BLOCK_OAUTH_EMAIL_UNVERIFIED') {
      return {
        user: null,
        isNewUser: false,
        linkedIdentity: false,
        provider,
        redirectUrl: oauthLoginRedirectUrl('email_unverified', session),
        errorCode: 'email_unverified',
      }
    }

    if (code === 'BLOCK_OAUTH_ACCOUNT_CONFLICT') {
      return {
        user: null,
        isNewUser: false,
        linkedIdentity: false,
        provider,
        redirectUrl: oauthLoginRedirectUrl('account_conflict', session),
        errorCode: 'account_conflict',
      }
    }

    if (code === 'BLOCK_OAUTH_PROVIDER_FAILED') {
      return {
        user: null,
        isNewUser: false,
        linkedIdentity: false,
        provider,
        redirectUrl: oauthLoginRedirectUrl('provider_failed', session),
        errorCode: 'provider_failed',
      }
    }

    throw mokelayError('BLOCK_OAUTH_PROVIDER_FAILED', 'OAuth callback 处理失败。', 502, error)
  }
}
