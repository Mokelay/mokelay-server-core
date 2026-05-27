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
 * list block
 * 作用：按 table、fields、conditions、orderBy 查询多行数据，不做分页。
 * inputs：datasource 数据源；table 表名；fields 查询字段数组；conditions 可选过滤条件；orderBy 可选排序。
 * outputs：datas，值为查询结果 rows 数组。
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
