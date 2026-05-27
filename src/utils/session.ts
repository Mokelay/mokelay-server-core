import { deleteCookie, getCookie, setCookie, type H3Event } from 'h3'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { mokelayError } from './mokelay-error.js'

export const orchestrationSessionCookieName = 'mokelay_orchestration_session'

const sessionMaxAgeSeconds = 60 * 60 * 24 * 7
const orchestrationSessionContextKey = '__mokelayOrchestrationSession'

type StoredOrchestrationSession = {
  values: Record<string, unknown>
  iat: number
  exp: number
}

type OrchestrationSessionEventContext = H3Event['context'] & {
  [orchestrationSessionContextKey]?: StoredOrchestrationSession
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET

  if (secret) {
    return secret
  }

  if (process.env.NODE_ENV === 'production') {
    throw mokelayError('SESSION_SECRET_NOT_CONFIGURED', 'SESSION_SECRET is not configured.', 500)
  }

  return 'mokelay-local-session-secret-at-least-32-characters'
}

function encodeBase64Url(value: string) {
  return Buffer.from(value).toString('base64url')
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function sign(value: string) {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url')
}

function seal(payload: unknown) {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload))
  return `${encodedPayload}.${sign(encodedPayload)}`
}

function unseal(value: string): unknown | null {
  const [encodedPayload, signature] = value.split('.')

  if (!encodedPayload || !signature) {
    return null
  }

  const expectedSignature = sign(encodedPayload)
  const signatureBuffer = Buffer.from(signature)
  const expectedSignatureBuffer = Buffer.from(expectedSignature)

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length
    || !timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    return null
  }

  try {
    return JSON.parse(decodeBase64Url(encodedPayload)) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isExpired(value: unknown) {
  return typeof value !== 'number' || value <= Math.floor(Date.now() / 1000)
}

function unsealOrchestrationSession(value: string): StoredOrchestrationSession | null {
  const payload = unseal(value)

  if (!isRecord(payload) || !isRecord(payload.values) || isExpired(payload.exp)) {
    return null
  }

  return payload as StoredOrchestrationSession
}

function cookieDomain() {
  return process.env.COOKIE_DOMAIN || undefined
}

function isProduction() {
  return process.env.NODE_ENV === 'production'
}

function setSignedCookie(event: H3Event, name: string, payload: unknown) {
  setCookie(event, name, seal(payload), {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: sessionMaxAgeSeconds,
    domain: cookieDomain(),
  })
}

function deleteSignedCookie(event: H3Event, name: string) {
  deleteCookie(event, name, {
    path: '/',
    domain: cookieDomain(),
  })
}

function createOrchestrationSession(values: Record<string, unknown> = {}): StoredOrchestrationSession {
  const now = Math.floor(Date.now() / 1000)

  return {
    values,
    iat: now,
    exp: now + sessionMaxAgeSeconds,
  }
}

function orchestrationSessionContext(event: H3Event) {
  return event.context as OrchestrationSessionEventContext
}

function getOrchestrationSession(event: H3Event) {
  const context = orchestrationSessionContext(event)

  if (context[orchestrationSessionContextKey]) {
    return context[orchestrationSessionContextKey]
  }

  const cookie = getCookie(event, orchestrationSessionCookieName)
  const session = cookie ? unsealOrchestrationSession(cookie) : null

  context[orchestrationSessionContextKey] = session ?? createOrchestrationSession()

  return context[orchestrationSessionContextKey]
}

function persistOrchestrationSession(event: H3Event, values: Record<string, unknown>) {
  const session = createOrchestrationSession(values)

  orchestrationSessionContext(event)[orchestrationSessionContextKey] = session

  if (Object.keys(values).length === 0) {
    deleteSignedCookie(event, orchestrationSessionCookieName)
    return
  }

  setSignedCookie(event, orchestrationSessionCookieName, session)
}

export function setSessionValue(event: H3Event, key: string, value: unknown) {
  const session = getOrchestrationSession(event)

  persistOrchestrationSession(event, {
    ...session.values,
    [key]: value,
  })
}

export function removeSessionValue(event: H3Event, key: string) {
  const session = getOrchestrationSession(event)
  const nextValues = { ...session.values }

  delete nextValues[key]
  persistOrchestrationSession(event, nextValues)
}

export function readSessionValue(event: H3Event, key: string) {
  const session = getOrchestrationSession(event)

  if (!Object.prototype.hasOwnProperty.call(session.values, key)) {
    throw mokelayError('BLOCK_SESSION_KEY_NOT_FOUND', `Session key 不存在：${key}`, 404)
  }

  return session.values[key]
}
