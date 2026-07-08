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

type ApiParameterDetail = {
  name: string
  in: ParameterLocation
  description: string | null
  required: boolean
  deprecated: boolean
  example: unknown | null
  examples: unknown | null
}

type ApiParameterDetailGroups = Record<ParameterLocation, ApiParameterDetail[]>

type ApiRequestBodyParameter = {
  contentType: string
  name: string
  path: string
  description: string | null
  required: boolean
  deprecated: boolean
  example: unknown | null
  examples: unknown | null
}

type ApiResponseContentDetail = {
  contentType: string
  schemaDescription: string | null
  example: unknown | null
  examples: unknown | null
}

type ApiResponseDetail = {
  statusCode: string
  description: string | null
  contentTypes: string[]
  contents: ApiResponseContentDetail[]
}

type ApiResponseBodyParameter = ApiRequestBodyParameter & {
  statusCode: string
}

type ApifoxApi = {
  path: string
  method: string
  summary: string | null
  description: string | null
  tags: string[]
  deprecated: boolean
  operationId: string | null
  parameters: ApiParameterGroups
  parameterDetails: ApiParameterDetailGroups
  requestBodyContentTypes: string[]
  requestBodyParameters: ApiRequestBodyParameter[]
  responseStatusCodes: string[]
  responseDetails: ApiResponseDetail[]
  responseBodyParameters: ApiResponseBodyParameter[]
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

function normalizeOptionalPositiveIntegerId(value: unknown, name: string) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 1) {
      return value
    }

    throw mokelayError('BLOCK_APIFOX_INPUT_INVALID', `${name} 必须是正整数。`, 400)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()

    if (/^[1-9]\d*$/.test(trimmed)) {
      const parsed = Number(trimmed)

      if (Number.isSafeInteger(parsed)) {
        return parsed
      }
    }
  }

  throw mokelayError('BLOCK_APIFOX_INPUT_INVALID', `${name} 必须是正整数。`, 400)
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

function ownValueOrNull(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : null
}

function exampleFromRecord(record: Record<string, unknown>) {
  const directExample = ownValueOrNull(record, 'example')

  if (directExample !== null) {
    return directExample
  }

  if (isRecord(record.schema)) {
    return ownValueOrNull(record.schema, 'example')
  }

  return null
}

function examplesFromRecord(record: Record<string, unknown>) {
  const directExamples = ownValueOrNull(record, 'examples')

  if (directExamples !== null) {
    return directExamples
  }

  if (isRecord(record.schema)) {
    return ownValueOrNull(record.schema, 'examples')
  }

  return null
}

function decodeJsonPointerSegment(value: string) {
  return value.replace(/~1/g, '/').replace(/~0/g, '~')
}

function resolveLocalRef(root: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith('#/')) {
    return null
  }

  let current: unknown = root

  for (const segment of ref.slice(2).split('/').map(decodeJsonPointerSegment)) {
    if (!isRecord(current)) {
      return null
    }

    current = current[segment]
  }

  return current
}

function resolveSchemaRecord(
  schema: unknown,
  root: Record<string, unknown>,
  seenRefs = new Set<string>(),
): Record<string, unknown> | null {
  if (!isRecord(schema)) {
    return null
  }

  if (typeof schema.$ref !== 'string') {
    return schema
  }

  if (seenRefs.has(schema.$ref)) {
    return schema
  }

  const resolved = resolveLocalRef(root, schema.$ref)

  if (!isRecord(resolved)) {
    return schema
  }

  seenRefs.add(schema.$ref)

  const resolvedSchema = resolveSchemaRecord(resolved, root, seenRefs) ?? resolved

  seenRefs.delete(schema.$ref)

  return {
    ...resolvedSchema,
    ...schema,
  }
}

function emptyParameterGroups(): ApiParameterGroups {
  return {
    path: [],
    query: [],
    header: [],
    cookie: [],
  }
}

function emptyParameterDetailGroups(): ApiParameterDetailGroups {
  return {
    path: [],
    query: [],
    header: [],
    cookie: [],
  }
}

function appendParameters(groups: ApiParameterGroups, details: ApiParameterDetailGroups, value: unknown) {
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

    const detail: ApiParameterDetail = {
      name: parameter.name,
      in: location,
      description: stringOrNull(parameter.description),
      required: parameter.required === true,
      deprecated: parameter.deprecated === true,
      example: exampleFromRecord(parameter),
      examples: examplesFromRecord(parameter),
    }
    const existingIndex = details[location].findIndex((item) => item.name === parameter.name)

    if (existingIndex >= 0) {
      details[location][existingIndex] = detail
    } else {
      details[location].push(detail)
    }
  }
}

function appendSchemaParameter<T extends ApiRequestBodyParameter>(
  parameters: T[],
  parameter: T,
) {
  const existingIndex = parameters.findIndex((item) => (
    item.contentType === parameter.contentType && item.path === parameter.path
    && (
      !('statusCode' in item) && !('statusCode' in parameter)
      || (item as Record<string, unknown>).statusCode === (parameter as Record<string, unknown>).statusCode
    )
  ))

  if (existingIndex >= 0) {
    parameters[existingIndex] = parameter
  } else {
    parameters.push(parameter)
  }
}

function schemaRequiredNames(schema: Record<string, unknown>) {
  return stringArray(schema.required)
}

function appendSchemaParameters<T extends ApiRequestBodyParameter>(
  parameters: T[],
  contentType: string,
  schema: unknown,
  root: Record<string, unknown>,
  buildParameter: (parameter: ApiRequestBodyParameter) => T,
  parentPath = '',
  depth = 0,
) {
  const resolvedSchema = resolveSchemaRecord(schema, root)

  if (!resolvedSchema || depth > 5) {
    return
  }

  for (const compositionKey of ['allOf', 'oneOf', 'anyOf'] as const) {
    const compositionSchemas = resolvedSchema[compositionKey]

    if (Array.isArray(compositionSchemas)) {
      for (const compositionSchema of compositionSchemas) {
        appendSchemaParameters(
          parameters,
          contentType,
          compositionSchema,
          root,
          buildParameter,
          parentPath,
          depth + 1,
        )
      }
    }
  }

  if (isRecord(resolvedSchema.items)) {
    appendSchemaParameters(
      parameters,
      contentType,
      resolvedSchema.items,
      root,
      buildParameter,
      parentPath ? `${parentPath}[]` : '[]',
      depth + 1,
    )
  }

  if (!isRecord(resolvedSchema.properties)) {
    return
  }

  const requiredNames = schemaRequiredNames(resolvedSchema)

  for (const [name, propertySchema] of Object.entries(resolvedSchema.properties)) {
    const resolvedPropertySchema = resolveSchemaRecord(propertySchema, root)

    if (!resolvedPropertySchema) {
      continue
    }

    const path = parentPath ? `${parentPath}.${name}` : name

    appendSchemaParameter(parameters, buildParameter({
      contentType,
      name,
      path,
      description: stringOrNull(resolvedPropertySchema.description),
      required: requiredNames.includes(name),
      deprecated: resolvedPropertySchema.deprecated === true,
      example: exampleFromRecord(resolvedPropertySchema),
      examples: examplesFromRecord(resolvedPropertySchema),
    }))
    appendSchemaParameters(
      parameters,
      contentType,
      resolvedPropertySchema,
      root,
      buildParameter,
      path,
      depth + 1,
    )
  }
}

function requestBodyParameters(value: unknown, root: Record<string, unknown>) {
  if (!isRecord(value) || !isRecord(value.content)) {
    return []
  }

  const parameters: ApiRequestBodyParameter[] = []

  for (const [contentType, content] of Object.entries(value.content)) {
    if (!isRecord(content)) {
      continue
    }

    appendSchemaParameters(
      parameters,
      contentType,
      content.schema,
      root,
      (parameter) => parameter,
    )
  }

  return parameters
}

function responseDetails(value: unknown) {
  if (!isRecord(value)) {
    return []
  }

  const details: ApiResponseDetail[] = []

  for (const [statusCode, response] of Object.entries(value)) {
    if (!isRecord(response)) {
      continue
    }

    const contents: ApiResponseContentDetail[] = []

    if (isRecord(response.content)) {
      for (const [contentType, content] of Object.entries(response.content)) {
        if (!isRecord(content)) {
          continue
        }

        const schema = isRecord(content.schema) ? content.schema : null

        contents.push({
          contentType,
          schemaDescription: schema ? stringOrNull(schema.description) : null,
          example: exampleFromRecord(content),
          examples: examplesFromRecord(content),
        })
      }
    }

    details.push({
      statusCode,
      description: stringOrNull(response.description),
      contentTypes: contentTypesFromContent(response.content),
      contents,
    })
  }

  return details
}

function responseBodyParameters(value: unknown, root: Record<string, unknown>) {
  if (!isRecord(value)) {
    return []
  }

  const parameters: ApiResponseBodyParameter[] = []

  for (const [statusCode, response] of Object.entries(value)) {
    if (!isRecord(response) || !isRecord(response.content)) {
      continue
    }

    for (const [contentType, content] of Object.entries(response.content)) {
      if (!isRecord(content)) {
        continue
      }

      appendSchemaParameters(
        parameters,
        contentType,
        content.schema,
        root,
        (parameter) => ({
          ...parameter,
          statusCode,
        }),
      )
    }
  }

  return parameters
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
      const parameterDetails = emptyParameterDetailGroups()
      appendParameters(parameters, parameterDetails, pathItem.parameters)
      appendParameters(parameters, parameterDetails, operation.parameters)

      apis.push({
        path,
        method: method.toUpperCase(),
        summary: stringOrNull(operation.summary),
        description: stringOrNull(operation.description),
        tags: stringArray(operation.tags),
        deprecated: operation.deprecated === true,
        operationId: stringOrNull(operation.operationId),
        parameters,
        parameterDetails,
        requestBodyContentTypes: requestBodyContentTypes(operation.requestBody),
        requestBodyParameters: requestBodyParameters(operation.requestBody, openapi),
        responseStatusCodes: responseStatusCodes(operation.responses),
        responseDetails: responseDetails(operation.responses),
        responseBodyParameters: responseBodyParameters(operation.responses, openapi),
      })
    }
  }

  return apis
}

function buildExportBody(inputs: Record<string, unknown>) {
  const apiId = normalizeOptionalPositiveIntegerId(inputs.apiId, 'apiId')
  const folderId = normalizeOptionalPositiveIntegerId(inputs.folderId, 'folderId')
  const body: Record<string, unknown> = {
    scope: apiId !== undefined
      ? { type: 'SELECTED_ENDPOINTS', selectedEndpointIds: [apiId] }
      : folderId !== undefined
        ? { type: 'SELECTED_FOLDERS', selectedFolderIds: [folderId] }
        : { type: 'ALL' },
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
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "listApifoxApis",
 *   "displayName": "读取 APIFox 接口",
 *   "category": "integration",
 *   "description": "调用 APIFox 开放 API 导出 OpenAPI，并从 paths 中提取接口列表。",
 *   "inputs": [
 *     { "key": "projectId", "type": "string|number", "required": true, "description": "APIFox 项目 ID。" },
 *     { "key": "baseUrl", "type": "string", "required": false, "description": "APIFox API 基础地址。" },
 *     { "key": "locale", "type": "string", "required": false, "description": "APIFox locale 参数。" },
 *     { "key": "branchId", "type": "number|string", "required": false, "description": "可选分支 ID。" },
 *     { "key": "moduleId", "type": "number|string", "required": false, "description": "可选模块 ID。" },
 *     { "key": "folderId", "type": "number|string", "required": false, "description": "可选目录 ID。" },
 *     { "key": "apiId", "type": "number|string", "required": false, "description": "可选接口 ID。" },
 *     { "key": "includeRawOpenapi", "type": "boolean", "required": false, "defaultValue": false, "description": "是否返回原始 OpenAPI 文档。" }
 *   ],
 *   "outputs": [
 *     { "key": "apis", "type": "ApifoxApi[]", "description": "从 OpenAPI paths 中提取出的接口列表。" },
 *     { "key": "count", "type": "number", "description": "接口数量。" },
 *     { "key": "openapi", "type": "unknown|null", "description": "includeRawOpenapi=true 时返回原始 OpenAPI，否则为 null。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_APIFOX_CONFIG_MISSING", "description": "APIFox access token 未配置。" },
 *     { "code": "BLOCK_APIFOX_INPUT_INVALID", "description": "projectId 或筛选 ID 输入无效。" },
 *     { "code": "BLOCK_APIFOX_REQUEST_FAILED", "description": "APIFox OpenAPI 导出请求失败。" },
 *     { "code": "BLOCK_APIFOX_RESPONSE_INVALID", "description": "APIFox 返回内容不是合法 OpenAPI JSON。" }
 *   ],
 *   "config": [
 *     { "key": "APIFOX_ACCESS_TOKEN", "type": "string", "required": true, "description": "APIFox 开放 API access token。" }
 *   ],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "network", "type": "string", "value": "APIFox Open API", "description": "会请求 APIFox OpenAPI 导出接口。" }
 *   ],
 *   "examples": [
 *     { "title": "列出项目接口", "block": { "uuid": "list_apifox_apis", "functionName": "listApifoxApis", "inputs": { "projectId": { "template": "{{request.query.projectId}}" } }, "outputs": ["apis", "count", "openapi"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeListApifoxApisBlock: BlockExecutor = async ({ inputs }) => {
  const projectId = normalizeProjectId(inputs.projectId)
  const baseUrl = normalizeApifoxBaseUrl(inputs.baseUrl)
  const locale = normalizeApifoxLocale(inputs.locale)
  const accessToken = readApifoxAccessToken()
  const url = buildExportUrl(baseUrl, projectId, locale)
  const body = buildExportBody(inputs)

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
      body: JSON.stringify(body),
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
