import { sql } from 'drizzle-orm'
import { type BlockExecutor } from '../orchestration-schema.js'
import { mokelayError } from '../mokelay-error.js'
import { isRecord, requireDatabaseType } from './shared.js'

const schemaNamePattern = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/
const duplicateSchemaErrorCode = '42P06'

function normalizeSchemaName(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError('BLOCK_INVALID_SCHEMA', 'schema 必须是非空字符串。', 400)
  }

  const schemaName = value.trim()
  const lowerSchemaName = schemaName.toLowerCase()

  if (
    !schemaNamePattern.test(schemaName)
    || schemaName.includes('.')
    || lowerSchemaName === 'public'
    || lowerSchemaName === 'information_schema'
    || lowerSchemaName.startsWith('pg_')
  ) {
    throw mokelayError(
      'BLOCK_INVALID_SCHEMA',
      'schema 只能包含字母、数字、下划线，必须以字母或下划线开头，长度不超过 63，且不能使用 Postgres 保留 schema。',
      400,
    )
  }

  return schemaName
}

function isDuplicateSchemaError(error: unknown) {
  return isRecord(error) && error.code === duplicateSchemaErrorCode
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "createSchema",
 *   "displayName": "创建 Postgres Schema",
 *   "category": "database",
 *   "description": "在 Postgres datasource 中创建一个 schema；已存在时不失败，并返回 exists=true。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "数据源名称，对应 ${datasource}_DATABASE_URL，必须是 Postgres。" },
 *     { "key": "schema", "type": "string", "required": true, "description": "要创建的 schema 名称，只允许安全 SQL 标识符。" }
 *   ],
 *   "outputs": [
 *     { "key": "schema", "type": "string", "description": "最终创建或确认存在的 schema 名称。" },
 *     { "key": "created", "type": "boolean", "description": "本次调用是否新建了 schema。" },
 *     { "key": "exists", "type": "boolean", "description": "调用结束后 schema 是否存在。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_DATABASE_TYPE_MISSING", "description": "执行器未获得数据库类型。" },
 *     { "code": "BLOCK_DATASOURCE_UNSUPPORTED_DATABASE", "description": "datasource 不是 Postgres。" },
 *     { "code": "BLOCK_INVALID_SCHEMA", "description": "schema 为空、格式非法或使用 Postgres 保留 schema。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要 datasource，并通过该连接执行 CREATE SCHEMA。" }
 *   ],
 *   "examples": [
 *     { "title": "创建企业免费数据库 schema", "block": { "uuid": "create_enterprise_schema", "functionName": "createSchema", "inputs": { "datasource": "MokelayFree", "schema": "e_abc123" }, "outputs": ["schema", "created", "exists"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeCreateSchemaBlock: BlockExecutor = async ({ inputs, executeSql, databaseType }) => {
  const actualDatabaseType = requireDatabaseType(databaseType)
  const schemaName = normalizeSchemaName(inputs.schema)

  if (actualDatabaseType !== 'postgres') {
    throw mokelayError('BLOCK_DATASOURCE_UNSUPPORTED_DATABASE', 'createSchema Block 仅支持 Postgres datasource。', 400)
  }

  try {
    await executeSql(sql`CREATE SCHEMA ${sql.identifier(schemaName)}`)

    return {
      schema: schemaName,
      created: true,
      exists: true,
    }
  } catch (error) {
    if (isDuplicateSchemaError(error)) {
      return {
        schema: schemaName,
        created: false,
        exists: true,
      }
    }

    throw error
  }
}
