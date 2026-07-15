import { type SQL } from 'drizzle-orm'
import { type H3Event } from 'h3'
import { z } from 'zod'
import {
  type DatabaseType,
  type SqlExecutionResult,
  type TransactionOptions,
  type TransactionRunner,
} from './db.js'
import { mokelayError } from './mokelay-error.js'

const apiJsonUuidPattern = /^[A-Za-z0-9_-]{1,128}$/

export const processorConfigSchema = z.union([
  z.string().min(1, 'processor 不能为空。'),
  z.object({
    processor: z.string().min(1, 'processor 不能为空。'),
    param: z.unknown().optional(),
  }).strict(),
])
export const processorsSchema = z.array(processorConfigSchema)
export const processableKeySchema = z.union([
  z.string().min(1),
  z.object({
    key: z.string().min(1, 'key 不能为空。'),
    processors: processorsSchema.optional().default([]),
  }).strict(),
])
export const calculateTemplateSchema = z.object({
  template: z.string().min(1, '模板不能为空。'),
  processors: processorsSchema.optional().default([]),
}).strict()

const conditionTypeSchema = z.enum(['GE', 'GT', 'LE', 'LT', 'NEQ', 'EQ', 'NOTIN', 'IN', 'LIKE'])
const groupTypeSchema = z.enum(['AND', 'OR'])

export type CalculateTemplate = z.infer<typeof calculateTemplateSchema>
export type ProcessorConfig = z.infer<typeof processorConfigSchema>
export type ProcessableKey = z.infer<typeof processableKeySchema>

export type NextBlockUuid = string | null

type LeafCondition = {
  group: false
  fieldName: string
  fieldValue?: unknown
  conditionType: z.infer<typeof conditionTypeSchema>
  optional?: boolean
}

type GroupCondition = {
  group: true
  groupType: z.infer<typeof groupTypeSchema>
  groups: OrchestrationCondition[]
}

export type OrchestrationCondition = LeafCondition | GroupCondition

export const conditionSchema: z.ZodType<OrchestrationCondition> = z.lazy(() => z.union([
  z.object({
    group: z.literal(false),
    fieldName: z.string().min(1, '条件字段不能为空。'),
    fieldValue: z.any(),
    conditionType: conditionTypeSchema,
    optional: z.boolean().optional(),
  }).strict().refine((value) => Object.prototype.hasOwnProperty.call(value, 'fieldValue'), {
    message: 'fieldValue 不能为空。',
  }),
  z.object({
    group: z.literal(true),
    groupType: groupTypeSchema,
    groups: z.array(conditionSchema).min(1, '条件组不能为空。'),
  }).strict(),
]))

const requestSchema = z.object({
  header: z.array(processableKeySchema).optional().default([]),
  query: z.array(processableKeySchema).optional().default([]),
  body: z.array(processableKeySchema).optional().default([]),
}).strict()

export type Block = {
  uuid: string
  alias?: string
  functionName: string
  type?: string
  inputs: Record<string, unknown>
  outputs?: ProcessableKey[] | null
  nextBlock: NextBlockUuid
  errorNextBlock?: NextBlockUuid
}

export type ExecuteFragmentBlock = Block & {
  functionName: 'executeFragment'
  inputs: {
    fragmentUuid: string
    params: Record<string, unknown>
  }
  outputs: ['result']
}

export type StarterBlock = {
  uuid: 'starter'
  nextBlock: NextBlockUuid
}

export type ControllerNode = {
  uuid: string
  alias?: string
  type?: 'DEFAULT'
  value?: string | number | boolean
  nextBlock: NextBlockUuid
}

export type Controller = {
  uuid: string
  alias?: string
  functionName: string
  type: 'controller'
  inputs: Record<string, unknown>
  nodes: ControllerNode[]
}

export type OrchestrationBlock = StarterBlock | Block | ExecuteFragmentBlock | Controller
export type ResponseConfig = Record<string, unknown> | null

const nextBlockSchema = z.string().min(1, 'nextBlock 不能为空字符串。').nullable()
const responseConfigSchema: z.ZodType<ResponseConfig, z.ZodTypeDef, unknown> = z.record(z.unknown()).nullable()

const starterBlockSchema: z.ZodType<StarterBlock, z.ZodTypeDef, unknown> = z.object({
  uuid: z.literal('starter'),
  nextBlock: nextBlockSchema,
}).strict()

const standardBlockSchema: z.ZodType<Block, z.ZodTypeDef, unknown> = z.object({
  uuid: z.string().min(1, 'Block UUID 不能为空。'),
  alias: z.string().optional(),
  functionName: z.string().min(1, 'Block functionName 不能为空。'),
  type: z.string().optional(),
  inputs: z.record(z.unknown()).optional().default({}),
  outputs: z.array(processableKeySchema).nullable().optional(),
  nextBlock: nextBlockSchema,
  errorNextBlock: nextBlockSchema.optional(),
}).strict().refine((value) => value.type !== 'controller', {
  message: 'Controller 必须配置 nodes。',
}).refine((value) => value.uuid !== 'starter', {
  message: 'starter 只能作为 Starter Block。',
}).refine((value) => value.functionName !== 'executeFragment', {
  message: 'executeFragment 必须使用固定的 inputs 与 outputs 配置。',
})

const executeFragmentBlockSchema: z.ZodType<ExecuteFragmentBlock, z.ZodTypeDef, unknown> = z.object({
  uuid: z.string().min(1, 'Block UUID 不能为空。'),
  alias: z.string().optional(),
  functionName: z.literal('executeFragment'),
  type: z.string().optional().refine((value) => value !== 'controller', {
    message: 'ExecuteFragment 不能是 Controller。',
  }),
  inputs: z.object({
    fragmentUuid: z.string().regex(apiJsonUuidPattern, 'fragmentUuid 必须是合法的字面量 UUID。'),
    params: z.record(z.unknown()),
  }).strict(),
  outputs: z.tuple([z.literal('result')]),
  nextBlock: nextBlockSchema,
  errorNextBlock: nextBlockSchema.optional(),
}).strict().refine((value) => value.uuid !== 'starter', {
  message: 'starter 只能作为 Starter Block。',
})

export const controllerNodeSchema: z.ZodType<ControllerNode, z.ZodTypeDef, unknown> = z.object({
  uuid: z.string().min(1, 'Node UUID 不能为空。'),
  alias: z.string().optional(),
  type: z.literal('DEFAULT').optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  nextBlock: nextBlockSchema,
}).strict()

export const controllerSchema: z.ZodType<Controller, z.ZodTypeDef, unknown> = z.object({
  uuid: z.string().min(1, 'Controller UUID 不能为空。'),
  alias: z.string().optional(),
  functionName: z.string().min(1, 'Controller functionName 不能为空。'),
  type: z.literal('controller'),
  inputs: z.record(z.unknown()).optional().default({}),
  nodes: z.array(controllerNodeSchema).min(1, 'Controller nodes 不能为空。'),
}).strict().refine((value) => value.functionName !== 'executeFragment', {
  message: 'executeFragment 不能配置为 Controller。',
})

export const blockSchema: z.ZodType<OrchestrationBlock, z.ZodTypeDef, unknown> = z.lazy(() => z.union([
  starterBlockSchema,
  controllerSchema,
  executeFragmentBlockSchema,
  standardBlockSchema,
]))

const commonApiJsonShape = {
  uuid: z.string().min(1, 'API JSON UUID 不能为空。'),
  alias: z.string().optional(),
  blocks: z.array(blockSchema).default([]),
  response: responseConfigSchema.optional(),
  responses: z.record(responseConfigSchema).optional(),
}

const endpointApiJsonSchema = z.object({
  ...commonApiJsonShape,
  fragment: z.literal(false).optional().default(false),
  method: z.string().min(1, 'method 不能为空。').transform((method) => method.toUpperCase()),
  request: requestSchema.optional().default({ header: [], query: [], body: [] }),
}).strict()

const fragmentResponseConfigSchema = z.record(z.unknown())

const fragmentApiJsonSchema = z.object({
  ...commonApiJsonShape,
  fragment: z.literal(true),
  params: z.array(processableKeySchema).optional().default([]),
  response: fragmentResponseConfigSchema.optional(),
  responses: z.record(fragmentResponseConfigSchema).optional(),
}).strict()

const apiJsonSchema = z.union([fragmentApiJsonSchema, endpointApiJsonSchema])

export type EndpointApiJson = z.infer<typeof endpointApiJsonSchema>
export type FragmentApiJson = z.infer<typeof fragmentApiJsonSchema>
export type ApiJson = EndpointApiJson | FragmentApiJson

export type RequestContext = {
  header: Record<string, string>
  query: Record<string, unknown>
  body: Record<string, unknown>
}

type BaseBlockExecutionContext = {
  now: string
  blocks: Record<string, {
    inputs: Record<string, unknown>
    outputs: Record<string, unknown>
  }>
}

export type EndpointBlockExecutionContext = BaseBlockExecutionContext & {
  request: RequestContext
  header: Record<string, string>
  query: Record<string, unknown>
  body: Record<string, unknown>
}

export type FragmentBlockExecutionContext = BaseBlockExecutionContext & {
  params: Record<string, unknown>
}

export type BlockExecutionContext = EndpointBlockExecutionContext | FragmentBlockExecutionContext

export type MokelayDebugError = {
  code: string
  message: string
}

export type MokelayDebugBlockStep = {
  uuid: string
  type: 'block'
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  nextBlock: MokelayDebugStep | null
  error?: MokelayDebugError
  fragment?: MokelayDebugResponse
}

export type MokelayDebugControllerNode = {
  uuid: string
  nextBlock: MokelayDebugStep | null
}

export type MokelayDebugControllerStep = {
  uuid: string
  type: 'controller'
  inputs: Record<string, unknown>
  node?: MokelayDebugControllerNode
  error?: MokelayDebugError
}

export type MokelayDebugStep = MokelayDebugBlockStep | MokelayDebugControllerStep

export type MokelayDebugResponse = {
  uuid: 'starter'
  nextBlock: MokelayDebugStep | null
}

export type SqlExecutor = <T extends Record<string, unknown> = Record<string, unknown>>(
  query: SQL,
) => Promise<SqlExecutionResult<T>>

export type DatasourceSqlExecutor = <T extends Record<string, unknown> = Record<string, unknown>>(
  query: SQL,
  datasource: string,
  databaseType: DatabaseType,
) => Promise<SqlExecutionResult<T>>

export type DatasourceTransactionRunner = <T>(
  datasource: string,
  callback: (executeSql: SqlExecutor) => Promise<T>,
  options?: TransactionOptions,
) => Promise<T>

export type FragmentInvocation = {
  fragmentUuid: string
  params: Record<string, unknown>
}

export type FragmentInvoker = (input: FragmentInvocation) => Promise<Record<string, unknown>>

export type ProcessValue = (
  value: unknown,
  processors: ProcessorConfig[],
  label: string,
) => Promise<unknown>

export type BlockExecutorInput = {
  event: H3Event
  block: Block
  inputs: Record<string, unknown>
  executeSql: SqlExecutor
  databaseType?: DatabaseType
  /** Available for datasource-backed blocks; all statements use one connection. */
  withTransaction?: TransactionRunner
  /** Runs a value through the orchestration Processor pipeline in the current template context. */
  processValue: ProcessValue
  /** Reserved for the built-in executeFragment Block; other Blocks are rejected at runtime. */
  invokeFragment: FragmentInvoker
}

export type BlockExecutor = (input: BlockExecutorInput) => Promise<Record<string, unknown>>

export type BlockDefinition = {
  executor: BlockExecutor
  allowedOutputs: readonly string[]
  requiresDatasource?: boolean
}

export type ApiJsonSource = 'system' | 'user'

export type OrchestrationHandlerOptions = {
  loadApiJson?: (apiJsonUuid: string) => Promise<unknown>
  /**
   * Ownership domain for raw DSL passed directly to executeApiJson. The default
   * handler detects this automatically and custom loaders remain self-contained.
   */
  apiJsonSource?: ApiJsonSource
  executeSql?: DatasourceSqlExecutor
  executeTransaction?: DatasourceTransactionRunner
  blockDefinitions?: Readonly<Record<string, BlockDefinition>>
}

export type MokelaySuccessResponse = {
  ok: true
  data: unknown
  debug?: MokelayDebugResponse
}

export function assertApiJsonUuid(value: string | undefined) {
  if (!value || !apiJsonUuidPattern.test(value)) {
    throw mokelayError('API_JSON_UUID_INVALID', 'API_JSON_UUID 无效或不能为空。', 400)
  }

  return value
}

export function parseApiJson(apiJsonUuid: string, value: unknown): ApiJson {
  const parsed = apiJsonSchema.safeParse(value)

  if (!parsed.success) {
    throw mokelayError(
      'API_JSON_INVALID_SCHEMA',
      `API JSON ${apiJsonUuid} 不符合规范：${parsed.error.issues[0]?.message || '输入内容无效。'}`,
      400,
    )
  }

  if (parsed.data.uuid !== apiJsonUuid) {
    throw mokelayError('API_JSON_UUID_MISMATCH', 'API JSON UUID 与请求路径不一致。', 400)
  }

  assertUniqueDslUuids(parsed.data)
  assertUniqueDeclarations(parsed.data)
  assertApiJsonFlow(parsed.data)
  assertApiJsonResponses(parsed.data)
  assertFragmentConfiguration(parsed.data)
  assertFragmentTemplateScope(parsed.data)

  return parsed.data
}

export function isFragmentApiJson(apiJson: ApiJson): apiJson is FragmentApiJson {
  return apiJson.fragment === true
}

function isControllerBlock(block: OrchestrationBlock): block is Controller {
  return 'type' in block && block.type === 'controller' && 'nodes' in block
}

function assertUniqueDslUuids(apiJson: ApiJson) {
  const seen = new Set<string>()

  function visitUuid(uuid: string) {
    if (seen.has(uuid)) {
      throw mokelayError('API_JSON_DUPLICATE_UUID', `API JSON 中存在重复 UUID：${uuid}`, 400)
    }

    seen.add(uuid)
  }

  for (const block of apiJson.blocks) {
    visitUuid(block.uuid)

    if (!isControllerBlock(block)) {
      continue
    }

    for (const node of block.nodes) {
      visitUuid(node.uuid)
    }
  }
}

function assertUniqueDeclarations(apiJson: ApiJson) {
  const declarationGroups = apiJson.fragment
    ? [{ name: 'params', declarations: apiJson.params }]
    : [
        { name: 'request.header', declarations: apiJson.request.header },
        { name: 'request.query', declarations: apiJson.request.query },
        { name: 'request.body', declarations: apiJson.request.body },
      ]

  for (const group of declarationGroups) {
    const seen = new Set<string>()

    for (const declaration of group.declarations) {
      const key = typeof declaration === 'string' ? declaration : declaration.key

      if (seen.has(key)) {
        throw mokelayError(
          'API_JSON_INVALID_SCHEMA',
          `${group.name} 中存在重复参数：${key}`,
          400,
        )
      }

      seen.add(key)
    }
  }
}

function assertApiJsonFlow(apiJson: ApiJson) {
  const starters = apiJson.blocks.filter((block): block is StarterBlock => block.uuid === 'starter')

  if (starters.length !== 1) {
    throw mokelayError('API_JSON_INVALID_FLOW', 'API JSON 必须且只能配置一个 uuid 为 starter 的 Starter Block。', 400)
  }

  const executableBlockUuids = new Set<string>()
  const nodeUuids = new Set<string>()

  for (const block of apiJson.blocks) {
    if (block.uuid !== 'starter') {
      executableBlockUuids.add(block.uuid)
    }

    if (!isControllerBlock(block)) {
      continue
    }

    for (const node of block.nodes) {
      nodeUuids.add(node.uuid)
    }
  }

  function validateNextBlock(
    sourceUuid: string,
    nextBlock: NextBlockUuid,
    edgeName: 'nextBlock' | 'errorNextBlock' = 'nextBlock',
  ) {
    const edgePath = `${sourceUuid}.${edgeName}`

    if (nextBlock === null) {
      return
    }

    if (nextBlock === 'starter') {
      throw mokelayError('API_JSON_INVALID_FLOW', `${edgePath} 不能指向 starter。`, 400)
    }

    if (nodeUuids.has(nextBlock)) {
      throw mokelayError('API_JSON_INVALID_FLOW', `${edgePath} 不能指向 Controller node：${nextBlock}`, 400)
    }

    if (!executableBlockUuids.has(nextBlock)) {
      throw mokelayError('API_JSON_INVALID_FLOW', `${edgePath} 指向不存在的 block：${nextBlock}`, 400)
    }
  }

  for (const block of apiJson.blocks) {
    if (isControllerBlock(block)) {
      for (const node of block.nodes) {
        validateNextBlock(node.uuid, node.nextBlock)
      }

      continue
    }

    validateNextBlock(block.uuid, block.nextBlock)

    if ('errorNextBlock' in block && block.errorNextBlock !== undefined) {
      validateNextBlock(block.uuid, block.errorNextBlock, 'errorNextBlock')
    }
  }
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function collectTerminalUuids(apiJson: ApiJson) {
  const terminalUuids = new Set<string>()

  for (const block of apiJson.blocks) {
    if (isControllerBlock(block)) {
      for (const node of block.nodes) {
        if (node.nextBlock === null) {
          terminalUuids.add(node.uuid)
        }
      }

      continue
    }

    if (block.nextBlock === null || (
      'errorNextBlock' in block
      && block.errorNextBlock === null
    )) {
      terminalUuids.add(block.uuid)
    }
  }

  return terminalUuids
}

function assertApiJsonResponses(apiJson: ApiJson) {
  if (!apiJson.responses) {
    return
  }

  const terminalUuids = collectTerminalUuids(apiJson)
  const responseUuids = new Set(Object.keys(apiJson.responses))

  for (const responseUuid of responseUuids) {
    if (!terminalUuids.has(responseUuid)) {
      throw mokelayError(
        'API_JSON_INVALID_RESPONSE',
        `responses.${responseUuid} 必须对应一个 nextBlock 为 null 的终点。`,
        400,
      )
    }
  }

  if (hasOwn(apiJson, 'response')) {
    return
  }

  for (const terminalUuid of terminalUuids) {
    if (!responseUuids.has(terminalUuid)) {
      throw mokelayError(
        'API_JSON_INVALID_RESPONSE',
        `responses 缺少终点 ${terminalUuid} 的响应配置。`,
        400,
      )
    }
  }
}

function responseKeys(response: Record<string, unknown>) {
  return Object.keys(response).sort()
}

function sameKeys(left: string[], right: string[]) {
  return left.length === right.length && left.every((key, index) => key === right[index])
}

function assertFragmentConfiguration(apiJson: ApiJson) {
  if (!apiJson.fragment) {
    return
  }

  const executeFragmentBlock = apiJson.blocks.find((block) => (
    'functionName' in block && block.functionName === 'executeFragment'
  ))

  if (executeFragmentBlock) {
    throw mokelayError(
      'FRAGMENT_NESTING_FORBIDDEN',
      `Fragment ${apiJson.uuid} 不允许调用 Fragment。`,
      400,
    )
  }

  const responses = [
    ...(apiJson.response ? [apiJson.response] : []),
    ...Object.values(apiJson.responses ?? {}),
  ]

  if (responses.length === 0) {
    throw mokelayError('API_JSON_INVALID_RESPONSE', 'Fragment 必须配置 response 或 responses。', 400)
  }

  const expectedKeys = responseKeys(responses[0])

  if (expectedKeys.length === 0) {
    throw mokelayError('API_JSON_INVALID_RESPONSE', 'Fragment result 不能为空对象。', 400)
  }

  for (const response of responses) {
    if (Object.prototype.hasOwnProperty.call(response, 'redirect')) {
      throw mokelayError('API_JSON_INVALID_RESPONSE', 'Fragment result 不允许配置 redirect。', 400)
    }

    if (!sameKeys(expectedKeys, responseKeys(response))) {
      throw mokelayError('API_JSON_INVALID_RESPONSE', 'Fragment 的所有终点必须返回相同的顶层字段。', 400)
    }
  }
}

function visitTemplateExpressions(value: unknown, visit: (expression: string) => void) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
      visit(match[1]?.trim() ?? '')
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      visitTemplateExpressions(item, visit)
    }
    return
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      visitTemplateExpressions(item, visit)
    }
  }
}

function fragmentParamFromExpression(expression: string) {
  if (expression === 'params') {
    return undefined
  }

  const match = /^params(?:\.([A-Za-z_$][A-Za-z0-9_$]*)|\[['"]([^'"\]]+)['"]\])/.exec(expression)

  return match?.[1] ?? match?.[2] ?? null
}

function assertFragmentTemplateScope(apiJson: ApiJson) {
  if (!apiJson.fragment) {
    return
  }

  const declaredParams = new Set(apiJson.params.map((declaration) => (
    typeof declaration === 'string' ? declaration : declaration.key
  )))
  const sources: unknown[] = [apiJson.params, apiJson.response, apiJson.responses]

  for (const block of apiJson.blocks) {
    if ('inputs' in block) {
      sources.push(block.inputs)
    }
    if ('outputs' in block) {
      sources.push(block.outputs)
    }
  }

  for (const source of sources) {
    visitTemplateExpressions(source, (expression) => {
      const root = /^([A-Za-z_$][A-Za-z0-9_$]*)(?:\.|\[|$)/.exec(expression)?.[1]

      if (root === 'blocks' || expression === 'now') {
        return
      }

      if (root === 'params') {
        const param = fragmentParamFromExpression(expression)

        if (param === undefined) {
          return
        }

        if (param && declaredParams.has(param)) {
          return
        }

        throw mokelayError(
          'API_JSON_INVALID_SCHEMA',
          `Fragment 模板引用了未声明参数：${expression}`,
          400,
        )
      }

      throw mokelayError(
        'API_JSON_INVALID_SCHEMA',
        `Fragment 模板只能引用 params、blocks 或 now：${expression}`,
        400,
      )
    })
  }
}
