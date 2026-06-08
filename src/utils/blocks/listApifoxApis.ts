import { mokelayError } from '../mokelay-error.js'
import { type BlockExecutor } from '../orchestration-schema.js'
import {
  apifoxApiVersion,
  buildApifoxUrl,
  normalizeApifoxBaseUrl,
  normalizeApifoxLocale,
  readApifoxAccessToken,
} from './apifoxShared.js'
import { isRecord } from './shared.js'

const httpMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const
const parameterLocations = ['path', 'query', 'header', 'cookie'] as const

type ParameterLocation = typeof parameterLocations[number]

type ApiParameterGroups = Record<ParameterLocation, string[]>

type ApifoxApi = {
  path: string
  method: string
  summary: string | null
  description: string | null
  tags: string[]
  deprecated: boolean
  operationId: string | null
  parameters: ApiParameterGroups
  requestBodyContentTypes: string[]
  responseStatusCodes: string[]
}

function normalizeProjectId(value: unknown) {
  if (typeof value === 'string') {
    const projectId = value.trim()

    if (projectId) {
      return projectId
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  throw mokelayError('BLOCK_APIFOX_INPUT_INVALID', 'projectId 必须是非空字符串或数字。', 400)
}

function normalizeOptionalPositiveInteger(value: unknown, name: string) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw mokelayError('BLOCK_APIFOX_INPUT_INVALID', `${name} 必须是正整数。`, 400)
  }

  return value
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' ? value : null
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string')
}

function responseStatusCodes(value: unknown) {
  return isRecord(value) ? Object.keys(value) : []
}

function contentTypesFromContent(value: unknown) {
  return isRecord(value) ? Object.keys(value) : []
}

function requestBodyContentTypes(value: unknown) {
  if (!isRecord(value) || !isRecord(value.content)) {
    return []
  }

  return contentTypesFromContent(value.content)
}

function emptyParameterGroups(): ApiParameterGroups {
  return {
    path: [],
    query: [],
    header: [],
    cookie: [],
  }
}

function appendParameters(groups: ApiParameterGroups, value: unknown) {
  if (!Array.isArray(value)) {
    return
  }

  for (const parameter of value) {
    if (!isRecord(parameter) || typeof parameter.name !== 'string') {
      continue
    }

    if (!parameterLocations.includes(parameter.in as ParameterLocation)) {
      continue
    }

    const location = parameter.in as ParameterLocation

    if (!groups[location].includes(parameter.name)) {
      groups[location].push(parameter.name)
    }
  }
}

function extractApis(openapi: Record<string, unknown>) {
  if (!isRecord(openapi.paths)) {
    throw mokelayError('BLOCK_APIFOX_RESPONSE_INVALID', 'APIFox 返回的 OpenAPI 缺少 paths 对象。', 502)
  }

  const apis: ApifoxApi[] = []

  for (const [path, pathItem] of Object.entries(openapi.paths)) {
    if (!isRecord(pathItem)) {
      continue
    }

    for (const method of httpMethods) {
      const operation = pathItem[method]

      if (!isRecord(operation)) {
        continue
      }

      const parameters = emptyParameterGroups()
      appendParameters(parameters, pathItem.parameters)
      appendParameters(parameters, operation.parameters)

      apis.push({
        path,
        method: method.toUpperCase(),
        summary: stringOrNull(operation.summary),
        description: stringOrNull(operation.description),
        tags: stringArray(operation.tags),
        deprecated: operation.deprecated === true,
        operationId: stringOrNull(operation.operationId),
        parameters,
        requestBodyContentTypes: requestBodyContentTypes(operation.requestBody),
        responseStatusCodes: responseStatusCodes(operation.responses),
      })
    }
  }

  return apis
}

function buildExportBody(inputs: Record<string, unknown>) {
  const body: Record<string, unknown> = {
    scope: { type: 'ALL' },
    options: {
      includeApifoxExtensionProperties: false,
      addFoldersToTags: false,
    },
    oasVersion: '3.1',
    exportFormat: 'JSON',
  }
  const branchId = normalizeOptionalPositiveInteger(inputs.branchId, 'branchId')
  const moduleId = normalizeOptionalPositiveInteger(inputs.moduleId, 'moduleId')

  if (branchId !== undefined) {
    body.branchId = branchId
  }

  if (moduleId !== undefined) {
    body.moduleId = moduleId
  }

  return body
}

function buildExportUrl(baseUrl: string, projectId: string, locale: string) {
  return buildApifoxUrl(baseUrl, `v1/projects/${encodeURIComponent(projectId)}/export-openapi`, { locale })
}

async function parseOpenapiResponse(response: Response) {
  try {
    const data = await response.json() as unknown

    if (!isRecord(data)) {
      throw new Error('APIFox response JSON is not an object.')
    }

    return data
  } catch (error) {
    throw mokelayError('BLOCK_APIFOX_RESPONSE_INVALID', 'APIFox 返回的 OpenAPI 不是合法 JSON 对象。', 502, error)
  }
}

/**
 * listApifoxApis block
 * 作用：调用 APIFox 开放 API 导出 OpenAPI，并从 paths 中提取接口列表。
 * inputs：projectId 必填；baseUrl、locale、branchId、moduleId、includeRawOpenapi 可选。
 * outputs：apis、count、openapi。
 */
export const executeListApifoxApisBlock: BlockExecutor = async ({ inputs }) => {
  const projectId = normalizeProjectId(inputs.projectId)
  const baseUrl = normalizeApifoxBaseUrl(inputs.baseUrl)
  const locale = normalizeApifoxLocale(inputs.locale)
  const accessToken = readApifoxAccessToken()
  const url = buildExportUrl(baseUrl, projectId, locale)

  let response: Response

  try {
    response = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Apifox-Api-Version': apifoxApiVersion,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildExportBody(inputs)),
    })
  } catch (error) {
    throw mokelayError('BLOCK_APIFOX_REQUEST_FAILED', '请求 APIFox 接口失败。', 502, error)
  }

  if (!response.ok) {
    const statusText = response.statusText ? ` ${response.statusText}` : ''

    throw mokelayError('BLOCK_APIFOX_REQUEST_FAILED', `APIFox 请求失败：${response.status}${statusText}。`, 502)
  }

  const openapi = await parseOpenapiResponse(response)
  const apis = extractApis(openapi)

  return {
    apis,
    count: apis.length,
    openapi: inputs.includeRawOpenapi === true ? openapi : null,
  }
}
