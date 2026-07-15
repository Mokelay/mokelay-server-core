import { sql } from 'drizzle-orm'
import { mokelayError } from '../mokelay-error.js'
import { type BlockExecutor } from '../orchestration-schema.js'

const schemaNamePattern = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/

export function normalizeSchemaNames(value: unknown) {
  if (!Array.isArray(value)) {
    throw mokelayError('BLOCK_INVALID_SCHEMA', 'schemas 必须是数组。', 400)
  }

  const schemaNames: string[] = []
  const seen = new Set<string>()

  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      throw mokelayError('BLOCK_INVALID_SCHEMA', 'schemas 中的名称必须是非空字符串。', 400)
    }

    const schemaName = item.trim()
    const lowerSchemaName = schemaName.toLowerCase()

    if (
      !schemaNamePattern.test(schemaName)
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

    if (!seen.has(schemaName)) {
      seen.add(schemaName)
      schemaNames.push(schemaName)
    }
  }

  return schemaNames
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "dropSchemas",
 *   "displayName": "删除 Postgres Schemas",
 *   "category": "database",
 *   "description": "在一个 Postgres 数据源事务中幂等删除多个安全 Schema；cascade 默认 false。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "Schema 所在的 Postgres 数据源。" },
 *     { "key": "schemas", "type": "string[]", "required": true, "description": "待删除的安全 Schema 名称数组；允许空数组。" },
 *     { "key": "cascade", "type": "boolean", "required": false, "default": false, "description": "是否追加 CASCADE 删除 Schema 内对象。" }
 *   ],
 *   "outputs": [
 *     { "key": "schemas", "type": "string[]", "description": "已完成幂等删除处理的去重 Schema 名称。" },
 *     { "key": "dropped", "type": "number", "description": "已处理 Schema 数量；原本不存在的 Schema 也计入。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_INVALID_SCHEMA", "description": "schemas 或 cascade 无效，或包含非法、危险及保留 Schema 名称。" },
 *     { "code": "BLOCK_DATASOURCE_UNSUPPORTED_DATABASE", "description": "datasource 不是 Postgres。" },
 *     { "code": "BLOCK_SQL_UNSUPPORTED", "description": "执行器未提供事务运行器。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要 Postgres datasource，并在同一个连接事务中执行全部 DROP SCHEMA。" }
 *   ],
 *   "examples": [
 *     { "title": "删除业务 Schemas", "block": { "uuid": "drop_schemas", "functionName": "dropSchemas", "inputs": { "datasource": "MokelayFree", "schemas": ["e_abc123"], "cascade": true }, "outputs": ["schemas", "dropped"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeDropSchemasBlock: BlockExecutor = async ({
  inputs,
  databaseType,
  withTransaction,
}) => {
  const schemaNames = normalizeSchemaNames(inputs.schemas)

  if (inputs.cascade !== undefined && typeof inputs.cascade !== 'boolean') {
    throw mokelayError('BLOCK_INVALID_SCHEMA', 'cascade 必须是 boolean。', 400)
  }

  if (databaseType !== 'postgres') {
    throw mokelayError(
      'BLOCK_DATASOURCE_UNSUPPORTED_DATABASE',
      'dropSchemas Block 仅支持 Postgres datasource。',
      400,
    )
  }

  if (schemaNames.length === 0) {
    return { schemas: [], dropped: 0 }
  }

  if (!withTransaction) {
    throw mokelayError(
      'BLOCK_SQL_UNSUPPORTED',
      'dropSchemas Block 必须在 datasource transaction runner 中执行。',
      500,
    )
  }

  const cascade = inputs.cascade === true

  await withTransaction(async (executeSql) => {
    for (const schemaName of schemaNames) {
      await executeSql(cascade
        ? sql`DROP SCHEMA IF EXISTS ${sql.identifier(schemaName)} CASCADE`
        : sql`DROP SCHEMA IF EXISTS ${sql.identifier(schemaName)}`)
    }
  })

  return {
    schemas: schemaNames,
    dropped: schemaNames.length,
  }
}

