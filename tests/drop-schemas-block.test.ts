import { type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import { executeDropSchemasBlock } from '../src/utils/blocks/dropSchemas.js'
import { blockDefinitions } from '../src/utils/blocks/index.js'
import type { SqlExecutionResult, TransactionRunner } from '../src/utils/db.js'
import type { SqlExecutor } from '../src/utils/orchestration-schema.js'

const dialect = new PgDialect()

function createHarness() {
  const queries: string[] = []
  const executeSql: SqlExecutor = async <T extends Record<string, unknown>>(query: SQL): Promise<SqlExecutionResult<T>> => {
    queries.push(dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim())
    return { databaseType: 'postgres', rows: [] }
  }
  const withTransaction = vi.fn(async callback => await callback(executeSql)) as TransactionRunner
  return { queries, withTransaction }
}

async function runDrop(inputs: Record<string, unknown>, databaseType = 'postgres', withTransaction?: TransactionRunner) {
  return await executeDropSchemasBlock({
    event: {} as never,
    block: {} as never,
    inputs,
    executeSql: vi.fn() as never,
    databaseType: databaseType as never,
    withTransaction,
    processValue: vi.fn() as never,
    invokeFragment: vi.fn() as never,
  })
}

describe('dropSchemas block', () => {
  it('deduplicates and drops schemas without CASCADE by default', async () => {
    const harness = createHarness()
    await expect(runDrop({ datasource: 'Free', schemas: ['e_one', 'e_one', 'e_two'] }, 'postgres', harness.withTransaction))
      .resolves.toEqual({ schemas: ['e_one', 'e_two'], dropped: 2 })
    expect(harness.queries).toEqual([
      'DROP SCHEMA IF EXISTS "e_one"',
      'DROP SCHEMA IF EXISTS "e_two"',
    ])
  })

  it('adds CASCADE only when explicitly true', async () => {
    const harness = createHarness()
    await runDrop({ datasource: 'Free', schemas: ['e_one'], cascade: true }, 'postgres', harness.withTransaction)
    expect(harness.queries).toEqual(['DROP SCHEMA IF EXISTS "e_one" CASCADE'])
  })

  it('accepts an empty list without opening a transaction', async () => {
    const withTransaction = vi.fn() as never
    await expect(runDrop({ datasource: 'Free', schemas: [] }, 'postgres', withTransaction))
      .resolves.toEqual({ schemas: [], dropped: 0 })
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it.each(['public', 'information_schema', 'pg_temp_1', '1bad', 'a.b', ''])(
    'rejects dangerous or invalid schema %j',
    async schema => {
      await expect(runDrop({ datasource: 'Free', schemas: [schema] }))
        .rejects.toMatchObject({ data: { code: 'BLOCK_INVALID_SCHEMA' } })
    },
  )

  it('rejects non-PostgreSQL datasources and invalid cascade values', async () => {
    await expect(runDrop({ datasource: 'Free', schemas: ['e_one'] }, 'mysql'))
      .rejects.toMatchObject({ data: { code: 'BLOCK_DATASOURCE_UNSUPPORTED_DATABASE' } })
    await expect(runDrop({ datasource: 'Free', schemas: ['e_one'], cascade: 'true' }))
      .rejects.toMatchObject({ data: { code: 'BLOCK_INVALID_SCHEMA' } })
  })

  it('registers the documented outputs', () => {
    expect(blockDefinitions.dropSchemas).toMatchObject({
      allowedOutputs: ['schemas', 'dropped'],
      requiresDatasource: true,
    })
  })
})

