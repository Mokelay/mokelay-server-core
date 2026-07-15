import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { sql, type SQL } from 'drizzle-orm'
import {
  defineEventHandler,
  getHeader,
  getMethod,
  getQuery,
  getRequestHeaders,
  getRouterParam,
  readBody,
  readMultipartFormData,
  setResponseHeader,
  setResponseStatus,
  type EventHandler,
  type H3Event,
} from 'h3'
import { blockDefinitions as builtInBlockDefinitions } from './blocks/index.js'
import { identifierSql, isRecord, requireDatabaseType } from './blocks/shared.js'
import { controllerExecutors } from './controllers/index.js'
import {
  datasourceDatabaseType,
  executeDatasourceSql,
  executeDatasourceTransaction,
  normalizeDatasourceName,
} from './db.js'
import { mokelayError, toMokelayErrorResponse } from './mokelay-error.js'
import {
  assertApiJsonUuid,
  calculateTemplateSchema,
  parseApiJson,
  type ApiJsonSource,
  type ApiJson,
  type Block,
  type BlockDefinition,
  type BlockExecutionContext,
  type CalculateTemplate,
  type Controller,
  type DatasourceSqlExecutor,
  type DatasourceTransactionRunner,
  type EndpointApiJson,
  type FragmentApiJson,
  type FragmentInvocation,
  type MokelayDebugBlockStep,
  type MokelayDebugControllerStep,
  type MokelayDebugError,
  type MokelayDebugResponse,
  type MokelayDebugStep,
  type OrchestrationBlock,
  type MokelaySuccessResponse,
  type NextBlockUuid,
  type OrchestrationHandlerOptions,
  type ProcessableKey,
  type ProcessorConfig,
  type ResponseConfig,
  type RequestContext,
  type SqlExecutor,
  type StarterBlock,
  isFragmentApiJson,
} from './orchestration-schema.js'
import { processorExecutors } from './processors/index.js'
import { loadApiJsonFromR2 } from './r2-api-json.js'

export type {
  ApiJsonSource,
  OrchestrationCondition as Condition,
} from './orchestration-schema.js'

const templatePattern = /\{\{\s*([^}]+?)\s*\}\}/g
const wholeTemplatePattern = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/
const debugQueryParam = '__debug'

type MokelayEventContext = H3Event['context'] & {
  mokelayDebug?: MokelayDebugResponse
}

function mokelayEventContext(event: H3Event) {
  return event.context as MokelayEventContext
}

function shouldIncludeDebug(event: H3Event) {
  const value = getQuery(event)[debugQueryParam]

  return Array.isArray(value) ? value.includes('1') : value === '1'
}

function setDebugResponse(event: H3Event, debug: MokelayDebugResponse) {
  mokelayEventContext(event).mokelayDebug = debug
}

function getDebugResponse(event: H3Event) {
  return mokelayEventContext(event).mokelayDebug
}

function includeDebug<T extends { debug?: MokelayDebugResponse }>(response: T, debug: MokelayDebugResponse | undefined): T {
  return debug ? { ...response, debug } : response
}

function createDebugResponse(): MokelayDebugResponse {
  return {
    uuid: 'starter',
    nextBlock: null,
  }
}

function toDebugError(error: unknown): MokelayDebugError {
  return toMokelayErrorResponse(error).error
}

function toDebugValue(value: unknown): unknown {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return {
      type: Buffer.isBuffer(value) ? 'Buffer' : 'Uint8Array',
      byteLength: value.byteLength,
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => toDebugValue(item))
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key.toLowerCase() === 'token' ? '[redacted]' : toDebugValue(item),
      ]),
    )
  }

  return value
}

function formatSqlTimestamp(date: Date) {
  return date.toISOString().replace('T', ' ').replace('Z', '+00:00')
}

type SystemApiAssetDirectory = '' | 'fragment'

function systemApiAssetPath(apiJsonUuid: string, directory: SystemApiAssetDirectory) {
  return directory
    ? `mokelay-apis/${directory}/${apiJsonUuid}.json`
    : `mokelay-apis/${apiJsonUuid}.json`
}

async function loadApiJsonFromNitroAssets(
  apiJsonUuid: string,
  directory: SystemApiAssetDirectory = '',
) {
  let runtime: {
    useStorage?: (base: string) => {
      getItem: (key: string) => Promise<unknown>
    }
  }

  try {
    runtime = await import('nitropack/runtime') as unknown as typeof runtime
  } catch {
    return undefined
  }

  if (!runtime.useStorage) {
    return undefined
  }

  // Nitro reports a missing key as null/undefined. Do not swallow storage
  // failures here: falling through to R2/database after a system-asset outage
  // could execute a user API with the same UUID and cross ownership domains.
  const value = await runtime.useStorage('assets:server').getItem(
    systemApiAssetPath(apiJsonUuid, directory),
  )

  return value ?? undefined
}

async function loadApiJsonFromFileSystem(
  apiJsonUuid: string,
  directory: SystemApiAssetDirectory = '',
) {
  const apiJsonDir = resolve(process.cwd(), 'server/assets/mokelay-apis')
  const filePath = resolve(apiJsonDir, directory, `${apiJsonUuid}.json`)

  if (!filePath.startsWith(`${apiJsonDir}${sep}`)) {
    throw mokelayError('API_JSON_UUID_INVALID', 'API_JSON_UUID 无效。', 400)
  }

  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined

    if (code === 'ENOENT') {
      return undefined
    }

    throw error
  }
}

function parseLoadedApiJson(apiJsonUuid: string, value: unknown) {
  if (typeof value !== 'string') {
    return value
  }

  try {
    return JSON.parse(value) as unknown
  } catch {
    throw mokelayError('API_JSON_INVALID_JSON', `API JSON ${apiJsonUuid} 不是合法 JSON。`, 400)
  }
}

async function defaultExecuteSql<T extends Record<string, unknown> = Record<string, unknown>>(query: SQL, datasource: string) {
  return await executeDatasourceSql<T>(query, datasource)
}

function hasMokelayDatabaseConfiguration() {
  return [
    'Mokelay_DATABASE_URL',
    'Mokelay_Type',
    'Mokelay_Host',
    'Mokelay_Port',
    'Mokelay_Schema',
    'Mokelay_User',
    'Mokelay_Password',
  ].some((key) => Object.prototype.hasOwnProperty.call(process.env, key))
}

type ApiJsonDatabaseLookup = {
  found: false
} | {
  found: true
  value: unknown
  fragment: boolean
  status: unknown
}

function databaseBoolean(value: unknown) {
  return value === true || value === 1 || value === '1'
}

async function loadApiJsonDatabaseRecord(
  apiJsonUuid: string,
  executeSql: DatasourceSqlExecutor,
): Promise<ApiJsonDatabaseLookup> {
  if (!hasMokelayDatabaseConfiguration()) {
    return { found: false }
  }

  try {
    const table = identifierSql('apis', 'table', 'BLOCK_INVALID_TABLE')
    const apiJsonField = identifierSql('api_json', 'fields', 'BLOCK_INVALID_FIELDS')
    const fragmentField = identifierSql('fragment', 'fields', 'BLOCK_INVALID_FIELDS')
    const uuidField = identifierSql('uuid', 'fields', 'BLOCK_INVALID_FIELDS')
    const statusField = identifierSql('status', 'fields', 'BLOCK_INVALID_FIELDS')
    const databaseType = datasourceDatabaseType('Mokelay')
    const result = await executeSql<{ api_json: unknown, fragment: unknown, status: unknown }>(
      sql`SELECT ${apiJsonField}, ${fragmentField}, ${statusField} FROM ${table} WHERE ${uuidField} = ${apiJsonUuid} LIMIT 1`,
      'Mokelay',
      databaseType,
    )
    const row = result.rows[0]

    return row
      ? {
          found: true,
          value: row.api_json,
          fragment: databaseBoolean(row.fragment),
          status: row.status,
        }
      : { found: false }
  } catch (error) {
    const data = typeof error === 'object' && error && 'data' in error ? error.data : undefined
    const code = isRecord(data) ? data.code : undefined

    if (code === 'BLOCK_DATASOURCE_URL_MISSING') {
      return { found: false }
    }

    throw error
  }
}

type FragmentDatabaseLookup = {
  found: boolean
  value?: unknown
}

async function loadPublishedFragmentFromDatabase(
  apiJsonUuid: string,
  executeSql: DatasourceSqlExecutor,
): Promise<FragmentDatabaseLookup> {
  const row = await loadApiJsonDatabaseRecord(apiJsonUuid, executeSql)

  if (!row.found) {
    return { found: false }
  }

  if (!row.fragment) {
    throw mokelayError('FRAGMENT_TARGET_INVALID', `${apiJsonUuid} 不是 Fragment。`, 400)
  }

  if (row.status !== 'published') {
    throw mokelayError('FRAGMENT_TARGET_INVALID', `Fragment ${apiJsonUuid} 尚未发布。`, 409)
  }

  return { found: true, value: row.value }
}

export type LoadedApiJson = {
  apiJson: unknown
  source: ApiJsonSource
}

/**
 * Loads a top-level HTTP API and reports the ownership domain used for all
 * Fragment references made by that API. Root server/Nitro assets are system
 * APIs; R2 and database records are user APIs.
 */
export async function loadApiJsonWithSource(
  apiJsonUuid: string,
  executeSql: DatasourceSqlExecutor = defaultExecuteSql,
): Promise<LoadedApiJson> {
  assertApiJsonUuid(apiJsonUuid)

  const localFileValue = await loadApiJsonFromFileSystem(apiJsonUuid)

  if (localFileValue !== undefined) {
    return {
      apiJson: parseLoadedApiJson(apiJsonUuid, localFileValue),
      source: 'system',
    }
  }

  const nitroAssetsValue = await loadApiJsonFromNitroAssets(apiJsonUuid)

  if (nitroAssetsValue !== undefined) {
    return {
      apiJson: parseLoadedApiJson(apiJsonUuid, nitroAssetsValue),
      source: 'system',
    }
  }

  const databaseConfigured = hasMokelayDatabaseConfiguration()
  const [r2Lookup, databaseLookup] = await Promise.allSettled([
    loadApiJsonFromR2(apiJsonUuid),
    loadApiJsonDatabaseRecord(apiJsonUuid, executeSql),
  ])
  const databaseRecord = databaseLookup.status === 'fulfilled' ? databaseLookup.value : undefined

  // A current Fragment record always wins over an old endpoint object in R2.
  // Without this preflight, deleting an endpoint and reusing its UUID for a
  // Fragment could leave the old HTTP endpoint executable indefinitely.
  if (databaseRecord?.found && databaseRecord.fragment) {
    throw mokelayError(
      'FRAGMENT_DIRECT_EXECUTION_FORBIDDEN',
      `Fragment ${apiJsonUuid} 不能通过 HTTP 独立执行。`,
      400,
    )
  }

  // If a configured database cannot answer the kind preflight, fail closed:
  // serving R2 here could execute an old endpoint after its UUID became a Fragment.
  if (databaseLookup.status === 'rejected') {
    throw databaseLookup.reason
  }

  // In a database-backed deployment, an R2 object without a current metadata
  // row is stale (for example after deletion) and must not resurrect the API.
  if (databaseConfigured && databaseRecord && !databaseRecord.found) {
    throw mokelayError('API_JSON_NOT_FOUND', 'API JSON 不存在。', 404)
  }

  const r2Value = r2Lookup.status === 'fulfilled' ? r2Lookup.value : undefined

  if (r2Value !== undefined) {
    return {
      apiJson: parseLoadedApiJson(apiJsonUuid, r2Value),
      source: 'user',
    }
  }

  if (databaseRecord?.found && databaseRecord.status === 'published') {
    return {
      apiJson: parseLoadedApiJson(apiJsonUuid, databaseRecord.value),
      source: 'user',
    }
  }

  throw mokelayError('API_JSON_NOT_FOUND', 'API JSON 不存在。', 404)
}

/**
 * Backward-compatible raw top-level API loader. Use loadApiJsonWithSource when
 * the caller will execute the API and therefore needs Fragment source routing.
 */
export async function loadApiJson(
  apiJsonUuid: string,
  executeSql: DatasourceSqlExecutor = defaultExecuteSql,
) {
  return (await loadApiJsonWithSource(apiJsonUuid, executeSql)).apiJson
}

/**
 * Loads a Fragment owned by a built-in API. System Fragments live only below
 * server/assets/mokelay-apis/fragment (or the equivalent Nitro asset path).
 */
export async function loadSystemFragmentApiJson(apiJsonUuid: string) {
  assertApiJsonUuid(apiJsonUuid)

  const localFileValue = await loadApiJsonFromFileSystem(apiJsonUuid, 'fragment')

  if (localFileValue !== undefined) {
    return parseLoadedApiJson(apiJsonUuid, localFileValue)
  }

  const nitroAssetsValue = await loadApiJsonFromNitroAssets(apiJsonUuid, 'fragment')

  if (nitroAssetsValue !== undefined) {
    return parseLoadedApiJson(apiJsonUuid, nitroAssetsValue)
  }

  throw mokelayError('API_JSON_NOT_FOUND', `内置 Fragment ${apiJsonUuid} 不存在。`, 404)
}

/**
 * Loads a Fragment owned by a user API from the authoritative published
 * database record. System assets and R2 are deliberately excluded.
 */
export async function loadUserFragmentApiJson(
  apiJsonUuid: string,
  executeSql: DatasourceSqlExecutor = defaultExecuteSql,
) {
  assertApiJsonUuid(apiJsonUuid)

  const databaseLookup = await loadPublishedFragmentFromDatabase(apiJsonUuid, executeSql)

  if (databaseLookup.found) {
    return parseLoadedApiJson(apiJsonUuid, databaseLookup.value)
  }

  throw mokelayError('API_JSON_NOT_FOUND', `Fragment ${apiJsonUuid} 不存在。`, 404)
}

/** @deprecated Prefer loadUserFragmentApiJson for explicit source ownership. */
export async function loadFragmentApiJson(
  apiJsonUuid: string,
  executeSql: DatasourceSqlExecutor = defaultExecuteSql,
) {
  return await loadUserFragmentApiJson(apiJsonUuid, executeSql)
}

function declarationKey(declaration: ProcessableKey) {
  return typeof declaration === 'string' ? declaration : declaration.key
}

function declarationProcessors(declaration: ProcessableKey) {
  return typeof declaration === 'string' ? [] : declaration.processors ?? []
}

function processorName(config: ProcessorConfig) {
  return typeof config === 'string' ? config : config.processor
}

async function processorParams(config: ProcessorConfig, context?: BlockExecutionContext) {
  if (typeof config === 'string' || config.param === undefined) {
    return []
  }

  const param = context ? await resolveTemplates(config.param, context) : config.param

  return Array.isArray(param) ? param : [param]
}

async function applyProcessor(value: unknown, config: ProcessorConfig, label: string, context?: BlockExecutionContext) {
  const name = processorName(config)
  const executor = processorExecutors[name]

  if (!executor) {
    throw mokelayError('PROCESSOR_UNSUPPORTED', `不支持的 Processor：${name}`, 400)
  }

  return await executor({
    value,
    params: await processorParams(config, context),
    label,
    context,
  })
}

async function applyProcessors(value: unknown, processors: ProcessorConfig[], label: string, context?: BlockExecutionContext) {
  let current = value

  for (const processor of processors) {
    current = await applyProcessor(current, processor, label, context)
  }

  return current
}

function parseCalculateTemplate(value: unknown): CalculateTemplate | undefined {
  const parsed = calculateTemplateSchema.safeParse(value)

  if (parsed.success) {
    return parsed.data
  }

  if (isRecord(value) && typeof value.template === 'string' && Object.prototype.hasOwnProperty.call(value, 'processors')) {
    throw mokelayError(
      'PROCESSOR_INVALID_CONFIG',
      `template processors 配置无效：${parsed.error.issues[0]?.message || '输入内容无效。'}`,
      400,
    )
  }

  return undefined
}

function stringifyTemplateValue(value: unknown) {
  if (value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return JSON.stringify(value)
}

function parsePathExpression(expression: string) {
  const tokens: string[] = []
  const matcher = /(?:^|\.)([A-Za-z_$][A-Za-z0-9_$]*)|\[['"]([^'"\]]+)['"]\]|\[(\d+)\]/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = matcher.exec(expression)) !== null) {
    if (match.index !== cursor) {
      throw mokelayError('TEMPLATE_PATH_INVALID', `模板路径无效：${expression}`, 400)
    }

    tokens.push(match[1] ?? match[2] ?? match[3] ?? '')
    cursor = match.index + match[0].length
  }

  if (tokens.length === 0 || cursor !== expression.length) {
    throw mokelayError('TEMPLATE_PATH_INVALID', `模板路径无效：${expression}`, 400)
  }

  return tokens
}

function getByPath(source: unknown, expression: string) {
  const tokens = parsePathExpression(expression.trim())
  let current = source

  for (const token of tokens) {
    if (current === null || current === undefined) {
      throw mokelayError('TEMPLATE_VARIABLE_NOT_FOUND', `模板变量不存在：${expression}`, 400)
    }

    if (Array.isArray(current)) {
      const index = Number(token)

      if (!Number.isSafeInteger(index)) {
        throw mokelayError('TEMPLATE_ARRAY_INDEX_INVALID', `模板数组索引无效：${expression}`, 400)
      }

      current = current[index]
      continue
    }

    if (!isRecord(current) || !(token in current)) {
      throw mokelayError('TEMPLATE_VARIABLE_NOT_FOUND', `模板变量不存在：${expression}`, 400)
    }

    current = current[token]
  }

  return current
}

function renderTemplate(template: string, context: BlockExecutionContext) {
  const wholeTemplate = wholeTemplatePattern.exec(template)

  if (wholeTemplate?.[1]) {
    return getByPath(context, wholeTemplate[1])
  }

  return template.replace(templatePattern, (_, expression: string) => stringifyTemplateValue(getByPath(context, expression)))
}

async function resolveTemplates(value: unknown, context: BlockExecutionContext): Promise<unknown> {
  const template = parseCalculateTemplate(value)

  if (template) {
    const rendered = renderTemplate(template.template, context)
    return await applyProcessors(rendered, template.processors ?? [], 'template', context)
  }

  if (Array.isArray(value)) {
    return await Promise.all(value.map((item) => resolveTemplates(item, context)))
  }

  if (isRecord(value)) {
    const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => {
      return [key, await resolveTemplates(item, context)] as const
    }))

    return Object.fromEntries(entries)
  }

  return value
}

function normalizeHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? ''
  }

  return value ?? ''
}

function normalizeBody(body: unknown) {
  return isRecord(body) ? body : {}
}

function isMultipartRequest(event: H3Event) {
  return (getHeader(event, 'content-type') || '').toLowerCase().startsWith('multipart/form-data')
}

async function readDeclaredMultipartBody(event: H3Event, declarations: ProcessableKey[]) {
  const declaredKeys = new Set(declarations.map((declaration) => declarationKey(declaration)))
  const body: Record<string, unknown> = {}

  try {
    const formData = await readMultipartFormData(event)

    for (const item of formData ?? []) {
      if (!item.name || !declaredKeys.has(item.name) || Object.prototype.hasOwnProperty.call(body, item.name)) {
        continue
      }

      if (item.filename) {
        body[item.name] = {
          data: item.data,
          mimeType: item.type || '',
          fileName: item.filename,
          size: item.data.byteLength,
        }
        continue
      }

      body[item.name] = item.data.toString('utf8')
    }
  } catch (error) {
    throw mokelayError('REQUEST_INVALID_BODY', '请求 multipart/form-data body 无效。', 400, error)
  }

  return body
}

function requireDeclaredValue(source: Record<string, unknown>, name: string, sourceName: string) {
  if (!(name in source) || source[name] === undefined || source[name] === null || source[name] === '') {
    throw mokelayError('REQUEST_PARAMETER_MISSING', `缺少 ${sourceName} 参数：${name}`, 400)
  }

  return source[name]
}

async function readRequestContext(event: H3Event, apiJson: EndpointApiJson): Promise<RequestContext> {
  const shouldReadBody = getMethod(event) !== 'GET'
  const headers = getRequestHeaders(event)
  const headerContext: Record<string, unknown> = {}
  const rawQuery = getQuery(event)
  const queryContext: Record<string, unknown> = {}
  let bodyContext: Record<string, unknown> = {}

  if (shouldReadBody && apiJson.request.body.length > 0) {
    if (isMultipartRequest(event)) {
      bodyContext = await readDeclaredMultipartBody(event, apiJson.request.body)
    } else {
      try {
        bodyContext = normalizeBody(await readBody(event))
      } catch (error) {
        throw mokelayError('REQUEST_INVALID_BODY', '请求 body 不是合法 JSON。', 400, error)
      }
    }
  }

  for (const declaration of apiJson.request.header) {
    const name = declarationKey(declaration)
    const value = normalizeHeaderValue(headers[name.toLowerCase()])

    headerContext[name] = typeof declaration === 'string'
      ? requireDeclaredValue({ [name]: value }, name, 'header')
      : await applyProcessors(value, declarationProcessors(declaration), `request.header.${name}`)
  }

  for (const declaration of apiJson.request.query) {
    const name = declarationKey(declaration)
    const value = rawQuery[name]
    const normalizedValue = Array.isArray(value) ? value[0] : value

    queryContext[name] = typeof declaration === 'string'
      ? requireDeclaredValue({ [name]: normalizedValue }, name, 'query')
      : await applyProcessors(normalizedValue, declarationProcessors(declaration), `request.query.${name}`)
  }

  if (shouldReadBody) {
    for (const declaration of apiJson.request.body) {
      const name = declarationKey(declaration)

      bodyContext[name] = typeof declaration === 'string'
        ? requireDeclaredValue(bodyContext, name, 'body')
        : await applyProcessors(bodyContext[name], declarationProcessors(declaration), `request.body.${name}`)
    }
  }

  return {
    header: headerContext as Record<string, string>,
    query: queryContext,
    body: bodyContext,
  }
}

function requireFragmentParam(params: Record<string, unknown>, name: string) {
  if (!(name in params) || params[name] === undefined || params[name] === null || params[name] === '') {
    throw mokelayError('FRAGMENT_PARAMETER_MISSING', `缺少 Fragment 参数：${name}`, 400)
  }

  return params[name]
}

async function processFragmentParams(
  fragment: FragmentApiJson,
  rawParams: Record<string, unknown>,
  now: string,
) {
  const declaredNames = new Set(fragment.params.map((declaration) => declarationKey(declaration)))

  for (const name of Object.keys(rawParams)) {
    if (!declaredNames.has(name)) {
      throw mokelayError('FRAGMENT_PARAMETER_UNDECLARED', `Fragment 未声明参数：${name}`, 400)
    }
  }

  const context: BlockExecutionContext = {
    params: { ...rawParams },
    now,
    blocks: {},
  }

  for (const declaration of fragment.params) {
    const name = declarationKey(declaration)
    const value = typeof declaration === 'string'
      ? requireFragmentParam(rawParams, name)
      : await applyProcessors(
          rawParams[name],
          declarationProcessors(declaration),
          `params.${name}`,
          context,
        )

    context.params[name] = value
  }

  return context.params
}

function resolveBlockDefinitions(customDefinitions: OrchestrationHandlerOptions['blockDefinitions']) {
  if (!customDefinitions) {
    return builtInBlockDefinitions
  }

  for (const functionName of Object.keys(customDefinitions)) {
    if (Object.prototype.hasOwnProperty.call(builtInBlockDefinitions, functionName)) {
      throw new Error(`Custom Block definition cannot override built-in Block: ${functionName}`)
    }
  }

  return {
    ...builtInBlockDefinitions,
    ...customDefinitions,
  }
}

function validateDeclaredOutputs(block: Block, definition: BlockDefinition) {
  if (!block.outputs?.length) {
    return
  }

  for (const outputName of block.outputs) {
    const key = declarationKey(outputName)

    if (!definition.allowedOutputs.includes(key)) {
      throw mokelayError('BLOCK_UNSUPPORTED_OUTPUT', `Block ${block.functionName} 不支持输出：${key}`, 400)
    }
  }
}

type InternalFragmentInvoker = (
  input: FragmentInvocation,
  debugStep?: MokelayDebugBlockStep,
) => Promise<Record<string, unknown>>

async function executeBlock(
  block: Block,
  context: BlockExecutionContext,
  executeSql: DatasourceSqlExecutor,
  executeTransaction: DatasourceTransactionRunner,
  event: H3Event,
  definitions: Readonly<Record<string, BlockDefinition>>,
  invokeFragment: InternalFragmentInvoker,
  debugStep?: MokelayDebugBlockStep,
) {
  const definition = Object.prototype.hasOwnProperty.call(definitions, block.functionName)
    ? definitions[block.functionName]
    : undefined

  if (!definition) {
    throw mokelayError('BLOCK_UNSUPPORTED_FUNCTION', `不支持的 Block functionName：${block.functionName}`, 400)
  }

  validateDeclaredOutputs(block, definition)

  const inputs = await resolveTemplates(block.inputs, context) as Record<string, unknown>

  if (debugStep) {
    debugStep.inputs = toDebugValue(inputs) as Record<string, unknown>
  }

  context.blocks[block.uuid] = {
    inputs,
    outputs: {},
  }

  const datasource = definition.requiresDatasource
    ? normalizeDatasourceName(inputs.datasource)
    : undefined
  const databaseType = datasource ? datasourceDatabaseType(datasource) : undefined
  const executeBlockSql: SqlExecutor = (query) => {
    if (!datasource) {
      throw mokelayError('BLOCK_SQL_UNSUPPORTED', `Block ${block.functionName} 不支持 SQL 执行。`, 500)
    }

    return executeSql(query, datasource, requireDatabaseType(databaseType))
  }

  const withTransaction: import('./db.js').TransactionRunner | undefined = datasource
    ? async <T>(callback: (executeSql: SqlExecutor) => Promise<T>, transactionOptions?: import('./db.js').TransactionOptions) => (
        await executeTransaction(datasource, callback, transactionOptions)
      )
    : undefined

  const outputs = await definition.executor({
    event,
    block,
    inputs,
    executeSql: executeBlockSql,
    databaseType,
    withTransaction,
    invokeFragment: block.functionName === 'executeFragment'
      ? async (input) => await invokeFragment(input, debugStep)
      : async () => {
          throw mokelayError(
            'FRAGMENT_TARGET_INVALID',
            'Fragment 只能通过 executeFragment Block 调用。',
            400,
          )
        },
  })
  context.blocks[block.uuid].outputs = outputs

  if (block.outputs) {
    for (const outputDeclaration of block.outputs) {
      const outputName = declarationKey(outputDeclaration)

      if (!(outputName in outputs)) {
        throw mokelayError('BLOCK_OUTPUT_MISSING', `Block ${block.uuid} 未产生声明的输出：${outputName}`, 400)
      }

      outputs[outputName] = await applyProcessors(
        outputs[outputName],
        declarationProcessors(outputDeclaration),
        `blocks['${block.uuid}'].outputs.${outputName}`,
        context,
      )
    }
  }

  context.blocks[block.uuid].outputs = outputs
  if (debugStep) {
    debugStep.outputs = toDebugValue(outputs) as Record<string, unknown>
  }

  return outputs
}

function isController(block: OrchestrationBlock): block is Controller {
  return 'type' in block && block.type === 'controller'
}

function isStarterBlock(block: OrchestrationBlock): block is StarterBlock {
  return block.uuid === 'starter'
}

async function executeController(
  controller: Controller,
  context: BlockExecutionContext,
  debugStep?: MokelayDebugControllerStep,
) {
  const executor = controllerExecutors[controller.functionName]

  if (!executor) {
    throw mokelayError('CONTROLLER_UNSUPPORTED_FUNCTION', `不支持的 Controller functionName：${controller.functionName}`, 400)
  }

  const inputs = await resolveTemplates(controller.inputs, context) as Record<string, unknown>
  if (debugStep) {
    debugStep.inputs = toDebugValue(inputs) as Record<string, unknown>
  }

  const selectedNode = executor({ controller, inputs })

  if (debugStep) {
    debugStep.node = {
      uuid: selectedNode.uuid,
      nextBlock: null,
    }
  }

  return selectedNode
}

function buildBlockMap(blocks: OrchestrationBlock[]) {
  let starterNextBlock: NextBlockUuid = null
  const blockMap = new Map<string, Block | Controller>()

  for (const block of blocks) {
    if (isStarterBlock(block)) {
      starterNextBlock = block.nextBlock
      continue
    }

    blockMap.set(block.uuid, block)
  }

  return { starterNextBlock, blockMap }
}

function hasResponseConfig(apiJson: ApiJson) {
  return Object.prototype.hasOwnProperty.call(apiJson, 'response')
}

function responseForTerminal(apiJson: ApiJson, terminalUuid: string): ResponseConfig {
  if (apiJson.responses && Object.prototype.hasOwnProperty.call(apiJson.responses, terminalUuid)) {
    return apiJson.responses[terminalUuid] ?? null
  }

  if (hasResponseConfig(apiJson)) {
    return apiJson.response ?? null
  }

  if (apiJson.responses) {
    throw mokelayError('API_JSON_INVALID_RESPONSE', `responses 缺少终点 ${terminalUuid} 的响应配置。`, 400)
  }

  return null
}

type AppendDebugStep = (step: MokelayDebugStep) => void

async function executeBlockGraph(
  blocks: OrchestrationBlock[],
  context: BlockExecutionContext,
  executeSql: DatasourceSqlExecutor,
  executeTransaction: DatasourceTransactionRunner,
  event: H3Event,
  definitions: Readonly<Record<string, BlockDefinition>>,
  invokeFragment: InternalFragmentInvoker,
  debug?: MokelayDebugResponse,
) {
  const { starterNextBlock, blockMap } = buildBlockMap(blocks)
  const visited = new Set<string>()
  let nextBlockUuid = starterNextBlock
  let terminalUuid = 'starter'
  let appendDebugStep: AppendDebugStep | undefined = debug
    ? (step) => {
        debug.nextBlock = step
      }
    : undefined

  while (nextBlockUuid !== null) {
    if (visited.has(nextBlockUuid)) {
      throw mokelayError('API_JSON_INVALID_FLOW', `API JSON 流程存在循环：${nextBlockUuid}`, 400)
    }

    visited.add(nextBlockUuid)

    const block = blockMap.get(nextBlockUuid)

    if (!block) {
      throw mokelayError('API_JSON_INVALID_FLOW', `API JSON 流程指向不存在的 block：${nextBlockUuid}`, 400)
    }

    if (isController(block)) {
      const debugStep: MokelayDebugControllerStep | undefined = debug
        ? {
            uuid: block.uuid,
            type: 'controller',
            inputs: {},
          }
        : undefined

      if (debugStep) {
        appendDebugStep?.(debugStep)
      }

      try {
        const selectedNode = await executeController(block, context, debugStep)
        terminalUuid = selectedNode.uuid
        nextBlockUuid = selectedNode.nextBlock
        appendDebugStep = debugStep?.node
          ? (step) => {
              debugStep.node!.nextBlock = step
            }
          : undefined
      } catch (error) {
        if (debugStep) {
          debugStep.error = toDebugError(error)
          if (debugStep.node) {
            debugStep.node.nextBlock = null
          }
        }

        throw error
      }

      continue
    }

    const debugStep: MokelayDebugBlockStep | undefined = debug
      ? {
          uuid: block.uuid,
          type: 'block',
          inputs: {},
          outputs: {},
          nextBlock: null,
        }
      : undefined

    if (debugStep) {
      appendDebugStep?.(debugStep)
    }

    try {
      await executeBlock(
        block,
        context,
        executeSql,
        executeTransaction,
        event,
        definitions,
        invokeFragment,
        debugStep,
      )
      terminalUuid = block.uuid
      nextBlockUuid = block.nextBlock
      appendDebugStep = debugStep
        ? (step) => {
            debugStep.nextBlock = step
          }
        : undefined
    } catch (error) {
      if (debugStep) {
        debugStep.error = toDebugError(error)
        debugStep.nextBlock = null
      }

      if (block.errorNextBlock !== undefined) {
        terminalUuid = block.uuid
        nextBlockUuid = block.errorNextBlock ?? null
        appendDebugStep = debugStep
          ? (step) => {
              debugStep.nextBlock = step
            }
          : undefined
        continue
      }

      throw error
    }
  }

  return terminalUuid
}

type ApiJsonExecutionSource = ApiJsonSource | 'custom'

async function loadReferencedApiJson(
  apiJsonUuid: string,
  options: OrchestrationHandlerOptions,
  source: ApiJsonExecutionSource,
) {
  if (source === 'custom') {
    if (!options.loadApiJson) {
      throw mokelayError('FRAGMENT_TARGET_INVALID', '自定义 API loader 不可用。', 500)
    }

    return await options.loadApiJson(apiJsonUuid)
  }

  return source === 'system'
    ? await loadSystemFragmentApiJson(apiJsonUuid)
    : await loadUserFragmentApiJson(apiJsonUuid, options.executeSql)
}

async function executeFragmentInvocation(
  invocation: FragmentInvocation,
  event: H3Event,
  options: OrchestrationHandlerOptions,
  definitions: Readonly<Record<string, BlockDefinition>>,
  executeSql: DatasourceSqlExecutor,
  executeTransaction: DatasourceTransactionRunner,
  now: string,
  source: ApiJsonExecutionSource,
  parentDebugStep?: MokelayDebugBlockStep,
) {
  const fragmentUuid = assertApiJsonUuid(invocation.fragmentUuid)
  const debug = parentDebugStep ? createDebugResponse() : undefined

  if (parentDebugStep && debug) {
    parentDebugStep.fragment = debug
  }

  const rawFragment = await loadReferencedApiJson(fragmentUuid, options, source)
  const fragment = parseApiJson(fragmentUuid, rawFragment)

  if (!isFragmentApiJson(fragment)) {
    throw mokelayError('FRAGMENT_TARGET_INVALID', `${fragmentUuid} 不是 Fragment。`, 400)
  }

  const params = await processFragmentParams(fragment, invocation.params, now)
  const context: BlockExecutionContext = {
    params,
    now,
    blocks: {},
  }
  const rejectNestedFragment: InternalFragmentInvoker = async () => {
    throw mokelayError(
      'FRAGMENT_NESTING_FORBIDDEN',
      `Fragment ${fragmentUuid} 不允许调用 Fragment。`,
      400,
    )
  }
  const terminalUuid = await executeBlockGraph(
    fragment.blocks,
    context,
    executeSql,
    executeTransaction,
    event,
    definitions,
    rejectNestedFragment,
    debug,
  )
  const responseConfig = responseForTerminal(fragment, terminalUuid)
  const result = responseConfig == null ? null : await resolveTemplates(responseConfig, context)

  if (!isRecord(result) || Object.keys(result).length === 0) {
    throw mokelayError('API_JSON_INVALID_RESPONSE', `Fragment ${fragmentUuid} 的 result 必须是对象。`, 400)
  }

  return result
}

async function executeApiJsonWithDefinitions(
  event: H3Event,
  rawApiJson: unknown,
  options: OrchestrationHandlerOptions,
  definitions: Readonly<Record<string, BlockDefinition>>,
  source: ApiJsonExecutionSource,
) {
  const apiJsonUuid = assertApiJsonUuid(getRouterParam(event, 'apiJsonUuid'))
  const includeDebugResponse = shouldIncludeDebug(event)

  const apiJson = parseApiJson(apiJsonUuid, rawApiJson)

  if (isFragmentApiJson(apiJson)) {
    throw mokelayError(
      'FRAGMENT_DIRECT_EXECUTION_FORBIDDEN',
      `Fragment ${apiJsonUuid} 不能通过 HTTP 独立执行。`,
      400,
    )
  }

  const actualMethod = getMethod(event).toUpperCase()

  if (apiJson.method !== actualMethod) {
    throw mokelayError('REQUEST_METHOD_MISMATCH', `请求方法不匹配，应使用 ${apiJson.method}。`, 400)
  }

  const request = await readRequestContext(event, apiJson)
  const executeSql = options.executeSql ?? defaultExecuteSql
  const executeTransaction: DatasourceTransactionRunner = options.executeTransaction
    ?? (options.executeSql
      ? async () => {
          throw mokelayError(
            'BLOCK_SQL_UNSUPPORTED',
            '自定义 executeSql 必须同时注入 executeTransaction 才能执行事务 Block。',
            500,
          )
        }
      : executeDatasourceTransaction)
  const debug: MokelayDebugResponse | undefined = includeDebugResponse ? createDebugResponse() : undefined

  if (debug) {
    setDebugResponse(event, debug)
  }

  const now = formatSqlTimestamp(new Date())
  const context: BlockExecutionContext = {
    request,
    header: request.header,
    query: request.query,
    body: request.body,
    now,
    blocks: {},
  }

  const invokeFragment: InternalFragmentInvoker = async (invocation, debugStep) => await executeFragmentInvocation(
    invocation,
    event,
    options,
    definitions,
    executeSql,
    executeTransaction,
    now,
    source,
    debugStep,
  )

  const terminalUuid = await executeBlockGraph(
    apiJson.blocks,
    context,
    executeSql,
    executeTransaction,
    event,
    definitions,
    invokeFragment,
    debug,
  )
  const responseConfig = responseForTerminal(apiJson, terminalUuid)

  const data = responseConfig == null ? null : await resolveTemplates(responseConfig, context)
  if (isRecord(data) && isRecord(data.redirect)) {
    const redirectUrl = data.redirect.url
    const statusCode = Number(data.redirect.statusCode ?? 302)

    if (typeof redirectUrl !== 'string' || !redirectUrl.trim()) {
      throw mokelayError('API_JSON_INVALID_RESPONSE', 'redirect.url 必须是非空字符串。', 400)
    }

    if (statusCode !== 302 && statusCode !== 303) {
      throw mokelayError('API_JSON_INVALID_RESPONSE', 'redirect.statusCode 只能是 302 或 303。', 400)
    }

    setResponseStatus(event, statusCode)
    setResponseHeader(event, 'Location', redirectUrl)

    return ''
  }

  const response: MokelaySuccessResponse = {
    ok: true,
    data,
  }

  return includeDebug(response, debug)
}

export async function executeApiJson(event: H3Event, rawApiJson: unknown, options: OrchestrationHandlerOptions = {}) {
  return await executeApiJsonWithDefinitions(
    event,
    rawApiJson,
    options,
    resolveBlockDefinitions(options.blockDefinitions),
    options.apiJsonSource ?? (options.loadApiJson ? 'custom' : 'user'),
  )
}

export function createMokelayOrchestrationHandler(options: OrchestrationHandlerOptions = {}): EventHandler {
  const definitions = resolveBlockDefinitions(options.blockDefinitions)

  return defineEventHandler(async (event) => {
    try {
      const apiJsonUuid = assertApiJsonUuid(getRouterParam(event, 'apiJsonUuid'))
      const loaded = options.loadApiJson
        ? {
            apiJson: await options.loadApiJson(apiJsonUuid),
            source: 'custom' as const,
          }
        : await loadApiJsonWithSource(apiJsonUuid, options.executeSql)

      return await executeApiJsonWithDefinitions(event, loaded.apiJson, options, definitions, loaded.source)
    } catch (error) {
      setResponseStatus(event, 200)
      return includeDebug(toMokelayErrorResponse(error), getDebugResponse(event))
    }
  })
}
