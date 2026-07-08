import { sql } from 'drizzle-orm'
import { mapDatabaseSchemaRows, type DatabaseSchemaQueryRow } from '../database-schema.js'
import { type BlockExecutor } from '../orchestration-schema.js'
import { requireDatabaseType } from './shared.js'

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "schema",
 *   "displayName": "读取数据库结构",
 *   "category": "database",
 *   "description": "读取 datasource 当前默认 schema/database 的基础表和列信息。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "数据源名称，对应 ${datasource}_DATABASE_URL。" }
 *   ],
 *   "outputs": [
 *     { "key": "tables", "type": "DatabaseSchemaTable[]", "description": "表结构数组，包含表名和列信息。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_DATABASE_TYPE_MISSING", "description": "执行器未获得数据库类型。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要 datasource，并使用 information_schema 或 pg_catalog 查询结构。" }
 *   ],
 *   "examples": [
 *     { "title": "读取 Mokelay 数据库结构", "block": { "uuid": "schema_block", "functionName": "schema", "inputs": { "datasource": "Mokelay" }, "outputs": ["tables"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeSchemaBlock: BlockExecutor = async ({ executeSql, databaseType }) => {
  const actualDatabaseType = requireDatabaseType(databaseType)
  const query = actualDatabaseType === 'postgres'
    ? sql`
      SELECT
        cls.relname AS "tableName",
        att.attname AS "columnName",
        CASE
          WHEN att.attname IS NULL THEN NULL
          ELSE pg_catalog.format_type(att.atttypid, att.atttypmod)
        END AS "columnType"
      FROM pg_catalog.pg_class cls
      JOIN pg_catalog.pg_namespace ns
        ON ns.oid = cls.relnamespace
      LEFT JOIN pg_catalog.pg_attribute att
        ON att.attrelid = cls.oid
        AND att.attnum > 0
        AND NOT att.attisdropped
      WHERE ns.nspname = 'public'
        AND cls.relkind = 'r'
      ORDER BY cls.relname ASC, att.attnum ASC
    `
    : sql`
      SELECT
        tbl.TABLE_NAME AS tableName,
        col.COLUMN_NAME AS columnName,
        col.COLUMN_TYPE AS columnType
      FROM information_schema.tables tbl
      LEFT JOIN information_schema.columns col
        ON col.TABLE_SCHEMA = tbl.TABLE_SCHEMA
        AND col.TABLE_NAME = tbl.TABLE_NAME
      WHERE tbl.TABLE_SCHEMA = DATABASE()
        AND tbl.TABLE_TYPE = 'BASE TABLE'
      ORDER BY tbl.TABLE_NAME ASC, col.ORDINAL_POSITION ASC
    `
  const result = await executeSql<DatabaseSchemaQueryRow>(query)

  return {
    tables: mapDatabaseSchemaRows(result.rows),
  }
}
