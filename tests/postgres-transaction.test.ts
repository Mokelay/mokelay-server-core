import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const execute = vi.fn(async () => [{ value: 1 }])
  const transaction = vi.fn(async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => (
    await callback({ execute })
  ))
  const begin = vi.fn(() => {
    throw new Error('postgres.js transaction clients must not be re-wrapped with drizzle()')
  })
  const end = vi.fn(async () => undefined)
  const client = { begin, end }
  const postgresFactory = vi.fn(() => client)
  const drizzlePostgres = vi.fn(() => ({ transaction }))

  return {
    begin,
    client,
    drizzlePostgres,
    end,
    execute,
    postgresFactory,
    transaction,
  }
})

vi.mock('postgres', () => ({ default: mocks.postgresFactory }))
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: mocks.drizzlePostgres }))

import { closeDatasourceConnection, executeDatasourceTransaction } from '../src/utils/db.js'

const datasource = 'TransactionPgTest'

describe('PostgreSQL datasource transactions', () => {
  beforeEach(() => {
    process.env[`${datasource}_DATABASE_URL`] = 'postgres://user:password@localhost/database'
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await closeDatasourceConnection(datasource)
    delete process.env[`${datasource}_DATABASE_URL`]
  })

  it('uses the existing Drizzle database transaction without re-wrapping the postgres.js transaction client', async () => {
    const result = await executeDatasourceTransaction(datasource, async (executeSql) => (
      await executeSql<{ value: number }>(sql`select 1 as value`)
    ), {
      isolationLevel: 'repeatable read',
      retries: 0,
    })

    expect(result.rows).toEqual([{ value: 1 }])
    expect(mocks.drizzlePostgres).toHaveBeenCalledTimes(1)
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'repeatable read',
    })
    expect(mocks.begin).not.toHaveBeenCalled()
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })
})
