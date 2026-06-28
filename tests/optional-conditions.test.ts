import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, createRouter, toNodeListener } from 'h3'
import { createMokelayOrchestrationHandler } from '../src/utils/orchestration.js'
import type { DatabaseType, SqlExecutionResult } from '../src/utils/db.js'

const servers: Server[] = []
const pgDialect = new PgDialect()

type RecordedQuery = {
  sql: string
  params: unknown[]
}

async function startServer(handler: ReturnType<typeof createMokelayOrchestrationHandler>) {
  const app = createApp()
  const router = createRouter()

  router.use('/api/mokelay/:apiJsonUuid', handler)
  app.use(router)

  const server = createServer(toNodeListener(app))
  servers.push(server)

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

function normalizeSql(query: SQL) {
  const builtQuery = pgDialect.sqlToQuery(query)
  return {
    sql: builtQuery.sql.replace(/\s+/g, ' ').trim(),
    params: builtQuery.params,
  }
}

function optionalSearchApiJson(overrides: Record<string, unknown> = {}) {
  return {
    uuid: 'optional_conditions_test',
    method: 'GET',
    request: {
      query: [
        { key: 'uuid', processors: ['trim'] },
        { key: 'name', processors: ['trim'] },
        { key: 'created_at_begin', processors: ['trim'] },
        { key: 'created_at_end', processors: ['trim'] },
      ],
    },
    blocks: [
      { uuid: 'starter', nextBlock: 'page_users' },
      {
        uuid: 'page_users',
        functionName: 'page',
        inputs: {
          datasource: 'Mokelay',
          table: 'users',
          fields: ['id', 'name', 'created_at'],
          conditions: [
            {
              group: false,
              conditionType: 'EQ',
              fieldName: 'id',
              fieldValue: { template: '{{request.query.uuid}}' },
              optional: true,
            },
            {
              group: false,
              conditionType: 'EQ',
              fieldName: 'name',
              fieldValue: { template: '{{request.query.name}}' },
              optional: true,
            },
            {
              group: false,
              conditionType: 'GE',
              fieldName: 'created_at',
              fieldValue: { template: '{{request.query.created_at_begin}}' },
              optional: true,
            },
            {
              group: false,
              conditionType: 'LE',
              fieldName: 'created_at',
              fieldValue: { template: '{{request.query.created_at_end}}' },
              optional: true,
            },
          ],
        },
        outputs: ['datas', 'total'],
        nextBlock: null,
      },
    ],
    response: {
      datas: { template: "{{blocks['page_users'].outputs.datas}}" },
      total: { template: "{{blocks['page_users'].outputs.total}}" },
    },
    ...overrides,
  }
}

async function requestWithRecordedSql(rawApiJson: unknown, query = '') {
  const queries: RecordedQuery[] = []
  const originalUrl = process.env.Mokelay_DATABASE_URL
  process.env.Mokelay_DATABASE_URL = 'postgres://unit-test'

  try {
    const handler = createMokelayOrchestrationHandler({
      loadApiJson: async () => rawApiJson,
      executeSql: async <T extends Record<string, unknown> = Record<string, unknown>>(
        sqlQuery: SQL,
        _datasource: string,
        databaseType: DatabaseType,
      ): Promise<SqlExecutionResult<T>> => {
        const recorded = normalizeSql(sqlQuery)
        queries.push(recorded)

        return {
          databaseType,
          rows: recorded.sql.startsWith('SELECT count(*)::int AS total')
            ? [{ total: 0 }] as unknown as T[]
            : [] as unknown as T[],
        }
      },
    })
    const baseUrl = await startServer(handler)
    const response = await fetch(`${baseUrl}/api/mokelay/optional_conditions_test${query}`)
    const body = await response.json() as Record<string, unknown>

    return { body, queries }
  } finally {
    if (originalUrl === undefined) {
      delete process.env.Mokelay_DATABASE_URL
    } else {
      process.env.Mokelay_DATABASE_URL = originalUrl
    }
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })))
})

describe('optional conditions', () => {
  it('skips empty optional conditions', async () => {
    const { body, queries } = await requestWithRecordedSql(
      optionalSearchApiJson(),
      '?uuid=&name=&created_at_begin=&created_at_end=',
    )

    expect(body).toEqual({
      ok: true,
      data: {
        datas: [],
        total: 0,
      },
    })
    expect(queries).toHaveLength(2)
    expect(queries[0].sql).not.toContain(' WHERE ')
    expect(queries[1].sql).not.toContain(' WHERE ')
  })

  it('keeps non-empty optional conditions', async () => {
    const createdAtBegin = '2026-01-01T00:00:00.000Z'
    const { queries } = await requestWithRecordedSql(
      optionalSearchApiJson(),
      `?name=Ada&created_at_begin=${encodeURIComponent(createdAtBegin)}`,
    )

    expect(queries[0].sql).toContain(' WHERE ')
    expect(queries[0].sql).toContain('"name" =')
    expect(queries[0].sql).toContain('"created_at" >=')
    expect(queries[0].sql).not.toContain('"id" =')
    expect(queries[0].params).toContain('Ada')
    expect(queries[0].params).toContain(createdAtBegin)
  })

  it('preserves existing required condition behavior', async () => {
    const { queries } = await requestWithRecordedSql(optionalSearchApiJson({
      blocks: [
        { uuid: 'starter', nextBlock: 'page_users' },
        {
          uuid: 'page_users',
          functionName: 'page',
          inputs: {
            datasource: 'Mokelay',
            table: 'users',
            fields: ['id', 'name'],
            conditions: [
              {
                group: false,
                conditionType: 'EQ',
                fieldName: 'name',
                fieldValue: { template: '{{request.query.name}}' },
              },
            ],
          },
          outputs: ['datas', 'total'],
          nextBlock: null,
        },
      ],
    }))

    expect(queries[0].sql).toContain(' WHERE ')
    expect(queries[0].sql).toContain('"name" =')
  })
})
