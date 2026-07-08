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
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "upsert",
 *   "displayName": "插入或更新记录",
 *   "category": "database",
 *   "description": "按 idField 执行插入或更新，并把物理 idField 映射为标准输出 uuid。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "数据源名称，对应 ${datasource}_DATABASE_URL。" },
 *     { "key": "table", "type": "string", "required": true, "description": "数据库表名，支持 schema.table。" },
 *     { "key": "fields", "type": "Record<string, unknown>", "required": true, "description": "写入字段和值，必须包含 idField。" },
 *     { "key": "idField", "type": "string", "required": true, "description": "唯一 ID 字段，也是冲突判断字段。" }
 *   ],
 *   "outputs": [
 *     { "key": "uuid", "type": "string|number", "description": "插入或更新记录的唯一 ID。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_INVALID_TABLE", "description": "table 为空或不是合法 SQL 标识符。" },
 *     { "code": "BLOCK_INVALID_FIELDS", "description": "fields 为空、字段名非法或缺少 idField。" },
 *     { "code": "BLOCK_INVALID_ID_FIELD", "description": "idField 为空或不是合法字段名。" },
 *     { "code": "BLOCK_CREATE_MISSING_ID", "description": "写入成功但无法得到唯一 ID。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要 datasource；Postgres 使用 ON CONFLICT，MySQL 使用 ON DUPLICATE KEY UPDATE。" }
 *   ],
 *   "examples": [
 *     { "title": "保存页面", "block": { "uuid": "upsert_page", "functionName": "upsert", "inputs": { "datasource": "Mokelay", "table": "pages", "idField": "uuid", "fields": { "uuid": { "template": "{{request.body.uuid}}" }, "name": { "template": "{{request.body.name}}" }, "blocks": { "template": "{{request.body.blocks}}" } } }, "outputs": ["uuid"], "nextBlock": null } }
 *   ]
 * }
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
