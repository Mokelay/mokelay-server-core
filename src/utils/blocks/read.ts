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
 * read block
 * 作用：读取 table 中第一条满足 conditions 的记录。
 * inputs：datasource 数据源；table 表名；fields 查询字段数组；conditions 可选过滤条件。
 * outputs：data，值为首条记录；未命中时为 null。
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
