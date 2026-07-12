import { type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { executeCreateSchemaBlock } from '../src/utils/blocks/createSchema.js'
import { blockDefinitions } from '../src/utils/blocks/index.js'
import { toMokelayErrorResponse } from '../src/utils/mokelay-error.js'
import type { DatabaseType, SqlExecutionResult } from '../src/utils/db.js'

const pgDialect = new PgDialect()

function normalizeSql(query: SQL) {
  const builtQuery = pgDialect.sqlToQuery(query)

  return {
    sql: builtQuery.sql.replace(/\s+/g, ' ').trim(),
    params: builtQuery.params,
  }
}

function createExecutor(options: { duplicate?: boolean } = {}) {
  const queries: ReturnType<typeof normalizeSql>[] = []
  const executeSql = async <T extends Record<string, unknown> = Record<string, unknown>>(
    query: SQL,
  ): Promise<SqlExecutionResult<T>> => {
    queries.push(normalizeSql(query))

    if (options.duplicate) {
      throw Object.assign(new Error('schema already exists'), { code: '42P06' })
    }

    return {
      databaseType: 'postgres',
      rows: [] as T[],
    }
  }

  return { executeSql, queries }
}

async function runCreateSchemaBlock(
  inputs: Record<string, unknown>,
  databaseType: DatabaseType = 'postgres',
  executeSql = createExecutor().executeSql,
) {
  return await executeCreateSchemaBlock({
    event: {} as never,
    block: {} as never,
    inputs,
    executeSql,
    databaseType,
  })
}

describe('createSchema block', () => {
  it('creates a Postgres schema and returns status outputs', async () => {
    const { executeSql, queries } = createExecutor()
    const result = await runCreateSchemaBlock({ datasource: 'MokelayFree', schema: 'e_abc123' }, 'postgres', executeSql)

    expect(result).toEqual({
      schema: 'e_abc123',
      created: true,
      exists: true,
    })
    expect(queries).toEqual([
      {
        sql: 'CREATE SCHEMA "e_abc123"',
        params: [],
      },
    ])
  })

  it('returns exists=true when the schema already exists', async () => {
    const { executeSql, queries } = createExecutor({ duplicate: true })
    const result = await runCreateSchemaBlock({ datasource: 'MokelayFree', schema: 'e_abc123' }, 'postgres', executeSql)

    expect(result).toEqual({
      schema: 'e_abc123',
      created: false,
      exists: true,
    })
    expect(queries[0]?.sql).toBe('CREATE SCHEMA "e_abc123"')
  })

  it('rejects non-Postgres datasources', async () => {
    await expect(runCreateSchemaBlock({ datasource: 'BingX', schema: 'e_abc123' }, 'mysql'))
      .rejects.toMatchObject({
        data: { code: 'BLOCK_DATASOURCE_UNSUPPORTED_DATABASE' },
      })
  })

  it.each(['abc.def', '1abc', 'pg_temp_test', 'public', 'information_schema', ''])(
    'rejects invalid schema name %j',
    async (schemaName) => {
      try {
        await runCreateSchemaBlock({ datasource: 'MokelayFree', schema: schemaName })
        throw new Error('Expected createSchema to reject.')
      } catch (error) {
        expect(toMokelayErrorResponse(error).error.code).toBe('BLOCK_INVALID_SCHEMA')
      }
    },
  )

  it('registers the documented outputs', () => {
    expect(blockDefinitions.createSchema).toMatchObject({
      allowedOutputs: ['schema', 'created', 'exists'],
      requiresDatasource: true,
    })
  })
})
