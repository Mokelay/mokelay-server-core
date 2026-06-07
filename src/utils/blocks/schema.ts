import { sql } from 'drizzle-orm'
import { mapDatabaseSchemaRows, type DatabaseSchemaQueryRow } from '../database-schema.js'
import { type BlockExecutor } from '../orchestration-schema.js'
import { requireDatabaseType } from './shared.js'

/**
 * schema block
 * 作用：读取 datasource 当前默认 schema/database 的基础表和列信息。
 * inputs：datasource 数据源。
 * outputs：tables，值为表结构数组。
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
