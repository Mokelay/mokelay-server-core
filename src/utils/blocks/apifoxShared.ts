import { mokelayError } from '../mokelay-error.js'

export const defaultApifoxBaseUrl = 'https://api.apifox.com'
export const apifoxApiVersion = '2024-03-28'
export const defaultApifoxLocale = 'zh-CN'

export function normalizeApifoxLocale(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return defaultApifoxLocale
  }

  if (typeof value !== 'string') {
    throw mokelayError('BLOCK_APIFOX_INPUT_INVALID', 'locale 必须是字符串。', 400)
  }

  const locale = value.trim()

  return locale || defaultApifoxLocale
}

export function normalizeApifoxBaseUrl(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return defaultApifoxBaseUrl
  }

  if (typeof value !== 'string') {
    throw mokelayError('BLOCK_APIFOX_INPUT_INVALID', 'baseUrl 必须是字符串。', 400)
  }

  const baseUrl = value.trim()

  if (!baseUrl) {
    return defaultApifoxBaseUrl
  }

  try {
    const url = new URL(baseUrl)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Unsupported protocol: ${url.protocol}`)
    }

    return url.toString()
  } catch (error) {
    throw mokelayError('BLOCK_APIFOX_INPUT_INVALID', 'baseUrl 必须是合法的 HTTP(S) URL。', 400, error)
  }
}

export function readApifoxAccessToken() {
  const accessToken = process.env.APIFOX_ACCESS_TOKEN?.trim()

  if (!accessToken) {
    throw mokelayError('BLOCK_APIFOX_CONFIG_MISSING', 'APIFOX_ACCESS_TOKEN 未配置。', 500)
  }

  return accessToken
}

export function buildApifoxUrl(baseUrl: string, path: string, searchParams?: Record<string, string>) {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const normalizedPath = path.replace(/^\/+/, '')
  const url = new URL(normalizedPath, normalizedBaseUrl)

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value)
  }

  return url
}
