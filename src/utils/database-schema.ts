import { sql } from 'drizzle-orm'
import { useDb } from './db.js'

export type DatabaseColumnSchema = {
  name: string
  type: string
  dataType: string
}

export type DatabaseTableSchema = {
  name: string
  columns: DatabaseColumnSchema[]
}

type DatabaseSchemaQueryRow = {
  tableName: string
  columnName: string | null
  columnType: string | null
}

export function mapDatabaseSchemaRows(rows: DatabaseSchemaQueryRow[]): DatabaseTableSchema[] {
  const tables = new Map<string, DatabaseTableSchema>()

  for (const row of rows) {
    let table = tables.get(row.tableName)

    if (!table) {
      table = {
        name: row.tableName,
        columns: [],
      }
      tables.set(row.tableName, table)
    }

    if (row.columnName && row.columnType) {
      table.columns.push({
        name: row.columnName,
        type: row.columnType,
        dataType: row.columnType,
      })
    }
  }

  return Array.from(tables.values())
}

export async function listDatabaseSchema(): Promise<DatabaseTableSchema[]> {
  const rows = await useDb().execute<DatabaseSchemaQueryRow>(sql`
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
  `)

  return mapDatabaseSchemaRows(rows)
}
