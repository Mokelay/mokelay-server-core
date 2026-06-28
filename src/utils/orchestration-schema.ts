import { type SQL } from 'drizzle-orm'
import { type H3Event } from 'h3'
import { z } from 'zod'
import { type DatabaseType, type SqlExecutionResult } from './db.js'
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

const conditionTypeSchema = z.enum(['GE', 'GT', 'LE', 'LT', 'NEQ', 'EQ', 'NOTIN', 'IN'])
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

export type OrchestrationBlock = StarterBlock | Block | Controller
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
}).strict().refine((value) => value.type !== 'controller', {
  message: 'Controller 必须配置 nodes。',
}).refine((value) => value.uuid !== 'starter', {
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
}).strict()

export const blockSchema: z.ZodType<OrchestrationBlock, z.ZodTypeDef, unknown> = z.lazy(() => z.union([
  starterBlockSchema,
  controllerSchema,
  standardBlockSchema,
]))

const apiJsonSchema = z.object({
  uuid: z.string().min(1, 'API JSON UUID 不能为空。'),
  alias: z.string().optional(),
  method: z.string().min(1, 'method 不能为空。').transform((method) => method.toUpperCase()),
  request: requestSchema.optional().default({ header: [], query: [], body: [] }),
  blocks: z.array(blockSchema).default([]),
  response: responseConfigSchema.optional(),
  responses: z.record(responseConfigSchema).optional(),
}).strict()

export type ApiJson = z.infer<typeof apiJsonSchema>

export type RequestContext = {
  header: Record<string, string>
  query: Record<string, unknown>
  body: Record<string, unknown>
}

export type BlockExecutionContext = {
  request: RequestContext
  header: Record<string, string>
  query: Record<string, unknown>
  body: Record<string, unknown>
  now: string
  blocks: Record<string, {
    inputs: Record<string, unknown>
    outputs: Record<string, unknown>
  }>
}

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

export type BlockExecutorInput = {
  event: H3Event
  block: Block
  inputs: Record<string, unknown>
  executeSql: SqlExecutor
  databaseType?: DatabaseType
}

export type BlockExecutor = (input: BlockExecutorInput) => Promise<Record<string, unknown>>

export type BlockDefinition = {
  executor: BlockExecutor
  allowedOutputs: readonly string[]
  requiresDatasource?: boolean
}

export type OrchestrationHandlerOptions = {
  loadApiJson?: (apiJsonUuid: string) => Promise<unknown>
  executeSql?: DatasourceSqlExecutor
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
  assertApiJsonFlow(parsed.data)
  assertApiJsonResponses(parsed.data)

  return parsed.data
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

  function validateNextBlock(sourceUuid: string, nextBlock: NextBlockUuid) {
    if (nextBlock === null) {
      return
    }

    if (nextBlock === 'starter') {
      throw mokelayError('API_JSON_INVALID_FLOW', `${sourceUuid}.nextBlock 不能指向 starter。`, 400)
    }

    if (nodeUuids.has(nextBlock)) {
      throw mokelayError('API_JSON_INVALID_FLOW', `${sourceUuid}.nextBlock 不能指向 Controller node：${nextBlock}`, 400)
    }

    if (!executableBlockUuids.has(nextBlock)) {
      throw mokelayError('API_JSON_INVALID_FLOW', `${sourceUuid}.nextBlock 指向不存在的 block：${nextBlock}`, 400)
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

    if (block.nextBlock === null) {
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
