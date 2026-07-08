import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { type BlockExecutor, type SqlExecutor } from '../orchestration-schema.js'
import { mokelayError, type MokelayErrorCode } from '../mokelay-error.js'
import {
  fieldValueSql,
  getCreateIdField,
  getFieldValues,
  identifierSql,
  isDuplicateRecordError,
  isPresentId,
  requireDatabaseType,
} from './shared.js'

type MysqlColumnMetadata = {
  data_type?: unknown
  column_default?: unknown
  extra?: unknown
}

function identifierParts(value: unknown, name: string, errorCode: MokelayErrorCode) {
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError(errorCode, `${name} 必须是非空字符串。`, 400)
  }

  const parts = value.trim().split('.').map((part) => part.trim())

  if (parts.some((part) => !part)) {
    throw mokelayError(errorCode, `${name} 不是合法 SQL 标识符。`, 400)
  }

  return parts
}

function mysqlTableMetadata(value: unknown) {
  const parts = identifierParts(value, 'table', 'BLOCK_INVALID_TABLE')

  return {
    schemaName: parts.length > 1 ? parts.at(-2) : undefined,
    tableName: parts.at(-1) as string,
  }
}

function isMysqlUuidDefault(metadata: MysqlColumnMetadata | undefined) {
  if (!metadata) {
    return false
  }

  const dataType = typeof metadata.data_type === 'string' ? metadata.data_type.toLowerCase() : ''
  const defaultValue = typeof metadata.column_default === 'string'
    ? metadata.column_default.replace(/\s+/g, '').toLowerCase()
    : ''
  const extra = typeof metadata.extra === 'string' ? metadata.extra.toLowerCase() : ''

  return ['char', 'varchar'].includes(dataType)
    && (defaultValue === 'uuid()' || defaultValue === '(uuid())')
    && !extra.includes('auto_increment')
}

async function mysqlGeneratedIdValue(
  tableValue: unknown,
  idFieldName: string,
  fields: Record<string, unknown>,
  executeSql: SqlExecutor,
) {
  if (fields[idFieldName] !== undefined && fields[idFieldName] !== null && fields[idFieldName] !== '') {
    return undefined
  }

  const table = mysqlTableMetadata(tableValue)
  const schemaFilter = table.schemaName
    ? sql`TABLE_SCHEMA = ${table.schemaName}`
    : sql`TABLE_SCHEMA = DATABASE()`
  const metadata = await executeSql<MysqlColumnMetadata>(
    sql`
      SELECT DATA_TYPE AS data_type, COLUMN_DEFAULT AS column_default, EXTRA AS extra
      FROM information_schema.columns
      WHERE ${schemaFilter}
        AND TABLE_NAME = ${table.tableName}
        AND COLUMN_NAME = ${idFieldName}
      LIMIT 1
    `,
  )

  return isMysqlUuidDefault(metadata.rows[0]) ? randomUUID() : undefined
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "create",
 *   "displayName": "创建记录",
 *   "category": "database",
 *   "description": "向 table 插入一条记录，并把物理 idField 映射为标准输出 uuid。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "数据源名称，对应 ${datasource}_DATABASE_URL。" },
 *     { "key": "table", "type": "string", "required": true, "description": "数据库表名，支持 schema.table。" },
 *     { "key": "fields", "type": "Record<string, unknown>", "required": true, "description": "待插入字段和值。" },
 *     { "key": "idField", "type": "string", "required": true, "description": "插入后返回或读取的唯一 ID 字段。" }
 *   ],
 *   "outputs": [
 *     { "key": "uuid", "type": "string|number", "description": "插入记录的唯一 ID。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_INVALID_TABLE", "description": "table 为空或不是合法 SQL 标识符。" },
 *     { "code": "BLOCK_INVALID_FIELDS", "description": "fields 不是非空对象或字段名非法。" },
 *     { "code": "BLOCK_INVALID_ID_FIELD", "description": "idField 为空或不是合法字段名。" },
 *     { "code": "BLOCK_CREATE_MISSING_ID", "description": "插入成功但无法得到唯一 ID。" },
 *     { "code": "BLOCK_DUPLICATE_RECORD", "description": "数据库唯一约束冲突。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要 datasource；Postgres 使用 RETURNING，MySQL 使用 insertId 或 fields/idField。" }
 *   ],
 *   "examples": [
 *     { "title": "创建页面", "block": { "uuid": "create_page", "functionName": "create", "inputs": { "datasource": "Mokelay", "table": "pages", "idField": "uuid", "fields": { "name": { "template": "{{request.body.name}}" }, "blocks": [] } }, "outputs": ["uuid"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeCreateBlock: BlockExecutor = async ({ inputs, executeSql, databaseType }) => {
  const actualDatabaseType = requireDatabaseType(databaseType)
  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const fields = { ...getFieldValues(inputs.fields) }
  const idField = getCreateIdField(inputs.idField)
  const generatedMysqlId = actualDatabaseType === 'mysql'
    ? await mysqlGeneratedIdValue(inputs.table, idField.fieldName, fields, executeSql)
    : undefined

  if (generatedMysqlId) {
    fields[idField.fieldName] = generatedMysqlId
  }

  const columns = Object.keys(fields)
  const columnSql = sql.join(columns.map((field) => identifierSql(field, 'fields', 'BLOCK_INVALID_FIELDS')), sql`, `)
  const valueSql = sql.join(columns.map((field) => fieldValueSql(fields[field], actualDatabaseType)), sql`, `)

  try {
    const result = actualDatabaseType === 'postgres'
      ? await executeSql(sql`INSERT INTO ${table} (${columnSql}) VALUES (${valueSql}) RETURNING ${idField.fieldSql}`)
      : await executeSql(sql`INSERT INTO ${table} (${columnSql}) VALUES (${valueSql})`)
    const uuid = actualDatabaseType === 'postgres'
      ? result.rows[0]?.[idField.fieldName]
      : isPresentId(fields[idField.fieldName])
        ? fields[idField.fieldName]
        : isPresentId(result.insertId)
          ? result.insertId
          : fields[idField.fieldName]

    if (uuid === undefined || uuid === null || uuid === '') {
      throw mokelayError('BLOCK_CREATE_MISSING_ID', 'create Block 未返回插入记录的唯一 ID。', 500)
    }

    return { uuid }
  } catch (error) {
    if (isDuplicateRecordError(error)) {
      throw mokelayError('BLOCK_DUPLICATE_RECORD', '记录已经存在。', 409, error)
    }

    throw error
  }
}
