import {
  getRequestHeader,
  getMethod,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from 'h3'

const defaultOrigins = [
  'https://www.mokelay.com',
  'https://mokelay.com',
  'https://editor.mokelay.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]

export function allowedOrigins() {
  const configuredOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  return new Set([...defaultOrigins, ...configuredOrigins])
}

export function applyCors(event: H3Event) {
  const origin = getRequestHeader(event, 'origin')

  if (origin && allowedOrigins().has(origin)) {
    setResponseHeader(event, 'Access-Control-Allow-Origin', origin)
    setResponseHeader(event, 'Access-Control-Allow-Credentials', 'true')
    setResponseHeader(event, 'Vary', 'Origin')
  }

  setResponseHeader(event, 'Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS')
  setResponseHeader(
    event,
    'Access-Control-Allow-Headers',
    getRequestHeader(event, 'access-control-request-headers') || 'content-type,authorization',
  )

  if (getMethod(event) === 'OPTIONS') {
    setResponseStatus(event, 204)
    return ''
  }
}
