import OpenAI from 'openai'
import { z } from 'zod'

export const maxImageBytes = 10 * 1024 * 1024
export const maxTextBytes = 100 * 1024
export const supportedImageMimeTypes = ['image/jpeg', 'image/png', 'image/webp'] as const

type SupportedImageMimeType = typeof supportedImageMimeTypes[number]
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
type DataType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'unknown'
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type JsonDataSourceAnalysis = {
  type: 'JSON'
  rawData: JsonValue
}

export type ApiDataSourceAnalysis = {
  type: 'API'
  domain: string
  path: string
  method: HttpMethod
  headerData: KeyMockData[]
  bodyData: BodyMockData[]
  queryData: KeyMockData[]
}

export type DataSourceAnalysisResult = JsonDataSourceAnalysis | ApiDataSourceAnalysis

type KeyMockData = {
  key: string
  mock: unknown
}

type BodyMockData = KeyMockData & {
  dataType: DataType
}

type AnalyzeImageInput = {
  data: Buffer
  mimeType: SupportedImageMimeType
}

type AnalyzeDataSourceInput = {
  text: string
  image?: AnalyzeImageInput
}

const httpMethods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const dataTypes: DataType[] = ['string', 'number', 'boolean', 'object', 'array', 'null', 'unknown']

const keyMockSchema = z.object({
  key: z.string(),
  mock: z.unknown().optional(),
})

const bodyMockSchema = keyMockSchema.extend({
  dataType: z.string().optional(),
})

const modelOutputSchema = z.object({
  type: z.enum(['JSON', 'API', 'UNKNOWN']),
  rawDataText: z.string().optional().default(''),
  domain: z.string().optional().default(''),
  path: z.string().optional().default(''),
  method: z.string().optional().default('GET'),
  headerData: z.array(keyMockSchema).optional().default([]),
  bodyData: z.array(bodyMockSchema).optional().default([]),
  queryData: z.array(keyMockSchema).optional().default([]),
})

const responseFormatSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'rawDataText', 'domain', 'path', 'method', 'headerData', 'bodyData', 'queryData'],
  properties: {
    type: { type: 'string', enum: ['JSON', 'API', 'UNKNOWN'] },
    rawDataText: { type: 'string' },
    domain: { type: 'string' },
    path: { type: 'string' },
    method: { type: 'string' },
    headerData: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'mock'],
        properties: {
          key: { type: 'string' },
          mock: { type: ['string', 'number', 'boolean', 'null'] },
        },
      },
    },
    bodyData: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'dataType', 'mock'],
        properties: {
          key: { type: 'string' },
          dataType: {
            type: 'string',
            enum: ['string', 'number', 'boolean', 'object', 'array', 'null', 'unknown'],
          },
          mock: { type: ['string', 'number', 'boolean', 'null'] },
        },
      },
    },
    queryData: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'mock'],
        properties: {
          key: { type: 'string' },
          mock: { type: ['string', 'number', 'boolean', 'null'] },
        },
      },
    },
  },
}

const dataSourceAnalysisPrompt = `
你是 Mokelay 的数据源识别器。请只判断用户提供的文本或图片是否展示了 JSON 数据或 HTTP API 信息。

规则：
1. 如果输入主要展示 JSON 数据，type 返回 JSON，rawDataText 返回输入中可解析的完整 JSON 字符串。
2. 如果输入主要展示 HTTP API 信息，type 返回 API，并提取 domain、path、method、headerData、bodyData、queryData。
3. headerData/queryData 只需要 key 和 mock；bodyData 需要 key、dataType、mock。
4. 如果字段没有 mock 值，返回空字符串；如果参数缺失，返回空数组。
5. 如果输入既不是 JSON 数据也不是 HTTP API 信息，或内容不足以可靠识别，type 返回 UNKNOWN。
6. 不要输出解释文字，只输出符合 schema 的 JSON。
`.trim()

export class AiDataSourceError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = new.target.name
    this.cause = cause
  }
}

export class AiDataSourceConfigError extends AiDataSourceError {}
export class AiDataSourceProviderError extends AiDataSourceError {}
export class AiDataSourceModelOutputError extends AiDataSourceError {}
export class AiDataSourceUnrecognizedError extends AiDataSourceError {}

export async function analyzeDataSourceImage(input: AnalyzeImageInput): Promise<DataSourceAnalysisResult> {
  return await analyzeDataSourceInput({
    text: '请分析这张图片中的数据源内容。',
    image: input,
  })
}

export async function analyzeDataSourceText(text: string): Promise<DataSourceAnalysisResult> {
  const localJson = parseJsonText(text)

  if (localJson.ok) {
    return {
      type: 'JSON',
      rawData: localJson.value,
    }
  }

  return await analyzeDataSourceInput({ text })
}

async function analyzeDataSourceInput(input: AnalyzeDataSourceInput): Promise<DataSourceAnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()

  if (!apiKey) {
    throw new AiDataSourceConfigError('缺少 OPENAI_API_KEY 配置。')
  }

  const client = new OpenAI({ apiKey })
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini'

  try {
    const content = [
      { type: 'input_text' as const, text: `${dataSourceAnalysisPrompt}\n\n用户输入：\n${input.text}` },
      ...(input.image
        ? [{
            type: 'input_image' as const,
            image_url: imageBufferToDataUrl(input.image.data, input.image.mimeType),
            detail: 'high' as const,
          }]
        : []),
    ]

    const response = await client.responses.create({
      model,
      input: [
        {
          role: 'user',
          content,
        },
      ],
      max_output_tokens: 1600,
      store: false,
      temperature: 0,
      text: {
        format: {
          type: 'json_schema',
          name: 'data_source_analysis',
          strict: true,
          schema: responseFormatSchema,
        },
      },
    })

    return normalizeAiDataSourceOutput(parseModelOutputText(response.output_text))
  } catch (error) {
    if (error instanceof AiDataSourceError) {
      throw error
    }

    throw new AiDataSourceProviderError('AI 数据源分析服务调用失败。', error)
  }
}

export function parseTextDataSourceJson(text: string): DataSourceAnalysisResult | null {
  const parsed = parseJsonText(text)

  if (!parsed.ok) {
    return null
  }

  return {
    type: 'JSON',
    rawData: parsed.value,
  }
}

export function isSupportedImageMimeType(mimeType: string): mimeType is SupportedImageMimeType {
  return supportedImageMimeTypes.includes(mimeType as SupportedImageMimeType)
}

export function imageBufferToDataUrl(data: Buffer, mimeType: SupportedImageMimeType) {
  return `data:${mimeType};base64,${data.toString('base64')}`
}

export function normalizeAiDataSourceOutput(output: unknown): DataSourceAnalysisResult {
  const parsed = modelOutputSchema.safeParse(output)

  if (!parsed.success) {
    throw new AiDataSourceModelOutputError('AI 返回的数据源结构无效。')
  }

  if (parsed.data.type === 'UNKNOWN') {
    throw new AiDataSourceUnrecognizedError('无法从输入中识别出 JSON 数据或 API 信息。')
  }

  if (parsed.data.type === 'JSON') {
    return {
      type: 'JSON',
      rawData: parseRawJson(parsed.data.rawDataText),
    }
  }

  const { domain, path } = normalizeEndpoint(parsed.data.domain, parsed.data.path)

  return {
    type: 'API',
    domain,
    path,
    method: normalizeMethod(parsed.data.method),
    headerData: normalizeKeyMockData(parsed.data.headerData),
    bodyData: normalizeBodyData(parsed.data.bodyData),
    queryData: normalizeKeyMockData(parsed.data.queryData),
  }
}

function parseModelOutputText(outputText: string) {
  try {
    return JSON.parse(outputText)
  } catch (error) {
    throw new AiDataSourceModelOutputError('AI 返回的内容不是有效 JSON。', error)
  }
}

function parseRawJson(rawDataText: string): JsonValue {
  try {
    return JSON.parse(rawDataText) as JsonValue
  } catch (error) {
    throw new AiDataSourceModelOutputError('AI 识别出的 JSON 数据无法解析。', error)
  }
}

function parseJsonText(text: string): { ok: true, value: JsonValue } | { ok: false } {
  try {
    return {
      ok: true,
      value: JSON.parse(text.trim()) as JsonValue,
    }
  } catch {
    return { ok: false }
  }
}

function normalizeEndpoint(rawDomain: string, rawPath: string) {
  let domain = rawDomain.trim()
  let path = rawPath.trim()

  const pathUrl = parseAbsoluteUrl(path)

  if (pathUrl) {
    domain = pathUrl.origin
    path = pathUrl.pathname || '/'
  } else {
    const domainUrl = parseAbsoluteUrl(domain)

    if (domainUrl) {
      domain = domainUrl.origin

      if (!path || path === '/') {
        path = domainUrl.pathname || '/'
      }
    }
  }

  if (domain && !/^https?:\/\//i.test(domain)) {
    domain = `https://${domain.replace(/^\/+/, '')}`
  }

  domain = domain.replace(/\/+$/, '')
  path = path.split('?')[0] || '/'

  if (!path.startsWith('/')) {
    path = `/${path}`
  }

  return { domain, path }
}

function parseAbsoluteUrl(value: string) {
  if (!/^https?:\/\//i.test(value)) {
    return null
  }

  try {
    return new URL(value)
  } catch {
    return null
  }
}

function normalizeMethod(method: string): HttpMethod {
  const normalized = method.trim().toUpperCase()

  if (httpMethods.includes(normalized as HttpMethod)) {
    return normalized as HttpMethod
  }

  return 'GET'
}

function normalizeKeyMockData(items: Array<z.infer<typeof keyMockSchema>>): KeyMockData[] {
  return items
    .map((item) => ({
      key: item.key.trim(),
      mock: normalizeMockValue(item.mock, 'string'),
    }))
    .filter((item) => item.key)
}

function normalizeBodyData(items: Array<z.infer<typeof bodyMockSchema>>): BodyMockData[] {
  return items
    .map((item) => {
      const dataType = normalizeDataType(item.dataType || 'string')

      return {
        key: item.key.trim(),
        dataType,
        mock: normalizeMockValue(item.mock, dataType),
      }
    })
    .filter((item) => item.key)
}

function normalizeDataType(dataType: string): DataType {
  const normalized = dataType.trim().toLowerCase()

  if (dataTypes.includes(normalized as DataType)) {
    return normalized as DataType
  }

  if (normalized === 'integer' || normalized === 'float' || normalized === 'double') {
    return 'number'
  }

  if (normalized === 'bool') {
    return 'boolean'
  }

  return 'string'
}

function normalizeMockValue(mock: unknown, dataType: DataType) {
  if (mock === undefined || mock === null || mock === '') {
    return defaultMockValue(dataType)
  }

  if (dataType === 'number') {
    return typeof mock === 'number' ? mock : defaultMockValue(dataType)
  }

  if (dataType === 'boolean') {
    return typeof mock === 'boolean' ? mock : defaultMockValue(dataType)
  }

  if (dataType === 'object') {
    return isPlainRecord(mock) ? mock : defaultMockValue(dataType)
  }

  if (dataType === 'array') {
    return Array.isArray(mock) ? mock : defaultMockValue(dataType)
  }

  if (dataType === 'null') {
    return null
  }

  return mock
}

function defaultMockValue(dataType: DataType) {
  switch (dataType) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'object':
      return {}
    case 'array':
      return []
    case 'null':
      return null
    default:
      return ''
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
