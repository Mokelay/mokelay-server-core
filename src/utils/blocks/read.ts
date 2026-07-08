import { sql } from 'drizzle-orm'
import { type BlockExecutor } from '../orchestration-schema.js'
import {
  buildWhereSql,
  getConditions,
  getFields,
  identifierSql,
  requireDatabaseType,
} from './shared.js'

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "read",
 *   "displayName": "读取单条记录",
 *   "category": "database",
 *   "description": "读取 table 中第一条满足 conditions 的记录。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "数据源名称，对应 ${datasource}_DATABASE_URL。" },
 *     { "key": "table", "type": "string", "required": true, "description": "数据库表名，支持 schema.table。" },
 *     { "key": "fields", "type": "string[]", "required": true, "description": "需要返回的字段列表。" },
 *     { "key": "conditions", "type": "OrchestrationCondition[]", "required": false, "description": "可选过滤条件。" }
 *   ],
 *   "outputs": [
 *     { "key": "data", "type": "Record<string, unknown>|null", "description": "首条记录；未命中时为 null。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_INVALID_TABLE", "description": "table 为空或不是合法 SQL 标识符。" },
 *     { "code": "BLOCK_INVALID_FIELDS", "description": "fields 不是非空字符串数组。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要 datasource，并使用对应数据库连接执行 SQL。" }
 *   ],
 *   "examples": [
 *     { "title": "按 uuid 读取页面", "block": { "uuid": "read_page", "functionName": "read", "inputs": { "datasource": "Mokelay", "table": "pages", "fields": ["uuid", "name"], "conditions": [{ "group": false, "fieldName": "uuid", "fieldValue": { "template": "{{request.query.uuid}}" }, "conditionType": "EQ" }] }, "outputs": ["data"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeReadBlock: BlockExecutor = async ({ inputs, executeSql, databaseType }) => {
  requireDatabaseType(databaseType)

  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const fields = getFields(inputs.fields)
  const conditions = getConditions(inputs.conditions)
  const where = buildWhereSql(conditions)
  const selectedFields = sql.join(fields.map((field) => identifierSql(field, 'fields', 'BLOCK_INVALID_FIELDS')), sql`, `)
  const query = where
    ? sql`SELECT ${selectedFields} FROM ${table} WHERE ${where} LIMIT 1`
    : sql`SELECT ${selectedFields} FROM ${table} LIMIT 1`
  const result = await executeSql(query)

  return {
    data: result.rows[0] ?? null,
  }
}
