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
  resolveOAuthUser,
} from './oauthShared.js'

function stringInput(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function booleanInput(value: unknown, defaultValue: boolean) {
  return typeof value === 'boolean' ? value : defaultValue
}

function loginRedirect(errorCode: string) {
  return `/login?oauth_error=${encodeURIComponent(errorCode)}`
}

/**
 * oauthCallback block
 * 作用：处理 OAuth callback，创建或绑定 Mokelay employee，并写入 user session。
 * inputs：provider/datasource/code/state 等 callback 参数。
 * outputs：user、isNewUser、linkedIdentity、provider、redirectUrl、errorCode。
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
      redirectUrl: loginRedirect('provider_denied'),
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
      redirectUrl: loginRedirect('missing_code'),
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
      redirectUrl: loginRedirect('invalid_state'),
      errorCode: 'invalid_state',
    }
  }

  if (session.provider !== provider || !state || session.state !== state) {
    return {
      user: null,
      isNewUser: false,
      linkedIdentity: false,
      provider,
      redirectUrl: loginRedirect('invalid_state'),
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
        redirectUrl: loginRedirect('email_unverified'),
        errorCode: 'email_unverified',
      }
    }

    if (code === 'BLOCK_OAUTH_ACCOUNT_CONFLICT') {
      return {
        user: null,
        isNewUser: false,
        linkedIdentity: false,
        provider,
        redirectUrl: loginRedirect('account_conflict'),
        errorCode: 'account_conflict',
      }
    }

    if (code === 'BLOCK_OAUTH_PROVIDER_FAILED') {
      return {
        user: null,
        isNewUser: false,
        linkedIdentity: false,
        provider,
        redirectUrl: loginRedirect('provider_failed'),
        errorCode: 'provider_failed',
      }
    }

    throw mokelayError('BLOCK_OAUTH_PROVIDER_FAILED', 'OAuth callback 处理失败。', 502, error)
  }
}
