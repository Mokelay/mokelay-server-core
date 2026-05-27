import { sql } from 'drizzle-orm'
import { type BlockExecutor } from '../orchestration-schema.js'
import {
  buildWhereSql,
  getConditions,
  identifierSql,
  requireDatabaseType,
} from './shared.js'

/**
 * delete block
 * 作用：删除 table 中满足 conditions 的记录，并返回影响行数。
 * inputs：datasource 数据源；table 表名；conditions 可选过滤条件。
 * outputs：affected，值为删除影响行数。
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
