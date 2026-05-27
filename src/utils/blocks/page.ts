import { sql } from 'drizzle-orm'
import { type BlockExecutor } from '../orchestration-schema.js'
import {
  buildWhereSql,
  countExpressionSql,
  getConditions,
  getFields,
  getPositiveInteger,
  identifierSql,
  normalizeCountTotal,
  orderBySql,
  requireDatabaseType,
} from './shared.js'

/**
 * page block
 * 作用：按 table、fields、conditions、orderBy 查询分页数据，并额外计算分页信息。
 * inputs：datasource 数据源；table 表名；fields 查询字段数组；conditions 可选过滤条件；orderBy 可选排序；page/pageSize 可选正整数。
 * outputs：datas、total、totalPages、page、pageSize、hasPreviousPage、hasNextPage。
 */
export const executePageBlock: BlockExecutor = async ({ inputs, executeSql, databaseType }) => {
  const actualDatabaseType = requireDatabaseType(databaseType)
  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const fields = getFields(inputs.fields)
  const conditions = getConditions(inputs.conditions)
  const where = buildWhereSql(conditions)
  const orderBy = orderBySql(inputs.orderBy)
  const selectedFields = sql.join(fields.map((field) => identifierSql(field, 'fields', 'BLOCK_INVALID_FIELDS')), sql`, `)
  const baseQuery = sql`FROM ${table}`
  const page = getPositiveInteger(inputs.page, 'page', 1, 'BLOCK_INVALID_PAGE')
  const pageSize = getPositiveInteger(inputs.pageSize, 'pageSize', 20, 'BLOCK_INVALID_PAGE_SIZE')
  const dataQuery = where
    ? sql`SELECT ${selectedFields} ${baseQuery} WHERE ${where}`
    : sql`SELECT ${selectedFields} ${baseQuery}`
  const orderedDataQuery = orderBy ? sql`${dataQuery} ORDER BY ${orderBy}` : dataQuery
  const dataResult = await executeSql(sql`${orderedDataQuery} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`)
  const totalResult = await executeSql<{ total: number | string | bigint }>(where
    ? sql`SELECT ${countExpressionSql(actualDatabaseType)} AS total ${baseQuery} WHERE ${where}`
    : sql`SELECT ${countExpressionSql(actualDatabaseType)} AS total ${baseQuery}`)
  const total = normalizeCountTotal(totalResult.rows[0]?.total)

  return {
    datas: dataResult.rows,
    total,
    totalPages: Math.ceil(total / pageSize),
    page,
    pageSize,
    hasPreviousPage: page > 1 && total > 0,
    hasNextPage: page < Math.ceil(total / pageSize),
  }
}
