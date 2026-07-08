import { sql } from 'drizzle-orm'
import { type BlockExecutor } from '../orchestration-schema.js'
import {
  buildWhereSql,
  fieldValueSql,
  getConditions,
  getFieldValues,
  identifierSql,
  requireDatabaseType,
} from './shared.js'

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "update",
 *   "displayName": "更新记录",
 *   "category": "database",
 *   "description": "更新 table 中满足 conditions 的记录，并返回影响行数。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "数据源名称，对应 ${datasource}_DATABASE_URL。" },
 *     { "key": "table", "type": "string", "required": true, "description": "数据库表名，支持 schema.table。" },
 *     { "key": "fields", "type": "Record<string, unknown>", "required": true, "description": "待更新字段和值。" },
 *     { "key": "conditions", "type": "OrchestrationCondition[]", "required": false, "description": "可选过滤条件；省略时会更新整表记录。" }
 *   ],
 *   "outputs": [
 *     { "key": "affected", "type": "number", "description": "更新影响行数。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_INVALID_TABLE", "description": "table 为空或不是合法 SQL 标识符。" },
 *     { "code": "BLOCK_INVALID_FIELDS", "description": "fields 不是非空对象。" },
 *     { "code": "BLOCK_INVALID_CONDITIONS", "description": "conditions 不符合编排条件结构。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要 datasource，并使用对应数据库连接执行 SQL。" }
 *   ],
 *   "examples": [
 *     { "title": "更新页面名称", "block": { "uuid": "update_page", "functionName": "update", "inputs": { "datasource": "Mokelay", "table": "pages", "fields": { "name": { "template": "{{request.body.name}}" } }, "conditions": [{ "group": false, "fieldName": "uuid", "fieldValue": { "template": "{{request.query.uuid}}" }, "conditionType": "EQ" }] }, "outputs": ["affected"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeUpdateBlock: BlockExecutor = async ({ inputs, executeSql, databaseType }) => {
  const actualDatabaseType = requireDatabaseType(databaseType)
  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const fields = getFieldValues(inputs.fields)
  const conditions = getConditions(inputs.conditions)
  const where = buildWhereSql(conditions)
  const assignments = sql.join(Object.entries(fields).map(([field, value]) => sql`${identifierSql(field, 'fields', 'BLOCK_INVALID_FIELDS')} = ${fieldValueSql(value, actualDatabaseType)}`), sql`, `)

  const result = actualDatabaseType === 'postgres'
    ? await executeSql(where
      ? sql`UPDATE ${table} SET ${assignments} WHERE ${where} RETURNING 1 AS affected_marker`
      : sql`UPDATE ${table} SET ${assignments} RETURNING 1 AS affected_marker`)
    : await executeSql(where
      ? sql`UPDATE ${table} SET ${assignments} WHERE ${where}`
      : sql`UPDATE ${table} SET ${assignments}`)

  return { affected: actualDatabaseType === 'postgres' ? result.rows.length : result.affectedRows ?? 0 }
}
