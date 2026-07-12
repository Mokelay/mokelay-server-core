import { sql, type SQL } from 'drizzle-orm'
import { mokelayError, type MokelayErrorCode } from '../mokelay-error.js'
import { type BlockExecutor, type OrchestrationCondition } from '../orchestration-schema.js'
import {
  buildWhereSql,
  countExpressionSql,
  getConditions,
  getFields,
  getPositiveInteger,
  identifierSql,
  isRecord,
  normalizeCountTotal,
  orderBySql,
  requireDatabaseType,
} from './shared.js'

type PageRelationType = 'left' | 'inner'

type PageRelationField = {
  field: string
  as: string
}

type PageRelation = {
  type: PageRelationType
  table: string
  alias: string
  localField: string
  foreignField: string
  fields: PageRelationField[]
}

type RelationSqlContext = {
  baseAlias: string
  baseTableName: string
  relationAliases: Set<string>
}

const baseTableAlias = '__page_base'

function identifierParts(value: unknown, name: string, errorCode: MokelayErrorCode) {
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError(errorCode, `${name} 必须是非空字符串。`, 400)
  }

  const parts = value.trim().split('.').map((part) => part.trim())

  if (parts.some((part) => !part)) {
    throw mokelayError(errorCode, `${name} 不是合法 SQL 标识符。`, 400)
  }

  return parts
}

function singleIdentifier(value: unknown, name: string, errorCode: MokelayErrorCode) {
  const parts = identifierParts(value, name, errorCode)

  if (parts.length !== 1) {
    throw mokelayError(errorCode, `${name} 不能包含点号。`, 400)
  }

  return parts[0]
}

function lastIdentifierPart(value: string, name: string, errorCode: MokelayErrorCode) {
  const parts = identifierParts(value, name, errorCode)

  return parts.at(-1) ?? value
}

function getPageRelations(value: unknown): PageRelation[] {
  if (value === undefined) {
    return []
  }

  if (!Array.isArray(value)) {
    throw mokelayError('BLOCK_INVALID_FIELDS', 'relations 必须是数组。', 400)
  }

  const aliases = new Set<string>()

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw mokelayError('BLOCK_INVALID_FIELDS', `relations[${index}] 必须是对象。`, 400)
    }

    const relationType = typeof item.type === 'string' ? item.type.toLowerCase() : 'left'

    if (relationType !== 'left' && relationType !== 'inner') {
      throw mokelayError('BLOCK_INVALID_FIELDS', `relations[${index}].type 只能是 left 或 inner。`, 400)
    }

    const table = identifierParts(item.table, `relations[${index}].table`, 'BLOCK_INVALID_TABLE').join('.')
    const alias = singleIdentifier(item.alias, `relations[${index}].alias`, 'BLOCK_INVALID_FIELDS')

    if (alias === baseTableAlias || aliases.has(alias)) {
      throw mokelayError('BLOCK_INVALID_FIELDS', `relations[${index}].alias 不能重复或使用保留别名。`, 400)
    }

    aliases.add(alias)

    const fieldsValue = item.fields ?? []

    if (!Array.isArray(fieldsValue)) {
      throw mokelayError('BLOCK_INVALID_FIELDS', `relations[${index}].fields 必须是数组。`, 400)
    }

    const fields = fieldsValue.map((fieldItem, fieldIndex) => {
      if (!isRecord(fieldItem)) {
        throw mokelayError('BLOCK_INVALID_FIELDS', `relations[${index}].fields[${fieldIndex}] 必须是对象。`, 400)
      }

      return {
        field: identifierParts(
          fieldItem.field,
          `relations[${index}].fields[${fieldIndex}].field`,
          'BLOCK_INVALID_FIELDS',
        ).join('.'),
        as: singleIdentifier(
          fieldItem.as,
          `relations[${index}].fields[${fieldIndex}].as`,
          'BLOCK_INVALID_FIELDS',
        ),
      }
    })

    return {
      type: relationType,
      table,
      alias,
      localField: identifierParts(item.localField, `relations[${index}].localField`, 'BLOCK_INVALID_FIELDS').join('.'),
      foreignField: identifierParts(item.foreignField, `relations[${index}].foreignField`, 'BLOCK_INVALID_FIELDS').join('.'),
      fields,
    }
  })
}

function qualifiedFieldSql(field: string, defaultAlias: string, context: RelationSqlContext, errorCode: MokelayErrorCode) {
  const parts = identifierParts(field, 'fieldName', errorCode)

  if (parts.length === 1) {
    return sql`${sql.identifier(defaultAlias)}.${sql.identifier(parts[0])}`
  }

  if (parts.length === 2) {
    const [qualifier, column] = parts

    if (qualifier === context.baseAlias || qualifier === context.baseTableName) {
      return sql`${sql.identifier(context.baseAlias)}.${sql.identifier(column)}`
    }

    if (context.relationAliases.has(qualifier)) {
      return sql`${sql.identifier(qualifier)}.${sql.identifier(column)}`
    }
  }

  throw mokelayError(errorCode, '字段必须是字段名或 alias.fieldName。', 400)
}

function isEmptyOptionalConditionValue(value: unknown) {
  return value === undefined
    || value === null
    || value === ''
    || (Array.isArray(value) && value.length === 0)
}

function relationConditionSql(condition: OrchestrationCondition, context: RelationSqlContext): SQL | undefined {
  if (condition.group) {
    const parts = condition.groups.flatMap((item) => {
      const conditionSql = relationConditionSql(item, context)
      return conditionSql ? [sql`(${conditionSql})`] : []
    })

    if (parts.length === 0) {
      return undefined
    }

    return sql.join(parts, condition.groupType === 'AND' ? sql` AND ` : sql` OR `)
  }

  if (condition.optional === true && isEmptyOptionalConditionValue(condition.fieldValue)) {
    return undefined
  }

  const column = qualifiedFieldSql(condition.fieldName, context.baseAlias, context, 'BLOCK_INVALID_CONDITIONS')

  switch (condition.conditionType) {
    case 'EQ':
      return sql`${column} = ${condition.fieldValue}`
    case 'NEQ':
      return sql`${column} <> ${condition.fieldValue}`
    case 'GT':
      return sql`${column} > ${condition.fieldValue}`
    case 'GE':
      return sql`${column} >= ${condition.fieldValue}`
    case 'LT':
      return sql`${column} < ${condition.fieldValue}`
    case 'LE':
      return sql`${column} <= ${condition.fieldValue}`
    case 'LIKE':
      return sql`LOWER(${column}) LIKE LOWER(${`%${String(condition.fieldValue)}%`})`
    case 'IN':
    case 'NOTIN': {
      if (!Array.isArray(condition.fieldValue) || condition.fieldValue.length === 0) {
        throw mokelayError(
          'BLOCK_INVALID_CONDITION_VALUE',
          `${condition.conditionType} 条件的 fieldValue 必须是非空数组。`,
          400,
        )
      }

      const values = sql.join(condition.fieldValue.map((item) => sql`${item}`), sql`, `)
      return condition.conditionType === 'IN'
        ? sql`${column} IN (${values})`
        : sql`${column} NOT IN (${values})`
    }
  }
}

function relationWhereSql(conditions: OrchestrationCondition[], context: RelationSqlContext) {
  const parts = conditions.flatMap((condition) => {
    const conditionSql = relationConditionSql(condition, context)
    return conditionSql ? [sql`(${conditionSql})`] : []
  })

  if (parts.length === 0) {
    return undefined
  }

  return sql.join(parts, sql` AND `)
}

function relationOrderBySql(value: unknown, context: RelationSqlContext) {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw mokelayError('BLOCK_INVALID_ORDER_BY', 'orderBy 必须是数组。', 400)
  }

  const orders = value.map((item) => {
    if (!isRecord(item) || typeof item.fieldName !== 'string' || !item.fieldName.trim()) {
      throw mokelayError('BLOCK_INVALID_ORDER_BY_FIELD', 'orderBy.fieldName 必须是非空字符串。', 400)
    }

    const direction = typeof item.direction === 'string' ? item.direction.toUpperCase() : 'ASC'

    if (direction !== 'ASC' && direction !== 'DESC') {
      throw mokelayError('BLOCK_INVALID_ORDER_BY_DIRECTION', 'orderBy.direction 只能是 ASC 或 DESC。', 400)
    }

    return sql`${qualifiedFieldSql(item.fieldName, context.baseAlias, context, 'BLOCK_INVALID_ORDER_BY_FIELD')} ${sql.raw(direction)}`
  })

  return orders.length > 0 ? sql.join(orders, sql`, `) : undefined
}

function relationSelectFieldsSql(fields: string[], relations: PageRelation[], context: RelationSqlContext) {
  const baseFields = fields.map((field) => {
    const outputName = lastIdentifierPart(field, 'fields', 'BLOCK_INVALID_FIELDS')
    return sql`${qualifiedFieldSql(field, context.baseAlias, context, 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier(outputName)}`
  })
  const relationFields = relations.flatMap((relation) => relation.fields.map((field) => {
    return sql`${qualifiedFieldSql(field.field, relation.alias, context, 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier(field.as)}`
  }))

  return sql.join([...baseFields, ...relationFields], sql`, `)
}

function relationJoinSql(relations: PageRelation[], context: RelationSqlContext) {
  return sql.join(relations.map((relation) => {
    const relationTable = identifierSql(relation.table, 'relations.table', 'BLOCK_INVALID_TABLE')
    const joinType = relation.type === 'inner' ? sql.raw('INNER JOIN') : sql.raw('LEFT JOIN')
    const localField = qualifiedFieldSql(relation.localField, context.baseAlias, context, 'BLOCK_INVALID_FIELDS')
    const foreignField = qualifiedFieldSql(relation.foreignField, relation.alias, context, 'BLOCK_INVALID_FIELDS')

    return sql`${joinType} ${relationTable} AS ${sql.identifier(relation.alias)} ON ${localField} = ${foreignField}`
  }), sql` `)
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "page",
 *   "displayName": "分页查询",
 *   "category": "database",
 *   "description": "按 table、fields、conditions、orderBy 查询分页数据，并额外计算分页信息。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "数据源名称，对应 ${datasource}_DATABASE_URL。" },
 *     { "key": "table", "type": "string", "required": true, "description": "数据库表名，支持 schema.table。" },
 *     { "key": "fields", "type": "string[]", "required": true, "description": "需要返回的字段列表。" },
 *     { "key": "relations", "type": "PageRelation[]", "required": false, "description": "可选一跳关联读取配置。配置后基表会使用内部 alias；未限定的 fields、conditions、orderBy 默认指向基表，alias.fieldName 可指向关联表。relation.fields 的 as 必填，用于避免返回字段冲突。" },
 *     { "key": "conditions", "type": "OrchestrationCondition[]", "required": false, "description": "可选过滤条件。" },
 *     { "key": "orderBy", "type": "OrderBy[]", "required": false, "description": "可选排序配置。" },
 *     { "key": "page", "type": "number|string", "required": false, "defaultValue": 1, "description": "页码，必须为正整数。" },
 *     { "key": "pageSize", "type": "number|string", "required": false, "defaultValue": 20, "description": "每页数量，必须为正整数。" }
 *   ],
 *   "outputs": [
 *     { "key": "datas", "type": "Record<string, unknown>[]", "description": "当前页 rows 数组。" },
 *     { "key": "total", "type": "number", "description": "匹配总数。" },
 *     { "key": "totalPages", "type": "number", "description": "总页数。" },
 *     { "key": "page", "type": "number", "description": "标准化后的当前页码。" },
 *     { "key": "pageSize", "type": "number", "description": "标准化后的每页数量。" },
 *     { "key": "hasPreviousPage", "type": "boolean", "description": "是否有上一页。" },
 *     { "key": "hasNextPage", "type": "boolean", "description": "是否有下一页。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_INVALID_TABLE", "description": "table 为空或不是合法 SQL 标识符。" },
 *     { "code": "BLOCK_INVALID_FIELDS", "description": "fields 不是非空字符串数组。" },
 *     { "code": "BLOCK_INVALID_FIELDS", "description": "relations 不是合法关联配置，或 relation.fields 缺少 as。" },
 *     { "code": "BLOCK_INVALID_PAGE", "description": "page 不是正整数。" },
 *     { "code": "BLOCK_INVALID_PAGE_SIZE", "description": "pageSize 不是正整数。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要 datasource，并使用对应数据库连接执行 SQL。" }
 *   ],
 *   "examples": [
 *     { "title": "分页查询页面", "block": { "uuid": "page_pages", "functionName": "page", "inputs": { "datasource": "Mokelay", "table": "pages", "fields": ["uuid", "name"], "page": { "template": "{{request.query.page}}" }, "pageSize": { "template": "{{request.query.pageSize}}" } }, "outputs": ["datas", "total", "totalPages", "page", "pageSize", "hasPreviousPage", "hasNextPage"], "nextBlock": null } },
 *     { "title": "分页查询员工并关联企业名称", "block": { "uuid": "page_employees", "functionName": "page", "inputs": { "datasource": "Mokelay", "table": "employees", "fields": ["id", "enterprise_uuid", "name"], "relations": [{ "type": "left", "table": "enterprise", "alias": "enterprise", "localField": "enterprise_uuid", "foreignField": "uuid", "fields": [{ "field": "name", "as": "enterprise_name" }] }], "orderBy": [{ "fieldName": "updated_at", "direction": "DESC" }] }, "outputs": ["datas", "total", "totalPages", "page", "pageSize", "hasPreviousPage", "hasNextPage"], "nextBlock": null } }
 *   ]
 * }
 */
export const executePageBlock: BlockExecutor = async ({ inputs, executeSql, databaseType }) => {
  const actualDatabaseType = requireDatabaseType(databaseType)
  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const fields = getFields(inputs.fields)
  const relations = getPageRelations(inputs.relations)
  const conditions = getConditions(inputs.conditions)
  const page = getPositiveInteger(inputs.page, 'page', 1, 'BLOCK_INVALID_PAGE')
  const pageSize = getPositiveInteger(inputs.pageSize, 'pageSize', 20, 'BLOCK_INVALID_PAGE_SIZE')

  if (relations.length === 0) {
    const where = buildWhereSql(conditions)
    const orderBy = orderBySql(inputs.orderBy)
    const selectedFields = sql.join(fields.map((field) => identifierSql(field, 'fields', 'BLOCK_INVALID_FIELDS')), sql`, `)
    const baseQuery = sql`FROM ${table}`
    const dataQuery = where
      ? sql`SELECT ${selectedFields} ${baseQuery} WHERE ${where}`
      : sql`SELECT ${selectedFields} ${baseQuery}`
    const orderedDataQuery = orderBy ? sql`${dataQuery} ORDER BY ${orderBy}` : dataQuery
    const dataResult = await executeSql(sql`${orderedDataQuery} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`)
    const totalResult = await executeSql<{ total: number | string | bigint }>(where
      ? sql`SELECT ${countExpressionSql(actualDatabaseType)} AS total ${baseQuery} WHERE ${where}`
      : sql`SELECT ${countExpressionSql(actualDatabaseType)} AS total ${baseQuery}`)
    const total = normalizeCountTotal(totalResult.rows[0]?.total)

    return {
      datas: dataResult.rows,
      total,
      totalPages: Math.ceil(total / pageSize),
      page,
      pageSize,
      hasPreviousPage: page > 1 && total > 0,
      hasNextPage: page < Math.ceil(total / pageSize),
    }
  }

  const baseTableName = lastIdentifierPart(String(inputs.table), 'table', 'BLOCK_INVALID_TABLE')

  if (relations.some((relation) => relation.alias === baseTableName)) {
    throw mokelayError('BLOCK_INVALID_FIELDS', 'relations.alias 不能与基表名重复。', 400)
  }

  const context: RelationSqlContext = {
    baseAlias: baseTableAlias,
    baseTableName,
    relationAliases: new Set(relations.map((relation) => relation.alias)),
  }
  const where = relationWhereSql(conditions, context)
  const orderBy = relationOrderBySql(inputs.orderBy, context)
  const selectedFields = relationSelectFieldsSql(fields, relations, context)
  const joins = relationJoinSql(relations, context)
  const baseQuery = sql`FROM ${table} AS ${sql.identifier(context.baseAlias)} ${joins}`
  const dataQuery = where
    ? sql`SELECT ${selectedFields} ${baseQuery} WHERE ${where}`
    : sql`SELECT ${selectedFields} ${baseQuery}`
  const orderedDataQuery = orderBy ? sql`${dataQuery} ORDER BY ${orderBy}` : dataQuery
  const dataResult = await executeSql(sql`${orderedDataQuery} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`)
  const totalResult = await executeSql<{ total: number | string | bigint }>(where
    ? sql`SELECT ${countExpressionSql(actualDatabaseType)} AS total ${baseQuery} WHERE ${where}`
    : sql`SELECT ${countExpressionSql(actualDatabaseType)} AS total ${baseQuery}`)
  const total = normalizeCountTotal(totalResult.rows[0]?.total)

  return {
    datas: dataResult.rows,
    total,
    totalPages: Math.ceil(total / pageSize),
    page,
    pageSize,
    hasPreviousPage: page > 1 && total > 0,
    hasNextPage: page < Math.ceil(total / pageSize),
  }
}
