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
  normalizeDatasourceName,
} from './db.js'
import { mokelayError, toMokelayErrorResponse } from './mokelay-error.js'
import {
  assertApiJsonUuid,
  calculateTemplateSchema,
  parseApiJson,
  type ApiJson,
  type Block,
  type BlockDefinition,
  type BlockExecutionContext,
  type CalculateTemplate,
  type Controller,
  type DatasourceSqlExecutor,
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
} from './orchestration-schema.js'
import { processorExecutors } from './processors/index.js'
import { loadApiJsonFromR2 } from './r2-api-json.js'

export type { OrchestrationCondition as Condition } from './orchestration-schema.js'

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

async function loadApiJsonFromNitroAssets(apiJsonUuid: string) {
  try {
    const runtime = await import('nitropack/runtime') as unknown as {
      useStorage?: (base: string) => {
        getItem: (key: string) => Promise<unknown>
      }
    }

    if (!runtime.useStorage) {
      return undefined
    }

    const { useStorage } = runtime
    const value = await useStorage('assets:server').getItem(`mokelay-apis/${apiJsonUuid}.json`)

    return value ?? undefined
  } catch {
    return undefined
  }
}

async function loadApiJsonFromFileSystem(apiJsonUuid: string) {
  const apiJsonDir = resolve(process.cwd(), 'server/assets/mokelay-apis')
  const filePath = resolve(apiJsonDir, `${apiJsonUuid}.json`)

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

async function loadApiJsonFromDatabase(apiJsonUuid: string, executeSql: DatasourceSqlExecutor) {
  try {
    const table = identifierSql('apis', 'table', 'BLOCK_INVALID_TABLE')
    const apiJsonField = identifierSql('api_json', 'fields', 'BLOCK_INVALID_FIELDS')
    const uuidField = identifierSql('uuid', 'fields', 'BLOCK_INVALID_FIELDS')
    const statusField = identifierSql('status', 'fields', 'BLOCK_INVALID_FIELDS')
    const databaseType = datasourceDatabaseType('Mokelay')
    const result = await executeSql<{ api_json: unknown }>(
      sql`SELECT ${apiJsonField} FROM ${table} WHERE ${uuidField} = ${apiJsonUuid} AND ${statusField} = ${'published'} LIMIT 1`,
      'Mokelay',
      databaseType,
    )

    return result.rows[0]?.api_json
  } catch (error) {
    const data = typeof error === 'object' && error && 'data' in error ? error.data : undefined
    const code = isRecord(data) ? data.code : undefined

    if (code === 'BLOCK_DATASOURCE_URL_MISSING') {
      return undefined
    }

    throw error
  }
}

export async function loadApiJson(apiJsonUuid: string, executeSql: DatasourceSqlExecutor = defaultExecuteSql) {
  assertApiJsonUuid(apiJsonUuid)

  const localFileValue = await loadApiJsonFromFileSystem(apiJsonUuid)

  if (localFileValue !== undefined) {
    return parseLoadedApiJson(apiJsonUuid, localFileValue)
  }

  const nitroAssetsValue = await loadApiJsonFromNitroAssets(apiJsonUuid)

  if (nitroAssetsValue !== undefined) {
    return parseLoadedApiJson(apiJsonUuid, nitroAssetsValue)
  }

  const r2Value = await loadApiJsonFromR2(apiJsonUuid)

  if (r2Value !== undefined) {
    return parseLoadedApiJson(apiJsonUuid, r2Value)
  }

  const databaseValue = await loadApiJsonFromDatabase(apiJsonUuid, executeSql)

  if (databaseValue !== undefined) {
    return databaseValue
  }

  throw mokelayError('API_JSON_NOT_FOUND', 'API JSON 不存在。', 404)
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

async function readRequestContext(event: H3Event, apiJson: ApiJson): Promise<RequestContext> {
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

async function executeBlock(
  block: Block,
  context: BlockExecutionContext,
  executeSql: DatasourceSqlExecutor,
  event: H3Event,
  definitions: Readonly<Record<string, BlockDefinition>>,
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

  const outputs = await definition.executor({ event, block, inputs, executeSql: executeBlockSql, databaseType })
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
  event: H3Event,
  definitions: Readonly<Record<string, BlockDefinition>>,
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
      await executeBlock(block, context, executeSql, event, definitions, debugStep)
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

      throw error
    }
  }

  return terminalUuid
}

async function executeApiJsonWithDefinitions(
  event: H3Event,
  rawApiJson: unknown,
  options: OrchestrationHandlerOptions,
  definitions: Readonly<Record<string, BlockDefinition>>,
) {
  const apiJsonUuid = assertApiJsonUuid(getRouterParam(event, 'apiJsonUuid'))
  const includeDebugResponse = shouldIncludeDebug(event)

  const apiJson = parseApiJson(apiJsonUuid, rawApiJson)
  const actualMethod = getMethod(event).toUpperCase()

  if (apiJson.method !== actualMethod) {
    throw mokelayError('REQUEST_METHOD_MISMATCH', `请求方法不匹配，应使用 ${apiJson.method}。`, 400)
  }

  const request = await readRequestContext(event, apiJson)
  const executeSql = options.executeSql ?? defaultExecuteSql
  const debug: MokelayDebugResponse | undefined = includeDebugResponse ? createDebugResponse() : undefined

  if (debug) {
    setDebugResponse(event, debug)
  }

  const context: BlockExecutionContext = {
    request,
    header: request.header,
    query: request.query,
    body: request.body,
    now: formatSqlTimestamp(new Date()),
    blocks: {},
  }

  const terminalUuid = await executeBlockGraph(apiJson.blocks, context, executeSql, event, definitions, debug)
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
  return await executeApiJsonWithDefinitions(event, rawApiJson, options, resolveBlockDefinitions(options.blockDefinitions))
}

export function createMokelayOrchestrationHandler(options: OrchestrationHandlerOptions = {}): EventHandler {
  const definitions = resolveBlockDefinitions(options.blockDefinitions)

  return defineEventHandler(async (event) => {
    try {
      const apiJsonUuid = assertApiJsonUuid(getRouterParam(event, 'apiJsonUuid'))
      const rawApiJson = options.loadApiJson
        ? await options.loadApiJson(apiJsonUuid)
        : await loadApiJson(apiJsonUuid, options.executeSql)

      return await executeApiJsonWithDefinitions(event, rawApiJson, options, definitions)
    } catch (error) {
      setResponseStatus(event, 200)
      return includeDebug(toMokelayErrorResponse(error), getDebugResponse(event))
    }
  })
}
