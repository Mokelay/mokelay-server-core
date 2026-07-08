import { sql } from 'drizzle-orm'
import { type BlockExecutor } from '../orchestration-schema.js'
import {
  buildWhereSql,
  getConditions,
  identifierSql,
  requireDatabaseType,
} from './shared.js'

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "delete",
 *   "displayName": "删除记录",
 *   "category": "database",
 *   "description": "删除 table 中满足 conditions 的记录，并返回影响行数。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "数据源名称，对应 ${datasource}_DATABASE_URL。" },
 *     { "key": "table", "type": "string", "required": true, "description": "数据库表名，支持 schema.table。" },
 *     { "key": "conditions", "type": "OrchestrationCondition[]", "required": false, "description": "可选过滤条件；省略时会删除整表记录。" }
 *   ],
 *   "outputs": [
 *     { "key": "affected", "type": "number", "description": "删除影响行数。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_INVALID_TABLE", "description": "table 为空或不是合法 SQL 标识符。" },
 *     { "code": "BLOCK_INVALID_CONDITIONS", "description": "conditions 不符合编排条件结构。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要 datasource，并使用对应数据库连接执行 SQL。" }
 *   ],
 *   "examples": [
 *     { "title": "按 uuid 删除页面", "block": { "uuid": "delete_page", "functionName": "delete", "inputs": { "datasource": "Mokelay", "table": "pages", "conditions": [{ "group": false, "fieldName": "uuid", "fieldValue": { "template": "{{request.body.uuid}}" }, "conditionType": "EQ" }] }, "outputs": ["affected"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeDeleteBlock: BlockExecutor = async ({ inputs, executeSql, databaseType }) => {
  const actualDatabaseType = requireDatabaseType(databaseType)
  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const conditions = getConditions(inputs.conditions)
  const where = buildWhereSql(conditions)
  const result = actualDatabaseType === 'postgres'
    ? await executeSql(where
      ? sql`DELETE FROM ${table} WHERE ${where} RETURNING 1 AS affected_marker`
      : sql`DELETE FROM ${table} RETURNING 1 AS affected_marker`)
    : await executeSql(where
      ? sql`DELETE FROM ${table} WHERE ${where}`
      : sql`DELETE FROM ${table}`)

  return { affected: actualDatabaseType === 'postgres' ? result.rows.length : result.affectedRows ?? 0 }
}
