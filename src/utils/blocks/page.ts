import { sql } from 'drizzle-orm'
import { type BlockExecutor } from '../orchestration-schema.js'
import {
  buildWhereSql,
  countExpressionSql,
  getConditions,
  getFields,
  getPositiveInteger,
  identifierSql,
  normalizeCountTotal,
  orderBySql,
  requireDatabaseType,
} from './shared.js'

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
 *     { "code": "BLOCK_INVALID_PAGE", "description": "page 不是正整数。" },
 *     { "code": "BLOCK_INVALID_PAGE_SIZE", "description": "pageSize 不是正整数。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要 datasource，并使用对应数据库连接执行 SQL。" }
 *   ],
 *   "examples": [
 *     { "title": "分页查询页面", "block": { "uuid": "page_pages", "functionName": "page", "inputs": { "datasource": "Mokelay", "table": "pages", "fields": ["uuid", "name"], "page": { "template": "{{request.query.page}}" }, "pageSize": { "template": "{{request.query.pageSize}}" } }, "outputs": ["datas", "total", "totalPages", "page", "pageSize", "hasPreviousPage", "hasNextPage"], "nextBlock": null } }
 *   ]
 * }
 */
export const executePageBlock: BlockExecutor = async ({ inputs, executeSql, databaseType }) => {
  const actualDatabaseType = requireDatabaseType(databaseType)
  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const fields = getFields(inputs.fields)
  const conditions = getConditions(inputs.conditions)
  const where = buildWhereSql(conditions)
  const orderBy = orderBySql(inputs.orderBy)
  const selectedFields = sql.join(fields.map((field) => identifierSql(field, 'fields', 'BLOCK_INVALID_FIELDS')), sql`, `)
  const baseQuery = sql`FROM ${table}`
  const page = getPositiveInteger(inputs.page, 'page', 1, 'BLOCK_INVALID_PAGE')
  const pageSize = getPositiveInteger(inputs.pageSize, 'pageSize', 20, 'BLOCK_INVALID_PAGE_SIZE')
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
