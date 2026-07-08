import { sql } from 'drizzle-orm'
import { type BlockExecutor } from '../orchestration-schema.js'
import {
  buildWhereSql,
  countExpressionSql,
  getConditions,
  identifierSql,
  normalizeCountTotal,
  requireDatabaseType,
} from './shared.js'

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "count",
 *   "displayName": "数量统计",
 *   "category": "database",
 *   "description": "统计 table 中满足 conditions 的记录数量。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "数据源名称，对应 ${datasource}_DATABASE_URL。" },
 *     { "key": "table", "type": "string", "required": true, "description": "数据库表名，支持 schema.table。" },
 *     { "key": "conditions", "type": "OrchestrationCondition[]", "required": false, "description": "可选过滤条件。" }
 *   ],
 *   "outputs": [
 *     { "key": "total", "type": "number", "description": "匹配记录数。" }
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
 *     { "title": "统计页面数量", "block": { "uuid": "count_pages", "functionName": "count", "inputs": { "datasource": "Mokelay", "table": "pages", "conditions": [] }, "outputs": ["total"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeCountBlock: BlockExecutor = async ({ inputs, executeSql, databaseType }) => {
  const actualDatabaseType = requireDatabaseType(databaseType)
  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const conditions = getConditions(inputs.conditions)
  const where = buildWhereSql(conditions)
  const result = await executeSql<{ total: number | string | bigint }>(where
    ? sql`SELECT ${countExpressionSql(actualDatabaseType)} AS total FROM ${table} WHERE ${where}`
    : sql`SELECT ${countExpressionSql(actualDatabaseType)} AS total FROM ${table}`)

  return {
    total: normalizeCountTotal(result.rows[0]?.total),
  }
}
