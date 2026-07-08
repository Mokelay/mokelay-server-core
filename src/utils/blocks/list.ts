import { sql } from 'drizzle-orm'
import { type BlockExecutor } from '../orchestration-schema.js'
import {
  buildWhereSql,
  getConditions,
  getFields,
  identifierSql,
  orderBySql,
  requireDatabaseType,
} from './shared.js'

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "list",
 *   "displayName": "列表查询",
 *   "category": "database",
 *   "description": "按 table、fields、conditions、orderBy 查询多行数据，不做分页。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "数据源名称，对应 ${datasource}_DATABASE_URL。" },
 *     { "key": "table", "type": "string", "required": true, "description": "数据库表名，支持 schema.table。" },
 *     { "key": "fields", "type": "string[]", "required": true, "description": "需要返回的字段列表。" },
 *     { "key": "conditions", "type": "OrchestrationCondition[]", "required": false, "description": "可选过滤条件。" },
 *     { "key": "orderBy", "type": "OrderBy[]", "required": false, "description": "可选排序配置。" }
 *   ],
 *   "outputs": [
 *     { "key": "datas", "type": "Record<string, unknown>[]", "description": "查询结果 rows 数组。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_INVALID_TABLE", "description": "table 为空或不是合法 SQL 标识符。" },
 *     { "code": "BLOCK_INVALID_FIELDS", "description": "fields 不是非空字符串数组。" },
 *     { "code": "BLOCK_INVALID_CONDITIONS", "description": "conditions 不符合编排条件结构。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要 datasource，并使用对应数据库连接执行 SQL。" }
 *   ],
 *   "examples": [
 *     { "title": "查询页面列表", "block": { "uuid": "list_pages", "functionName": "list", "inputs": { "datasource": "Mokelay", "table": "pages", "fields": ["uuid", "name"], "orderBy": [{ "fieldName": "uuid", "direction": "DESC" }] }, "outputs": ["datas"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeListBlock: BlockExecutor = async ({ inputs, executeSql, databaseType }) => {
  requireDatabaseType(databaseType)

  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const fields = getFields(inputs.fields)
  const conditions = getConditions(inputs.conditions)
  const where = buildWhereSql(conditions)
  const orderBy = orderBySql(inputs.orderBy)
  const selectedFields = sql.join(fields.map((field) => identifierSql(field, 'fields', 'BLOCK_INVALID_FIELDS')), sql`, `)
  const baseQuery = sql`FROM ${table}`
  const dataQuery = where
    ? sql`SELECT ${selectedFields} ${baseQuery} WHERE ${where}`
    : sql`SELECT ${selectedFields} ${baseQuery}`
  const orderedDataQuery = orderBy ? sql`${dataQuery} ORDER BY ${orderBy}` : dataQuery
  const dataResult = await executeSql(orderedDataQuery)

  return {
    datas: dataResult.rows,
  }
}
