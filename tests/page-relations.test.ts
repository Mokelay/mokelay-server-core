import { type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { executePageBlock } from '../src/utils/blocks/page.js'
import type { SqlExecutionResult } from '../src/utils/db.js'

const pgDialect = new PgDialect()

type RecordedQuery = {
  sql: string
  params: unknown[]
}

function normalizeSql(query: SQL) {
  const builtQuery = pgDialect.sqlToQuery(query)

  return {
    sql: builtQuery.sql.replace(/\s+/g, ' ').trim(),
    params: builtQuery.params,
  }
}

function createExecutor(rowsByCall: Array<Array<Record<string, unknown>>>) {
  const queries: RecordedQuery[] = []
  let callIndex = 0
  const executeSql = async <T extends Record<string, unknown> = Record<string, unknown>>(
    query: SQL,
  ): Promise<SqlExecutionResult<T>> => {
    queries.push(normalizeSql(query))
    const rows = rowsByCall[callIndex++] ?? []

    return {
      databaseType: 'postgres',
      rows: rows as T[],
    }
  }

  return { executeSql, queries }
}

async function runPageBlock(inputs: Record<string, unknown>, rowsByCall: Array<Array<Record<string, unknown>>> = []) {
  const { executeSql, queries } = createExecutor(rowsByCall)
  const result = await executePageBlock({
    event: {} as never,
    block: {
      uuid: 'page_test',
      functionName: 'page',
      inputs,
      nextBlock: null,
    },
    inputs,
    executeSql,
    databaseType: 'postgres',
  })

  return { result, queries }
}

const employeePageInputs = {
  datasource: 'Mokelay',
  table: 'employees',
  fields: [
    'id',
    'enterprise_uuid',
    'name',
    'email',
    'plan',
    'created_at',
    'updated_at',
  ],
  relations: [
    {
      type: 'left',
      table: 'enterprise',
      alias: 'enterprise',
      localField: 'enterprise_uuid',
      foreignField: 'uuid',
      fields: [
        {
          field: 'name',
          as: 'enterprise_name',
        },
      ],
    },
  ],
  conditions: [
    {
      group: false,
      conditionType: 'LIKE',
      fieldName: 'name',
      fieldValue: 'Carl',
    },
    {
      group: false,
      conditionType: 'EQ',
      fieldName: 'enterprise.name',
      fieldValue: 'Mokelay',
    },
  ],
  orderBy: [
    {
      fieldName: 'updated_at',
      direction: 'DESC',
    },
  ],
  page: '2',
  pageSize: '1',
}

describe('page block relations', () => {
  it('reads relation fields with aliases and keeps pagination totals consistent', async () => {
    const { result, queries } = await runPageBlock(employeePageInputs, [
      [
        {
          id: 'employee-1',
          enterprise_uuid: 'enterprise-1',
          enterprise_name: 'Mokelay',
          name: 'Carl',
          email: 'carl@example.com',
          plan: 'free',
          created_at: '2026-07-12T00:00:00.000Z',
          updated_at: '2026-07-12T01:00:00.000Z',
        },
      ],
      [{ total: 3 }],
    ])

    expect(result).toMatchObject({
      datas: [
        expect.objectContaining({
          id: 'employee-1',
          enterprise_name: 'Mokelay',
        }),
      ],
      total: 3,
      totalPages: 3,
      page: 2,
      pageSize: 1,
      hasPreviousPage: true,
      hasNextPage: true,
    })
    expect(queries).toHaveLength(2)
    expect(queries[0].sql).toContain('FROM "employees" AS "__page_base" LEFT JOIN "enterprise" AS "enterprise"')
    expect(queries[0].sql).toContain('ON "__page_base"."enterprise_uuid" = "enterprise"."uuid"')
    expect(queries[0].sql).toContain('"enterprise"."name" AS "enterprise_name"')
    expect(queries[0].sql).toContain('LOWER("__page_base"."name") LIKE LOWER($1)')
    expect(queries[0].sql).toContain('"enterprise"."name" = $2')
    expect(queries[0].sql).toContain('ORDER BY "__page_base"."updated_at" DESC')
    expect(queries[0].params).toEqual(['%Carl%', 'Mokelay', 1, 1])
    expect(queries[1].sql).toContain('SELECT count(*)::int AS total FROM "employees" AS "__page_base" LEFT JOIN "enterprise" AS "enterprise"')
    expect(queries[1].sql).toContain('WHERE (LOWER("__page_base"."name") LIKE LOWER($1)) AND ("enterprise"."name" = $2)')
    expect(queries[1].params).toEqual(['%Carl%', 'Mokelay'])
  })

  it('keeps left-joined rows when the relation is missing', async () => {
    const { result } = await runPageBlock({
      ...employeePageInputs,
      conditions: [],
      page: 1,
      pageSize: 20,
    }, [
      [
        {
          id: 'employee-2',
          enterprise_uuid: 'missing-enterprise',
          enterprise_name: null,
          name: 'No Enterprise',
        },
      ],
      [{ total: 1 }],
    ])

    expect(result.datas).toEqual([
      expect.objectContaining({
        id: 'employee-2',
        enterprise_name: null,
      }),
    ])
    expect(result).toMatchObject({
      total: 1,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    })
  })

  it('requires aliases for relation output fields', async () => {
    await expect(runPageBlock({
      datasource: 'Mokelay',
      table: 'employees',
      fields: ['id'],
      relations: [
        {
          table: 'enterprise',
          alias: 'enterprise',
          localField: 'enterprise_uuid',
          foreignField: 'uuid',
          fields: [
            {
              field: 'name',
            },
          ],
        },
      ],
    })).rejects.toMatchObject({
      data: { code: 'BLOCK_INVALID_FIELDS' },
    })
  })
})
