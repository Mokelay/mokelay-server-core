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
 * count block
 * 作用：统计 table 中满足 conditions 的记录数量。
 * inputs：datasource 数据源；table 表名；conditions 可选过滤条件。
 * outputs：total，值为匹配记录数。
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
