import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { getRequestHeader, type H3Event } from 'h3'
import { type DatabaseType } from '../db.js'
import { allowedOrigins } from '../cors.js'
import { mokelayError } from '../mokelay-error.js'
import { hashPassword } from '../password.js'
import { readSessionValue, removeSessionValue, setSessionValue } from '../session.js'
import { type SqlExecutor } from '../orchestration-schema.js'
import { requireDatabaseType } from './shared.js'

export type OAuthProvider = 'google' | 'github'

export type OAuthTempSession = {
  provider: OAuthProvider
  state: string
  codeVerifier: string
  redirect: string
  redirectOrigin?: string
  createdAt: string
}

export type PublicUser = {
  id: string
  enterprise_uuid: string
  enterprise_name: string
  name: string
  email: string
  plan: string
}

export type OAuthProfile = {
  provider: OAuthProvider
  providerUserId: string
  email: string
  emailVerified: boolean
  name: string
  raw: Record<string, unknown>
}

export type OAuthRegistration = {
  enterpriseName: string
  name: string
  email: string
  passwordHash: string
  provider: OAuthProvider
  providerUserId: string
  providerEmail: string
  emailVerified: boolean
  profile: Record<string, unknown>
}

export const oauthSessionKey = 'oauth'

const providerAuthorizeUrls: Record<OAuthProvider, string> = {
  google: 'https://accounts.google.com/o/oauth2/v2/auth',
  github: 'https://github.com/login/oauth/authorize',
}

const providerTokenUrls: Record<OAuthProvider, string> = {
  google: 'https://oauth2.googleapis.com/token',
  github: 'https://github.com/login/oauth/access_token',
}

const defaultScopes: Record<OAuthProvider, string[]> = {
  google: ['openid', 'email', 'profile'],
  github: ['read:user', 'user:email'],
}

type EmployeeRow = {
  id: string
  enterprise_uuid: string
  name: string
  email: string
  plan: string
  enterprise_name: string
}

type IdentityEmployeeRow = EmployeeRow & {
  provider_user_id: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export function normalizeOAuthProvider(value: unknown): OAuthProvider {
  if (value === 'google' || value === 'github') {
    return value
  }

  throw mokelayError('BLOCK_OAUTH_INPUT_INVALID', 'provider 必须是 google 或 github。', 400)
}

export function normalizeRelativeRedirect(value: unknown, fallback = '/dashboard') {
  const redirect = typeof value === 'string' && value.trim() ? value.trim() : fallback

  if (!redirect.startsWith('/') || redirect.startsWith('//') || redirect.includes('\\')) {
    throw mokelayError('BLOCK_OAUTH_INPUT_INVALID', 'redirect 必须是站内相对路径。', 400)
  }

  return redirect
}

function originFromUrl(value: string) {
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

export function normalizeOAuthRedirectOrigin(event: H3Event, value: unknown) {
  const origins = [
    typeof value === 'string' && value.trim() ? originFromUrl(value.trim()) : '',
    getRequestHeader(event, 'origin') || '',
    originFromUrl(getRequestHeader(event, 'referer') || ''),
    configuredOAuthAppOrigin(),
  ].filter(Boolean)

  if (origins.length === 0) {
    return undefined
  }

  const allowed = allowedOrigins()
  const origin = origins.find((candidate) => allowed.has(candidate))

  if (!origin) {
    throw mokelayError('BLOCK_OAUTH_INPUT_INVALID', 'OAuth redirect origin 不在允许列表中。', 400)
  }

  return origin
}

export function configuredOAuthAppOrigin() {
  return originFromUrl(process.env.OAUTH_APP_BASE_URL || '')
}

export function oauthFinalRedirectUrl(session: OAuthTempSession) {
  return session.redirectOrigin
    ? `${session.redirectOrigin}${session.redirect}`
    : session.redirect
}

export function oauthLoginRedirectUrl(errorCode: string, session?: OAuthTempSession) {
  const loginOrigin = configuredOAuthAppOrigin()

  if (loginOrigin && allowedOrigins().has(loginOrigin)) {
    const params = new URLSearchParams({ oauth_error: errorCode })
    if (session?.redirect) params.set('redirect', session.redirect)
    if (session?.redirectOrigin) params.set('redirect_origin', session.redirectOrigin)
    return `${loginOrigin}/login?${params.toString()}`
  }

  const redirect = `/login?oauth_error=${encodeURIComponent(errorCode)}`
  const redirectOrigin = session?.redirectOrigin

  if (redirectOrigin && allowedOrigins().has(redirectOrigin)) {
    return `${redirectOrigin}${redirect}`
  }

  return redirect
}

export function oauthClientId(provider: OAuthProvider) {
  const value = process.env[`OAUTH_${provider.toUpperCase()}_CLIENT_ID`]

  if (!value) {
    throw mokelayError('BLOCK_OAUTH_CONFIG_MISSING', `${provider} OAuth client id 未配置。`, 500)
  }

  return value
}

export function oauthClientSecret(provider: OAuthProvider) {
  const value = process.env[`OAUTH_${provider.toUpperCase()}_CLIENT_SECRET`]

  if (!value) {
    throw mokelayError('BLOCK_OAUTH_CONFIG_MISSING', `${provider} OAuth client secret 未配置。`, 500)
  }

  return value
}

function requestBaseUrl(event: H3Event) {
  const forwardedProto = getRequestHeader(event, 'x-forwarded-proto')?.split(',')[0]?.trim()
  const proto = forwardedProto || (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  const host = getRequestHeader(event, 'x-forwarded-host') || getRequestHeader(event, 'host')

  if (!host) {
    throw mokelayError('BLOCK_OAUTH_CONFIG_MISSING', '无法推导 OAuth callback base URL。', 500)
  }

  return `${proto}://${host}`
}

export function oauthCallbackUrl(event: H3Event, provider: OAuthProvider) {
  const baseUrl = (process.env.OAUTH_CALLBACK_BASE_URL || requestBaseUrl(event)).replace(/\/+$/, '')

  return `${baseUrl}/api/mokelay/oauth_${provider}_callback`
}

export function defaultOAuthScopes(provider: OAuthProvider) {
  return defaultScopes[provider]
}

function base64Url(bytes: Buffer) {
  return bytes.toString('base64url')
}

export function randomOAuthValue(byteLength = 32) {
  return base64Url(randomBytes(byteLength))
}

export function pkceChallenge(codeVerifier: string) {
  return createHash('sha256').update(codeVerifier).digest('base64url')
}

export function providerAuthorizeUrl(provider: OAuthProvider) {
  return providerAuthorizeUrls[provider]
}

export function storeOAuthTempSession(event: H3Event, session: OAuthTempSession) {
  setSessionValue(event, oauthSessionKey, session)
}

export function consumeOAuthTempSession(event: H3Event): OAuthTempSession {
  let value: unknown

  try {
    value = readSessionValue(event, oauthSessionKey)
  } catch (error) {
    throw mokelayError('BLOCK_OAUTH_STATE_INVALID', 'OAuth state 无效或已过期。', 400, error)
  }

  if (!isRecord(value)) {
    throw mokelayError('BLOCK_OAUTH_STATE_INVALID', 'OAuth state 无效或已过期。', 400)
  }

  const session: OAuthTempSession = {
    provider: normalizeOAuthProvider(value.provider),
    state: stringValue(value.state),
    codeVerifier: stringValue(value.codeVerifier),
    redirect: normalizeRelativeRedirect(value.redirect),
    redirectOrigin: stringValue(value.redirectOrigin) || undefined,
    createdAt: stringValue(value.createdAt),
  }

  if (!session.state || !session.codeVerifier) {
    throw mokelayError('BLOCK_OAUTH_STATE_INVALID', 'OAuth state 无效或已过期。', 400)
  }

  removeSessionValue(event, oauthSessionKey)

  return session
}

async function fetchJson(url: string, init: RequestInit, errorMessage: string) {
  let response: Response

  try {
    response = await fetch(url, init)
  } catch (error) {
    throw mokelayError('BLOCK_OAUTH_PROVIDER_FAILED', errorMessage, 502, error)
  }

  let body: unknown

  try {
    body = await response.json()
  } catch (error) {
    throw mokelayError('BLOCK_OAUTH_PROVIDER_FAILED', errorMessage, 502, error)
  }

  if (!response.ok) {
    throw mokelayError('BLOCK_OAUTH_PROVIDER_FAILED', errorMessage, 502)
  }

  return body
}

export async function exchangeOAuthCode(
  provider: OAuthProvider,
  code: string,
  codeVerifier: string,
  redirectUri: string,
) {
  const params = new URLSearchParams({
    client_id: oauthClientId(provider),
    client_secret: oauthClientSecret(provider),
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  })

  return await fetchJson(providerTokenUrls[provider], {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params,
  }, 'OAuth token 交换失败。')
}

function decodeJwtPayload(token: string) {
  const [, payload] = token.split('.')

  if (!payload) {
    throw mokelayError('BLOCK_OAUTH_PROVIDER_FAILED', 'Google 身份响应无效。', 502)
  }

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown
  } catch (error) {
    throw mokelayError('BLOCK_OAUTH_PROVIDER_FAILED', 'Google 身份响应无效。', 502, error)
  }
}

function assertGoogleTokenClaims(payload: Record<string, unknown>) {
  const issuer = stringValue(payload.iss)
  const audience = stringValue(payload.aud)
  const expiresAt = typeof payload.exp === 'number' ? payload.exp : Number(payload.exp)
  const now = Math.floor(Date.now() / 1000)

  if (!['https://accounts.google.com', 'accounts.google.com'].includes(issuer)) {
    throw mokelayError('BLOCK_OAUTH_PROVIDER_FAILED', 'Google 身份响应 issuer 无效。', 502)
  }

  if (audience !== oauthClientId('google')) {
    throw mokelayError('BLOCK_OAUTH_PROVIDER_FAILED', 'Google 身份响应 audience 无效。', 502)
  }

  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw mokelayError('BLOCK_OAUTH_PROVIDER_FAILED', 'Google 身份响应已过期。', 502)
  }
}

export function googleProfileFromTokenResponse(tokenResponse: unknown): OAuthProfile {
  if (!isRecord(tokenResponse) || typeof tokenResponse.id_token !== 'string') {
    throw mokelayError('BLOCK_OAUTH_PROVIDER_FAILED', 'Google 身份响应缺少 id_token。', 502)
  }

  const payload = decodeJwtPayload(tokenResponse.id_token)

  if (!isRecord(payload)) {
    throw mokelayError('BLOCK_OAUTH_PROVIDER_FAILED', 'Google 身份响应无效。', 502)
  }

  assertGoogleTokenClaims(payload)

  const providerUserId = stringValue(payload.sub)
  const email = stringValue(payload.email).toLowerCase()
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true'
  const name = stringValue(payload.name) || email.split('@')[0] || 'Google User'

  if (!providerUserId || !email) {
    throw mokelayError('BLOCK_OAUTH_PROVIDER_FAILED', 'Google 身份响应缺少用户标识或邮箱。', 502)
  }

  return {
    provider: 'google',
    providerUserId,
    email,
    emailVerified,
    name,
    raw: payload,
  }
}

export async function githubProfileFromTokenResponse(tokenResponse: unknown): Promise<OAuthProfile> {
  if (!isRecord(tokenResponse) || typeof tokenResponse.access_token !== 'string') {
    throw mokelayError('BLOCK_OAUTH_PROVIDER_FAILED', 'GitHub token 响应无效。', 502)
  }

  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${tokenResponse.access_token}`,
    'user-agent': 'mokelay-oauth',
  }
  const user = await fetchJson('https://api.github.com/user', { headers }, 'GitHub 用户信息读取失败。')
  const emails = await fetchJson('https://api.github.com/user/emails', { headers }, 'GitHub 邮箱读取失败。')

  if (!isRecord(user)) {
    throw mokelayError('BLOCK_OAUTH_PROVIDER_FAILED', 'GitHub 用户信息响应无效。', 502)
  }

  const primaryEmail = Array.isArray(emails)
    ? emails.find((item) => isRecord(item) && item.primary === true)
    : undefined

  if (!isRecord(primaryEmail)) {
    throw mokelayError('BLOCK_OAUTH_EMAIL_UNVERIFIED', 'GitHub 未返回 primary email。', 400)
  }

  const providerUserId = String(user.id ?? '')
  const email = stringValue(primaryEmail.email).toLowerCase()
  const emailVerified = primaryEmail.verified === true
  const name = stringValue(user.name) || stringValue(user.login) || email.split('@')[0] || 'GitHub User'

  if (!providerUserId || !email) {
    throw mokelayError('BLOCK_OAUTH_PROVIDER_FAILED', 'GitHub 身份响应缺少用户标识或邮箱。', 502)
  }

  return {
    provider: 'github',
    providerUserId,
    email,
    emailVerified,
    name,
    raw: { user, email: primaryEmail },
  }
}

function publicUser(row: EmployeeRow): PublicUser {
  return {
    id: row.id,
    enterprise_uuid: row.enterprise_uuid,
    enterprise_name: row.enterprise_name,
    name: row.name,
    email: row.email,
    plan: row.plan,
  }
}

async function findEmployeeByIdentity(executeSql: SqlExecutor, provider: OAuthProvider, providerUserId: string) {
  const result = await executeSql<IdentityEmployeeRow>(sql`
    SELECT
      employees.id,
      employees.enterprise_uuid,
      employees.name,
      employees.email,
      employees.plan,
      enterprise.name AS enterprise_name,
      employee_auth_identities.provider_user_id
    FROM employee_auth_identities
    INNER JOIN employees ON employees.id = employee_auth_identities.employee_id
    INNER JOIN enterprise ON enterprise.uuid = employees.enterprise_uuid
    WHERE employee_auth_identities.provider = ${provider}
      AND employee_auth_identities.provider_user_id = ${providerUserId}
    LIMIT 1
  `)

  return result.rows[0] ? publicUser(result.rows[0]) : null
}

async function findEmployeeByEmail(executeSql: SqlExecutor, email: string) {
  const result = await executeSql<EmployeeRow>(sql`
    SELECT
      employees.id,
      employees.enterprise_uuid,
      employees.name,
      employees.email,
      employees.plan,
      enterprise.name AS enterprise_name
    FROM employees
    INNER JOIN enterprise ON enterprise.uuid = employees.enterprise_uuid
    WHERE lower(employees.email) = ${email.toLowerCase()}
    LIMIT 1
  `)

  return result.rows[0] ? publicUser(result.rows[0]) : null
}

async function findEmployeeById(executeSql: SqlExecutor, employeeId: string) {
  const result = await executeSql<EmployeeRow>(sql`
    SELECT
      employees.id,
      employees.enterprise_uuid,
      employees.name,
      employees.email,
      employees.plan,
      enterprise.name AS enterprise_name
    FROM employees
    INNER JOIN enterprise ON enterprise.uuid = employees.enterprise_uuid
    WHERE employees.id = ${employeeId}
    LIMIT 1
  `)

  return result.rows[0] ? publicUser(result.rows[0]) : null
}

async function createIdentity(
  executeSql: SqlExecutor,
  employeeId: string,
  profile: OAuthProfile,
  databaseType: DatabaseType,
) {
  const profileJson = JSON.stringify(profile.raw)

  if (databaseType === 'mysql') {
    await executeSql(sql`
      INSERT IGNORE INTO employee_auth_identities (
        employee_id,
        provider,
        provider_user_id,
        provider_email,
        email_verified,
        profile
      )
      VALUES (
        ${employeeId},
        ${profile.provider},
        ${profile.providerUserId},
        ${profile.email},
        ${profile.emailVerified},
        ${profileJson}
      )
    `)
    return
  }

  await executeSql(sql`
    INSERT INTO employee_auth_identities (
      employee_id,
      provider,
      provider_user_id,
      provider_email,
      email_verified,
      profile
    )
    VALUES (
      ${employeeId},
      ${profile.provider},
      ${profile.providerUserId},
      ${profile.email},
      ${profile.emailVerified},
      ${profileJson}
    )
    ON CONFLICT (provider, provider_user_id) DO NOTHING
  `)
}

async function createEmployee(executeSql: SqlExecutor, profile: OAuthProfile, databaseType: DatabaseType) {
  const enterpriseName = `${profile.name || profile.email.split('@')[0]} 的工作区`
  let enterpriseUuid = ''

  if (databaseType === 'mysql') {
    const enterpriseInsert = await executeSql(sql`
      INSERT INTO enterprise (name)
      VALUES (${enterpriseName})
    `)
    const enterpriseResult = await executeSql<{ uuid: string }>(sql`
      SELECT uuid FROM enterprise
      WHERE id = ${enterpriseInsert.insertId}
      LIMIT 1
    `)

    enterpriseUuid = enterpriseResult.rows[0]?.uuid ?? ''
  } else {
    const enterpriseResult = await executeSql<{ uuid: string }>(sql`
      INSERT INTO enterprise (name)
      VALUES (${enterpriseName})
      RETURNING uuid
    `)

    enterpriseUuid = enterpriseResult.rows[0]?.uuid ?? ''
  }

  if (!enterpriseUuid) {
    throw mokelayError('BLOCK_OAUTH_ACCOUNT_CONFLICT', 'OAuth 企业创建失败。', 409)
  }

  const passwordHash = await hashPassword(randomUUID())
  let employee: EmployeeRow | undefined

  if (databaseType === 'mysql') {
    await executeSql(sql`
      INSERT INTO employees (enterprise_uuid, name, email, password_hash)
      VALUES (${enterpriseUuid}, ${profile.name}, ${profile.email}, ${passwordHash})
    `)
    const employeeResult = await executeSql<EmployeeRow>(sql`
      SELECT
        employees.id,
        employees.enterprise_uuid,
        employees.name,
        employees.email,
        employees.plan,
        enterprise.name AS enterprise_name
      FROM employees
      INNER JOIN enterprise ON enterprise.uuid = employees.enterprise_uuid
      WHERE employees.email = ${profile.email}
      LIMIT 1
    `)

    employee = employeeResult.rows[0]
  } else {
    const employeeResult = await executeSql<EmployeeRow>(sql`
      INSERT INTO employees (enterprise_uuid, name, email, password_hash)
      VALUES (${enterpriseUuid}, ${profile.name}, ${profile.email}, ${passwordHash})
      RETURNING id, enterprise_uuid, name, email, plan, ${enterpriseName} AS enterprise_name
    `)

    employee = employeeResult.rows[0]
  }

  if (!employee) {
    throw mokelayError('BLOCK_OAUTH_ACCOUNT_CONFLICT', 'OAuth 员工创建失败。', 409)
  }

  return publicUser(employee)
}

export async function resolveOAuthUser(
  executeSql: SqlExecutor,
  profile: OAuthProfile,
  autoCreateEnterprise: boolean,
  databaseTypeValue?: DatabaseType,
  deferNewUserProvisioning = false,
) {
  const databaseType = requireDatabaseType(databaseTypeValue)

  if (!profile.emailVerified) {
    throw mokelayError('BLOCK_OAUTH_EMAIL_UNVERIFIED', 'OAuth 邮箱未验证。', 400)
  }

  const existingIdentityUser = await findEmployeeByIdentity(executeSql, profile.provider, profile.providerUserId)

  if (existingIdentityUser) {
    return {
      user: existingIdentityUser,
      isNewUser: false,
      linkedIdentity: false,
      requiresRegistration: false,
      registration: null,
    }
  }

  const existingEmailUser = await findEmployeeByEmail(executeSql, profile.email)

  if (existingEmailUser) {
    await createIdentity(executeSql, existingEmailUser.id, profile, databaseType)
    return {
      user: existingEmailUser,
      isNewUser: false,
      linkedIdentity: true,
      requiresRegistration: false,
      registration: null,
    }
  }

  if (!autoCreateEnterprise) {
    throw mokelayError('BLOCK_OAUTH_ACCOUNT_CONFLICT', 'OAuth 账号不存在。', 409)
  }

  if (deferNewUserProvisioning) {
    const registration: OAuthRegistration = {
      enterpriseName: `${profile.name || profile.email.split('@')[0]} 的工作区`,
      name: profile.name,
      email: profile.email,
      passwordHash: await hashPassword(randomUUID()),
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      providerEmail: profile.email,
      emailVerified: profile.emailVerified,
      profile: profile.raw,
    }

    return {
      user: null,
      isNewUser: false,
      linkedIdentity: false,
      requiresRegistration: true,
      registration,
    }
  }

  const newUser = await createEmployee(executeSql, profile, databaseType)
  await createIdentity(executeSql, newUser.id, profile, databaseType)

  return {
    user: newUser,
    isNewUser: true,
    linkedIdentity: true,
    requiresRegistration: false,
    registration: null,
  }
}

export async function linkOAuthIdentity(
  executeSql: SqlExecutor,
  employeeId: string,
  profile: OAuthProfile,
  databaseTypeValue?: DatabaseType,
) {
  const databaseType = requireDatabaseType(databaseTypeValue)

  if (!employeeId) {
    throw mokelayError('BLOCK_OAUTH_INPUT_INVALID', 'employeeId 必须是非空字符串。', 400)
  }

  if (!profile.emailVerified) {
    throw mokelayError('BLOCK_OAUTH_EMAIL_UNVERIFIED', 'OAuth 邮箱未验证。', 400)
  }

  const existingIdentityUser = await findEmployeeByIdentity(
    executeSql,
    profile.provider,
    profile.providerUserId,
  )

  if (existingIdentityUser) {
    if (existingIdentityUser.id !== employeeId) {
      throw mokelayError('BLOCK_OAUTH_ACCOUNT_CONFLICT', 'OAuth 身份已绑定其他账号。', 409)
    }

    return { user: existingIdentityUser, linkedIdentity: false }
  }

  const employee = await findEmployeeById(executeSql, employeeId)

  if (!employee || employee.email.toLowerCase() !== profile.email.toLowerCase()) {
    throw mokelayError('BLOCK_OAUTH_ACCOUNT_CONFLICT', 'OAuth 身份与员工账号不匹配。', 409)
  }

  await createIdentity(executeSql, employeeId, profile, databaseType)

  const linkedUser = await findEmployeeByIdentity(executeSql, profile.provider, profile.providerUserId)

  if (!linkedUser || linkedUser.id !== employeeId) {
    throw mokelayError('BLOCK_OAUTH_ACCOUNT_CONFLICT', 'OAuth 身份绑定失败或已绑定其他账号。', 409)
  }

  return { user: linkedUser, linkedIdentity: true }
}
