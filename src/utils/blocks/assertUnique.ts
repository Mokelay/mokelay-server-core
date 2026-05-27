import { sql } from 'drizzle-orm'
import { type BlockExecutor } from '../orchestration-schema.js'
import { mokelayError } from '../mokelay-error.js'
import {
  countExpressionSql,
  fieldValueSql,
  identifierSql,
  normalizeCountTotal,
  requireDatabaseType,
} from './shared.js'

/**
 * assertUnique block
 * 作用：检查指定字段值在 table 中是否唯一，冲突时中断编排。
 * inputs：datasource 数据源；table 表名；fieldName 被检查字段；value 被检查值；ignoreField/ignoreValue 可选忽略当前记录；message 可选冲突消息。
 * outputs：无业务输出。
 */
export const executeAssertUniqueBlock: BlockExecutor = async ({ inputs, executeSql, databaseType }) => {
  const actualDatabaseType = requireDatabaseType(databaseType)
  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const fieldName = identifierSql(inputs.fieldName, 'fieldName', 'BLOCK_INVALID_FIELDS')
  const ignoreFieldName = inputs.ignoreField === undefined || inputs.ignoreField === null || inputs.ignoreField === ''
    ? undefined
    : identifierSql(inputs.ignoreField, 'ignoreField', 'BLOCK_INVALID_FIELDS')
  const value = inputs.value
  const ignoreValue = inputs.ignoreValue
  const hasIgnoreValue = ignoreFieldName && ignoreValue !== undefined && ignoreValue !== null && ignoreValue !== ''
  const where = hasIgnoreValue
    ? sql`${fieldName} = ${fieldValueSql(value, actualDatabaseType)} AND ${ignoreFieldName} <> ${fieldValueSql(ignoreValue, actualDatabaseType)}`
    : sql`${fieldName} = ${fieldValueSql(value, actualDatabaseType)}`
  const result = await executeSql<{ total: number | string | bigint }>(sql`SELECT ${countExpressionSql(actualDatabaseType)} AS total FROM ${table} WHERE ${where}`)
  const total = normalizeCountTotal(result.rows[0]?.total)

  if (total > 0) {
    const message = typeof inputs.message === 'string' && inputs.message.trim()
      ? inputs.message.trim()
      : '记录已存在。'

    throw mokelayError('BLOCK_UNIQUE_CONFLICT', message, 409)
  }

  return {}
}
