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
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "assertUnique",
 *   "displayName": "唯一性校验",
 *   "category": "database",
 *   "description": "检查指定字段值在 table 中是否唯一，冲突时中断编排。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "数据源名称，对应 ${datasource}_DATABASE_URL。" },
 *     { "key": "table", "type": "string", "required": true, "description": "数据库表名，支持 schema.table。" },
 *     { "key": "fieldName", "type": "string", "required": true, "description": "被检查的唯一字段。" },
 *     { "key": "value", "type": "unknown", "required": true, "description": "被检查字段值。" },
 *     { "key": "ignoreField", "type": "string", "required": false, "description": "更新场景下用于排除当前记录的字段。" },
 *     { "key": "ignoreValue", "type": "unknown", "required": false, "description": "更新场景下用于排除当前记录的字段值。" },
 *     { "key": "message", "type": "string", "required": false, "description": "冲突时返回的业务提示。" }
 *   ],
 *   "outputs": [],
 *   "errors": [
 *     { "code": "BLOCK_INVALID_TABLE", "description": "table 为空或不是合法 SQL 标识符。" },
 *     { "code": "BLOCK_INVALID_FIELDS", "description": "fieldName 或 ignoreField 不是合法字段名。" },
 *     { "code": "BLOCK_UNIQUE_CONFLICT", "description": "已存在匹配记录。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要 datasource，并使用对应数据库连接执行 SQL。" }
 *   ],
 *   "examples": [
 *     { "title": "校验邮箱唯一", "block": { "uuid": "check_email", "functionName": "assertUnique", "inputs": { "datasource": "Mokelay", "table": "employees", "fieldName": "email", "value": { "template": "{{request.body.email}}" }, "message": "邮箱已存在。" }, "outputs": [], "nextBlock": null } }
 *   ]
 * }
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
