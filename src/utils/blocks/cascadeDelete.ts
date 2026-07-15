import { sql, type SQL } from 'drizzle-orm'
import { mokelayError } from '../mokelay-error.js'
import {
  processableKeySchema,
  type BlockExecutor,
  type OrchestrationCondition,
  type ProcessorConfig,
  type SqlExecutor,
} from '../orchestration-schema.js'
import {
  buildWhereSql,
  getConditions,
  identifierSql,
  isRecord,
  requireDatabaseType,
} from './shared.js'

const maxNodes = 32
const maxDepth = 8
const maxCollects = 16
const maxFieldsPerCollect = 32
const maxConditionDepth = 8
const maxConditionLeaves = 100
const selectBatchSize = 500
const deleteBatchSize = 500

const hardLimits = {
  maxRootRows: 10_000,
  maxAffectedRows: 1_000_000,
  maxCollectedRows: 100_000,
} as const

const defaultLimits = {
  maxRootRows: 1,
  maxAffectedRows: 100_000,
  maxCollectedRows: 10_000,
} as const

const configKeyPattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

type CascadeLimits = {
  maxRootRows: number
  maxAffectedRows: number
  maxCollectedRows: number
}

type CascadeNode = {
  id: string
  table: string
  keyField: string
  conditions: OrchestrationCondition[]
  where?: SQL
  parent?: string
  foreignKey?: string
  depth: number
}

type CollectField = {
  key: string
  processors: ProcessorConfig[]
}

type CollectOrder = {
  fieldName: string
  direction: 'ASC' | 'DESC'
}

type CollectConfig = {
  key: string
  node: string
  mode: 'values' | 'rows'
  fields: CollectField[]
  distinct: boolean
  orderBy: CollectOrder[]
}

type CascadeConfiguration = {
  root: CascadeNode
  nodes: CascadeNode[]
  collect: CollectConfig[]
  limits: CascadeLimits
}

type SelectedRow = {
  key: unknown
  values: Record<string, unknown>
}

type NodeSelection = {
  node: CascadeNode
  rows: SelectedRow[]
}

type SelectField = {
  fieldName: string
  alias: string
}

function invalidCascade(message: string): never {
  throw mokelayError('BLOCK_INVALID_CASCADE', message, 400)
}

function cascadeLimitExceeded(message: string): never {
  throw mokelayError('BLOCK_CASCADE_LIMIT_EXCEEDED', message, 400)
}

function normalizeConfigKey(value: unknown, label: string) {
  if (typeof value !== 'string' || !configKeyPattern.test(value.trim())) {
    invalidCascade(`${label} 必须以字母或下划线开头，只能包含字母、数字、下划线，长度不超过 64。`)
  }

  return value.trim()
}

function normalizeSqlName(value: unknown, label: string, allowQualified: boolean) {
  if (typeof value !== 'string' || !value.trim()) {
    invalidCascade(`${label} 必须是非空字符串。`)
  }

  const normalized = value.trim()

  if (!allowQualified && normalized.includes('.')) {
    invalidCascade(`${label} 必须是单字段 SQL 标识符。`)
  }

  // Build once during validation so malformed identifier paths fail before the transaction starts.
  identifierSql(normalized, label, 'BLOCK_INVALID_CASCADE')
  return normalized
}

function normalizeLimit(
  value: unknown,
  name: keyof CascadeLimits,
  defaultValue: number,
  hardLimit: number,
) {
  const actual = value === undefined ? defaultValue : Number(value)

  if (!Number.isSafeInteger(actual) || actual < 0 || actual > hardLimit) {
    cascadeLimitExceeded(`limits.${name} 必须是 0 到 ${hardLimit} 之间的安全整数。`)
  }

  return actual
}

function normalizeLimits(value: unknown): CascadeLimits {
  if (value !== undefined && !isRecord(value)) {
    invalidCascade('limits 必须是对象。')
  }

  const limits = value as Record<string, unknown> | undefined

  return {
    maxRootRows: normalizeLimit(
      limits?.maxRootRows,
      'maxRootRows',
      defaultLimits.maxRootRows,
      hardLimits.maxRootRows,
    ),
    maxAffectedRows: normalizeLimit(
      limits?.maxAffectedRows,
      'maxAffectedRows',
      defaultLimits.maxAffectedRows,
      hardLimits.maxAffectedRows,
    ),
    maxCollectedRows: normalizeLimit(
      limits?.maxCollectedRows,
      'maxCollectedRows',
      defaultLimits.maxCollectedRows,
      hardLimits.maxCollectedRows,
    ),
  }
}

function validateConditionComplexity(conditions: OrchestrationCondition[], label: string) {
  let leaves = 0

  const visit = (condition: OrchestrationCondition, depth: number) => {
    if (depth > maxConditionDepth) {
      invalidCascade(`${label} 条件嵌套深度不能超过 ${maxConditionDepth}。`)
    }

    if (!condition.group) {
      leaves += 1
      if (leaves > maxConditionLeaves) {
        invalidCascade(`${label} 条件叶子数量不能超过 ${maxConditionLeaves}。`)
      }
      return
    }

    for (const child of condition.groups) visit(child, depth + 1)
  }

  for (const condition of conditions) visit(condition, 1)
}

function normalizeRoot(value: unknown): CascadeNode {
  if (!isRecord(value)) {
    invalidCascade('root 必须是对象。')
  }

  const conditions = getConditions(value.conditions)
  validateConditionComplexity(conditions, 'root.conditions')
  const where = buildWhereSql(conditions)

  if (!where) {
    throw mokelayError(
      'BLOCK_CASCADE_UNSCOPED',
      'root.conditions 必须至少生成一个有效 WHERE 条件，不能执行无条件级联删除。',
      400,
    )
  }

  return {
    id: normalizeConfigKey(value.id, 'root.id'),
    table: normalizeSqlName(value.table, 'root.table', true),
    keyField: normalizeSqlName(value.keyField, 'root.keyField', false),
    conditions,
    where,
    depth: 1,
  }
}

function normalizeRelations(value: unknown) {
  if (value === undefined) return []

  if (!Array.isArray(value)) {
    invalidCascade('relations 必须是数组。')
  }

  return value.map((item, index): CascadeNode => {
    if (!isRecord(item)) {
      invalidCascade(`relations[${index}] 必须是对象。`)
    }

    const conditions = getConditions(item.conditions)
    validateConditionComplexity(conditions, `relations[${index}].conditions`)

    return {
      id: normalizeConfigKey(item.id, `relations[${index}].id`),
      table: normalizeSqlName(item.table, `relations[${index}].table`, true),
      keyField: normalizeSqlName(item.keyField, `relations[${index}].keyField`, false),
      parent: normalizeConfigKey(item.parent, `relations[${index}].parent`),
      foreignKey: normalizeSqlName(item.foreignKey, `relations[${index}].foreignKey`, false),
      conditions,
      where: buildWhereSql(conditions),
      depth: 0,
    }
  })
}

function normalizeCollectFields(value: unknown, collectIndex: number) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxFieldsPerCollect) {
    invalidCascade(
      `collect[${collectIndex}].fields 必须包含 1 到 ${maxFieldsPerCollect} 个字段。`,
    )
  }

  const seen = new Set<string>()

  return value.map((item, fieldIndex): CollectField => {
    const parsedField = processableKeySchema.safeParse(item)
    if (!parsedField.success) {
      invalidCascade(
        `collect[${collectIndex}].fields[${fieldIndex}] 不符合 ProcessableKey 规范：${parsedField.error.issues[0]?.message || '输入内容无效。'}`,
      )
    }

    const key = normalizeSqlName(
      typeof parsedField.data === 'string' ? parsedField.data : parsedField.data.key,
      `collect[${collectIndex}].fields[${fieldIndex}]`,
      false,
    )

    if (seen.has(key)) {
      invalidCascade(`collect[${collectIndex}].fields 存在重复字段：${key}。`)
    }
    seen.add(key)

    return {
      key,
      processors: typeof parsedField.data === 'string' ? [] : parsedField.data.processors,
    }
  })
}

function normalizeCollectOrder(value: unknown, collectIndex: number) {
  if (value === undefined) return []

  if (!Array.isArray(value)) {
    invalidCascade(`collect[${collectIndex}].orderBy 必须是数组。`)
  }

  return value.map((item, orderIndex): CollectOrder => {
    if (!isRecord(item)) {
      invalidCascade(`collect[${collectIndex}].orderBy[${orderIndex}] 必须是对象。`)
    }

    const fieldName = normalizeSqlName(
      item.fieldName,
      `collect[${collectIndex}].orderBy[${orderIndex}].fieldName`,
      false,
    )
    if (item.direction !== undefined && typeof item.direction !== 'string') {
      invalidCascade(`collect[${collectIndex}].orderBy[${orderIndex}].direction 只能是 ASC 或 DESC。`)
    }

    const direction = typeof item.direction === 'string'
      ? item.direction.toUpperCase()
      : 'ASC'

    if (direction !== 'ASC' && direction !== 'DESC') {
      invalidCascade(`collect[${collectIndex}].orderBy[${orderIndex}].direction 只能是 ASC 或 DESC。`)
    }

    return { fieldName, direction }
  })
}

function tableIdentifierParts(table: string) {
  return table.split('.').map(part => part.trim().toLowerCase())
}

function tablesMayResolveToSameTable(left: string, right: string) {
  const leftParts = tableIdentifierParts(left)
  const rightParts = tableIdentifierParts(right)

  if (leftParts.join('.') === rightParts.join('.')) return true

  // An unqualified name is resolved through the connection's current schema/database.
  // Treat it as conflicting with any qualified form sharing the same final identifier,
  // because the runtime cannot prove those names refer to different physical tables.
  return (leftParts.length === 1 || rightParts.length === 1)
    && leftParts.at(-1) === rightParts.at(-1)
}

function normalizeCollect(value: unknown): CollectConfig[] {
  if (value === undefined) return []

  if (!Array.isArray(value) || value.length > maxCollects) {
    invalidCascade(`collect 必须是数组，且最多包含 ${maxCollects} 项。`)
  }

  const seen = new Set<string>()

  return value.map((item, index): CollectConfig => {
    if (!isRecord(item)) {
      invalidCascade(`collect[${index}] 必须是对象。`)
    }

    const key = normalizeConfigKey(item.key, `collect[${index}].key`)
    if (seen.has(key)) {
      invalidCascade(`collect 存在重复 key：${key}。`)
    }
    seen.add(key)

    if (item.mode !== 'values' && item.mode !== 'rows') {
      invalidCascade(`collect[${index}].mode 只能是 values 或 rows。`)
    }

    if (item.distinct !== undefined && typeof item.distinct !== 'boolean') {
      invalidCascade(`collect[${index}].distinct 必须是 boolean。`)
    }

    const fields = normalizeCollectFields(item.fields, index)
    if (item.mode === 'values' && fields.length !== 1) {
      invalidCascade(`collect[${index}].mode=values 时 fields 必须恰好包含一个字段。`)
    }

    return {
      key,
      node: normalizeConfigKey(item.node, `collect[${index}].node`),
      mode: item.mode,
      fields,
      distinct: item.distinct ?? false,
      orderBy: normalizeCollectOrder(item.orderBy, index),
    }
  })
}

function orderNodes(root: CascadeNode, relations: CascadeNode[]) {
  if (relations.length + 1 > maxNodes) {
    invalidCascade(`root 与 relations 合计最多允许 ${maxNodes} 个节点。`)
  }

  const ids = new Set([root.id])
  const tables = [root.table]

  for (const relation of relations) {
    if (ids.has(relation.id)) {
      invalidCascade(`级联节点 id 不能重复：${relation.id}。`)
    }
    ids.add(relation.id)

    if (tables.some(table => tablesMayResolveToSameTable(table, relation.table))) {
      invalidCascade(`V1 不支持多个节点使用同一张表：${relation.table}。`)
    }
    tables.push(relation.table)
  }

  for (const relation of relations) {
    if (!relation.parent || !ids.has(relation.parent)) {
      invalidCascade(`节点 ${relation.id} 引用了不存在的 parent：${relation.parent ?? ''}。`)
    }
    if (relation.parent === relation.id) {
      invalidCascade(`节点 ${relation.id} 不能引用自身作为 parent。`)
    }
  }

  const ordered = [root]
  const depths = new Map([[root.id, root.depth]])
  const remaining = [...relations]

  while (remaining.length > 0) {
    let progressed = false

    for (let index = 0; index < remaining.length;) {
      const relation = remaining[index]!
      const parentDepth = depths.get(relation.parent!)

      if (parentDepth === undefined) {
        index += 1
        continue
      }

      relation.depth = parentDepth + 1
      if (relation.depth > maxDepth) {
        invalidCascade(`级联关系最大深度不能超过 ${maxDepth}。`)
      }

      ordered.push(relation)
      depths.set(relation.id, relation.depth)
      remaining.splice(index, 1)
      progressed = true
    }

    if (!progressed) {
      invalidCascade('relations 中存在环，所有节点必须形成从 root 出发的关系树。')
    }
  }

  return ordered
}

function normalizeConfiguration(inputs: Record<string, unknown>): CascadeConfiguration {
  const root = normalizeRoot(inputs.root)
  const nodes = orderNodes(root, normalizeRelations(inputs.relations))
  const collect = normalizeCollect(inputs.collect)
  const nodeIds = new Set(nodes.map(node => node.id))

  for (const item of collect) {
    if (!nodeIds.has(item.node)) {
      invalidCascade(`collect.${item.key} 引用了不存在的节点：${item.node}。`)
    }
  }

  return {
    root,
    nodes,
    collect,
    limits: normalizeLimits(inputs.limits),
  }
}

function nodeSelectFields(nodeId: string, collect: CollectConfig[]) {
  const fieldNames = new Set<string>()

  for (const item of collect) {
    if (item.node !== nodeId) continue
    for (const field of item.fields) fieldNames.add(field.key)
    for (const order of item.orderBy) fieldNames.add(order.fieldName)
  }

  return Array.from(fieldNames).map((fieldName, index): SelectField => ({
    fieldName,
    alias: `__cascade_value_${index}`,
  }))
}

function selectColumns(node: CascadeNode, fields: SelectField[]) {
  return sql.join([
    sql`${identifierSql(node.keyField, `${node.id}.keyField`, 'BLOCK_INVALID_CASCADE')} AS ${sql.identifier('__cascade_key')}`,
    ...fields.map(field => sql`${identifierSql(field.fieldName, `${node.id}.collectField`, 'BLOCK_INVALID_CASCADE')} AS ${sql.identifier(field.alias)}`),
  ], sql`, `)
}

function rowKeyToken(value: unknown) {
  return `${typeof value}:${typeof value === 'bigint' ? value.toString() : String(value)}`
}

function normalizeSelectedRows(
  rows: Record<string, unknown>[],
  fields: SelectField[],
  node: CascadeNode,
  seen: Set<string>,
) {
  return rows.map((row): SelectedRow => {
    const key = row.__cascade_key

    if (
      key === null
      || key === undefined
      || (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'bigint')
    ) {
      invalidCascade(`节点 ${node.id} 的 keyField 必须返回非空字符串或数字。`)
    }

    const token = rowKeyToken(key)
    if (seen.has(token)) {
      invalidCascade(`节点 ${node.id} 的 keyField ${node.keyField} 必须唯一。`)
    }
    seen.add(token)

    return {
      key,
      values: Object.fromEntries(fields.map(field => [field.fieldName, row[field.alias]])),
    }
  })
}

function chunks<T>(values: T[], size: number) {
  const output: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size))
  }
  return output
}

function inValuesSql(values: unknown[]) {
  return sql.join(values.map(value => sql`${value}`), sql`, `)
}

async function selectRoot(
  executeSql: SqlExecutor,
  node: CascadeNode,
  fields: SelectField[],
  limits: CascadeLimits,
) {
  const detectionLimit = Math.min(limits.maxRootRows, limits.maxAffectedRows) + 1
  const table = identifierSql(node.table, `${node.id}.table`, 'BLOCK_INVALID_CASCADE')
  const result = await executeSql(sql`
    SELECT ${selectColumns(node, fields)}
    FROM ${table}
    WHERE ${node.where!}
    LIMIT ${detectionLimit}
    FOR UPDATE
  `)

  if (result.rows.length > limits.maxRootRows) {
    cascadeLimitExceeded(`root 匹配行数超过 limits.maxRootRows=${limits.maxRootRows}。`)
  }
  if (result.rows.length > limits.maxAffectedRows) {
    cascadeLimitExceeded(`级联匹配行数超过 limits.maxAffectedRows=${limits.maxAffectedRows}。`)
  }

  return normalizeSelectedRows(result.rows, fields, node, new Set())
}

async function selectRelation(
  executeSql: SqlExecutor,
  node: CascadeNode,
  fields: SelectField[],
  parentRows: SelectedRow[],
  currentAffected: number,
  limits: CascadeLimits,
) {
  if (parentRows.length === 0) return []

  const rows: SelectedRow[] = []
  const seen = new Set<string>()
  const table = identifierSql(node.table, `${node.id}.table`, 'BLOCK_INVALID_CASCADE')
  const foreignKey = identifierSql(node.foreignKey, `${node.id}.foreignKey`, 'BLOCK_INVALID_CASCADE')

  for (const parentBatch of chunks(parentRows.map(row => row.key), selectBatchSize)) {
    const remaining = Math.max(0, limits.maxAffectedRows - currentAffected - rows.length)
    const relationScope = sql`${foreignKey} IN (${inValuesSql(parentBatch)})`
    const where = node.where
      ? sql`${relationScope} AND (${node.where})`
      : relationScope
    const result = await executeSql(sql`
      SELECT ${selectColumns(node, fields)}
      FROM ${table}
      WHERE ${where}
      LIMIT ${remaining + 1}
      FOR UPDATE
    `)

    rows.push(...normalizeSelectedRows(result.rows, fields, node, seen))

    if (currentAffected + rows.length > limits.maxAffectedRows) {
      cascadeLimitExceeded(`级联匹配行数超过 limits.maxAffectedRows=${limits.maxAffectedRows}。`)
    }
  }

  return rows
}

function compareValues(left: unknown, right: unknown) {
  if (Object.is(left, right)) return 0
  if (left === null || left === undefined) return -1
  if (right === null || right === undefined) return 1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'bigint' && typeof right === 'bigint') return left < right ? -1 : 1
  return String(left).localeCompare(String(right))
}

function sortCollectedRows(rows: SelectedRow[], orderBy: CollectOrder[]) {
  if (orderBy.length === 0) return rows

  return [...rows].sort((left, right) => {
    for (const order of orderBy) {
      const comparison = compareValues(left.values[order.fieldName], right.values[order.fieldName])
      if (comparison !== 0) return order.direction === 'ASC' ? comparison : -comparison
    }
    return 0
  })
}

function distinctToken(value: unknown) {
  if (typeof value === 'bigint') return `bigint:${value.toString()}`
  if (value === undefined) return 'undefined'

  try {
    return `${typeof value}:${JSON.stringify(value, (_key, item) => (
      typeof item === 'bigint' ? { __mokelay_bigint: item.toString() } : item
    ))}`
  } catch {
    return `${typeof value}:${String(value)}`
  }
}

async function collectValues(
  selections: Map<string, NodeSelection>,
  collect: CollectConfig[],
  maxCollectedRows: number,
  processValue: Parameters<BlockExecutor>[0]['processValue'],
) {
  const candidateCount = collect.reduce(
    (total, item) => total + (selections.get(item.node)?.rows.length ?? 0),
    0,
  )

  if (candidateCount > maxCollectedRows) {
    cascadeLimitExceeded(`采集行数超过 limits.maxCollectedRows=${maxCollectedRows}。`)
  }

  const collected: Record<string, unknown[]> = {}

  for (const item of collect) {
    const rows = sortCollectedRows(selections.get(item.node)?.rows ?? [], item.orderBy)
    const values: unknown[] = []

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]!
      const processed: Record<string, unknown> = {}

      for (const field of item.fields) {
        processed[field.key] = await processValue(
          row.values[field.key],
          field.processors,
          `cascadeDelete.collect.${item.key}[${rowIndex}].${field.key}`,
        )
      }

      values.push(item.mode === 'values' ? processed[item.fields[0]!.key] : processed)
    }

    if (item.distinct) {
      const seen = new Set<string>()
      collected[item.key] = values.filter((value) => {
        const token = distinctToken(value)
        if (seen.has(token)) return false
        seen.add(token)
        return true
      })
    } else {
      collected[item.key] = values
    }
  }

  return collected
}

async function deleteRows(
  executeSql: SqlExecutor,
  node: CascadeNode,
  rows: SelectedRow[],
  databaseType: 'postgres' | 'mysql',
) {
  if (rows.length === 0) return 0

  const table = identifierSql(node.table, `${node.id}.table`, 'BLOCK_INVALID_CASCADE')
  const keyField = identifierSql(node.keyField, `${node.id}.keyField`, 'BLOCK_INVALID_CASCADE')
  let affected = 0

  for (const batch of chunks(rows.map(row => row.key), deleteBatchSize)) {
    const where = sql`${keyField} IN (${inValuesSql(batch)})`
    const result = databaseType === 'postgres'
      ? await executeSql(sql`DELETE FROM ${table} WHERE ${where} RETURNING 1 AS ${sql.identifier('affected_marker')}`)
      : await executeSql(sql`DELETE FROM ${table} WHERE ${where}`)

    affected += databaseType === 'postgres' ? result.rows.length : result.affectedRows ?? 0
  }

  if (affected !== rows.length) {
    invalidCascade(
      `节点 ${node.id} 锁定 ${rows.length} 行，但实际删除 ${affected} 行，事务已回滚。`,
    )
  }

  return affected
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "cascadeDelete",
 *   "displayName": "声明式级联删除",
 *   "category": "database",
 *   "description": "按 root 与 relations 描述的单数据源关系树锁定、采集并逆拓扑删除记录，所有 DELETE 位于同一个串行化事务。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "保存关系树中全部表的数据源。" },
 *     { "key": "root", "type": "CascadeRoot", "required": true, "description": "根节点 id/table/keyField/conditions；conditions 必须产生非空 WHERE。" },
 *     { "key": "relations", "type": "CascadeRelation[]", "required": false, "description": "子节点及其 parent/foreignKey 单字段关系。" },
 *     { "key": "collect", "type": "CascadeCollect[]", "required": false, "description": "删除前从指定节点采集字段。mode=values 要求一个 ProcessableKey 字段并返回值数组；mode=rows 支持 1 到 32 个字段并返回对象数组。可配置 processors、去重和排序。maxCollectedRows 按所有 collect 的候选行数之和、在 distinct 前计数。" },
 *     { "key": "limits", "type": "CascadeLimits", "required": false, "description": "根记录、总影响记录和总采集记录安全上限。" }
 *   ],
 *   "outputs": [
 *     { "key": "affected", "type": "number", "description": "根节点删除行数。" },
 *     { "key": "affectedByNode", "type": "Record<string, number>", "description": "按节点 id 返回删除行数。" },
 *     { "key": "totalAffected", "type": "number", "description": "全部节点删除行数之和。" },
 *     { "key": "collected", "type": "Record<string, unknown[]>", "description": "按 collect.key 返回删除前采集并处理后的值。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_INVALID_CASCADE", "description": "关系图、节点、采集或删除一致性无效。" },
 *     { "code": "BLOCK_CASCADE_UNSCOPED", "description": "root.conditions 没有产生 WHERE。" },
 *     { "code": "BLOCK_CASCADE_LIMIT_EXCEEDED", "description": "配置或运行行数超过安全上限。" },
 *     { "code": "BLOCK_SQL_UNSUPPORTED", "description": "执行器未提供数据源事务运行器。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "全部表必须属于同一个 datasource。" },
 *     { "key": "transaction", "type": "string", "value": "serializable, retries=2", "description": "锁定、采集和删除使用一个可重试串行化事务。" }
 *   ],
 *   "examples": [
 *     { "title": "删除员工及其授权", "block": { "uuid": "delete_employee", "functionName": "cascadeDelete", "inputs": { "datasource": "Mokelay", "root": { "id": "employee", "table": "employees", "keyField": "id", "conditions": [{ "group": false, "fieldName": "id", "fieldValue": 1, "conditionType": "EQ" }] }, "relations": [{ "id": "identities", "table": "employee_auth_identities", "keyField": "id", "parent": "employee", "foreignKey": "employee_id" }], "collect": [] }, "outputs": ["affected", "affectedByNode", "totalAffected", "collected"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeCascadeDeleteBlock: BlockExecutor = async ({
  inputs,
  databaseType,
  withTransaction,
  processValue,
}) => {
  const configuration = normalizeConfiguration(inputs)
  const actualDatabaseType = requireDatabaseType(databaseType)

  if (!withTransaction) {
    throw mokelayError(
      'BLOCK_SQL_UNSUPPORTED',
      'cascadeDelete Block 必须在 datasource transaction runner 中执行。',
      500,
    )
  }

  return await withTransaction(async (executeSql) => {
    const selections = new Map<string, NodeSelection>()
    let selectedCount = 0

    for (const node of configuration.nodes) {
      const fields = nodeSelectFields(node.id, configuration.collect)
      const rows = node.id === configuration.root.id
        ? await selectRoot(executeSql, node, fields, configuration.limits)
        : await selectRelation(
            executeSql,
            node,
            fields,
            selections.get(node.parent!)?.rows ?? [],
            selectedCount,
            configuration.limits,
          )

      selections.set(node.id, { node, rows })
      selectedCount += rows.length
    }

    // Every processor runs before the first DELETE. A validation failure therefore leaves all rows intact.
    const collected = await collectValues(
      selections,
      configuration.collect,
      configuration.limits.maxCollectedRows,
      processValue,
    )
    const deletedByNode = new Map<string, number>()

    for (const node of [...configuration.nodes].reverse()) {
      const selection = selections.get(node.id)!
      deletedByNode.set(
        node.id,
        await deleteRows(executeSql, node, selection.rows, actualDatabaseType),
      )
    }

    const affectedByNode = Object.fromEntries(
      configuration.nodes.map(node => [node.id, deletedByNode.get(node.id) ?? 0]),
    )
    const totalAffected = Object.values(affectedByNode).reduce((total, count) => total + count, 0)

    return {
      affected: affectedByNode[configuration.root.id] ?? 0,
      affectedByNode,
      totalAffected,
      collected,
    }
  }, { isolationLevel: 'serializable', retries: 2 })
}
