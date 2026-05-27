import { sql } from 'drizzle-orm'
import { type DatabaseType } from '../db.js'
import { mokelayError } from '../mokelay-error.js'
import { type BlockExecutor } from '../orchestration-schema.js'
import {
  fieldValueSql,
  getCreateIdField,
  getFieldValues,
  identifierSql,
  requireDatabaseType,
} from './shared.js'

function upsertUpdateAssignmentsSql(columns: string[], idFieldName: string, databaseType: DatabaseType) {
  const updateColumns = columns.filter((column) => column !== idFieldName)
  const assignmentColumns = updateColumns.length > 0 ? updateColumns : [idFieldName]
  const assignments = assignmentColumns.map((column) => (
    databaseType === 'postgres'
      ? sql`${identifierSql(column, 'fields', 'BLOCK_INVALID_FIELDS')} = ${identifierSql(`excluded.${column}`, 'fields', 'BLOCK_INVALID_FIELDS')}`
      : sql`${identifierSql(column, 'fields', 'BLOCK_INVALID_FIELDS')} = VALUES(${identifierSql(column, 'fields', 'BLOCK_INVALID_FIELDS')})`
  ))

  if (!columns.includes('updated_at')) {
    assignments.push(sql`${identifierSql('updated_at', 'fields', 'BLOCK_INVALID_FIELDS')} = ${databaseType === 'postgres' ? sql`now()` : sql`CURRENT_TIMESTAMP`}`)
  }

  return sql.join(assignments, sql`, `)
}

/**
 * upsert block
 * 作用：按 idField 执行插入或更新，并把物理 idField 映射为标准输出 uuid。
 * inputs：datasource 数据源；table 表名；fields 写入字段对象，必须包含 idField；idField 唯一 ID 字段。
 * outputs：uuid，值为插入或更新记录的唯一 ID。
 */
export const executeUpsertBlock: BlockExecutor = async ({ inputs, executeSql, databaseType }) => {
  const actualDatabaseType = requireDatabaseType(databaseType)
  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const fields = getFieldValues(inputs.fields)
  const idField = getCreateIdField(inputs.idField)
  const columns = Object.keys(fields)

  if (!columns.includes(idField.fieldName)) {
    throw mokelayError('BLOCK_INVALID_FIELDS', 'fields 必须包含 idField 字段。', 400)
  }

  const columnSql = sql.join(columns.map((field) => identifierSql(field, 'fields', 'BLOCK_INVALID_FIELDS')), sql`, `)
  const valueSql = sql.join(columns.map((field) => fieldValueSql(fields[field], actualDatabaseType)), sql`, `)
  const assignments = upsertUpdateAssignmentsSql(columns, idField.fieldName, actualDatabaseType)
  const result = actualDatabaseType === 'postgres'
    ? await executeSql(sql`INSERT INTO ${table} (${columnSql}) VALUES (${valueSql}) ON CONFLICT (${idField.fieldSql}) DO UPDATE SET ${assignments} RETURNING ${idField.fieldSql}`)
    : await executeSql(sql`INSERT INTO ${table} (${columnSql}) VALUES (${valueSql}) ON DUPLICATE KEY UPDATE ${assignments}`)
  const uuid = actualDatabaseType === 'postgres'
    ? result.rows[0]?.[idField.fieldName]
    : fields[idField.fieldName]

  if (uuid === undefined || uuid === null || uuid === '') {
    throw mokelayError('BLOCK_CREATE_MISSING_ID', 'upsert Block 未返回记录的唯一 ID。', 500)
  }

  return { uuid }
}
