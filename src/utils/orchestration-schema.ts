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

type LeafCondition = {
  group: false
  fieldName: string
  fieldValue?: unknown
  conditionType: z.infer<typeof conditionTypeSchema>
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

export const blockSchema = z.object({
  uuid: z.string().min(1, 'Block UUID 不能为空。'),
  alias: z.string().optional(),
  functionName: z.string().min(1, 'Block functionName 不能为空。'),
  inputs: z.record(z.unknown()).optional().default({}),
  outputs: z.array(processableKeySchema).nullable().optional(),
}).strict()

const apiJsonSchema = z.object({
  uuid: z.string().min(1, 'API JSON UUID 不能为空。'),
  alias: z.string().optional(),
  method: z.string().min(1, 'method 不能为空。').transform((method) => method.toUpperCase()),
  request: requestSchema.optional().default({ header: [], query: [], body: [] }),
  blocks: z.array(blockSchema).default([]),
  response: z.record(z.unknown()).nullable().optional(),
}).strict()

export type ApiJson = z.infer<typeof apiJsonSchema>
export type Block = z.infer<typeof blockSchema>

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

export type OrchestrationHandlerOptions = {
  loadApiJson?: (apiJsonUuid: string) => Promise<unknown>
  executeSql?: DatasourceSqlExecutor
}

export type MokelaySuccessResponse = {
  ok: true
  data: unknown
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

  return parsed.data
}
