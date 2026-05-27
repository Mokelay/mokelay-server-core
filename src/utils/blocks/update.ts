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
 * update block
 * 作用：更新 table 中满足 conditions 的记录，并返回影响行数。
 * inputs：datasource 数据源；table 表名；fields 待更新字段对象；conditions 可选过滤条件。
 * outputs：affected，值为更新影响行数。
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
