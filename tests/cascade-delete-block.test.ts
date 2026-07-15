import { type SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import { executeCascadeDeleteBlock } from '../src/utils/blocks/cascadeDelete.js'
import { blockDefinitions } from '../src/utils/blocks/index.js'
import type { DatabaseType, SqlExecutionResult, TransactionRunner } from '../src/utils/db.js'
import type { ProcessValue, SqlExecutor } from '../src/utils/orchestration-schema.js'

const dialects = {
  postgres: new PgDialect(),
  mysql: new MySqlDialect(),
}

function normalizeSql(query: SQL, databaseType: DatabaseType) {
  const built = dialects[databaseType].sqlToQuery(query)
  return { sql: built.sql.replace(/\s+/g, ' ').trim(), params: built.params }
}

type ResultFactory = (
  normalized: ReturnType<typeof normalizeSql>,
) => Partial<SqlExecutionResult<Record<string, unknown>>>

function createHarness(databaseType: DatabaseType, resultFactory: ResultFactory) {
  const queries: ReturnType<typeof normalizeSql>[] = []
  const executeSql: SqlExecutor = async (query) => {
    const normalized = normalizeSql(query, databaseType)
    queries.push(normalized)
    const result = resultFactory(normalized)
    return {
      databaseType,
      rows: result.rows ?? [],
      affectedRows: result.affectedRows,
    }
  }
  const withTransaction = vi.fn(async (callback, _options) => await callback(executeSql)) as TransactionRunner
  return { queries, executeSql, withTransaction }
}

const root = {
  id: 'enterprise',
  table: 'enterprise',
  keyField: 'uuid',
  conditions: [{
    group: false,
    fieldName: 'uuid',
    fieldValue: 'enterprise-1',
    conditionType: 'EQ',
  }],
}

async function runCascade(options: {
  inputs: Record<string, unknown>
  databaseType?: DatabaseType
  withTransaction?: TransactionRunner
  processValue?: ProcessValue
}) {
  return await executeCascadeDeleteBlock({
    event: {} as never,
    block: {} as never,
    inputs: options.inputs,
    executeSql: vi.fn() as never,
    databaseType: options.databaseType ?? 'postgres',
    withTransaction: options.withTransaction,
    processValue: options.processValue ?? (async value => value),
    invokeFragment: vi.fn() as never,
  })
}

describe('cascadeDelete block', () => {
  it('locks parent-first, collects before DELETE, and deletes a PostgreSQL graph child-first', async () => {
    const deleteCounts: Record<string, number> = {
      employee_auth_identities: 3,
      datasources: 3,
      employees: 2,
      enterprise: 1,
    }
    const processValue = vi.fn<ProcessValue>(async (value) => {
      expect(harness.queries.every(query => !query.sql.startsWith('DELETE'))).toBe(true)
      return value
    })
    const harness = createHarness('postgres', ({ sql: text }) => {
      if (text.startsWith('SELECT') && text.includes('FROM "enterprise"')) {
        return { rows: [{ __cascade_key: 'enterprise-1' }] }
      }
      if (text.startsWith('SELECT') && text.includes('FROM "employees"')) {
        return { rows: [{ __cascade_key: 10 }, { __cascade_key: 11 }] }
      }
      if (text.startsWith('SELECT') && text.includes('FROM "datasources"')) {
        return { rows: [
          { __cascade_key: 20, __cascade_value_0: 'e_two' },
          { __cascade_key: 21, __cascade_value_0: 'e_one' },
          { __cascade_key: 22, __cascade_value_0: 'e_one' },
        ] }
      }
      if (text.startsWith('SELECT') && text.includes('FROM "employee_auth_identities"')) {
        return { rows: [{ __cascade_key: 30 }, { __cascade_key: 31 }, { __cascade_key: 32 }] }
      }
      const table = Object.keys(deleteCounts).find(name => text.startsWith(`DELETE FROM "${name}"`))
      return table ? { rows: Array.from({ length: deleteCounts[table]! }, () => ({ affected_marker: 1 })) } : {}
    })

    const result = await runCascade({
      inputs: {
        datasource: 'Mokelay',
        root,
        relations: [
          { id: 'employees', table: 'employees', keyField: 'id', parent: 'enterprise', foreignKey: 'enterprise_uuid' },
          { id: 'datasources', table: 'datasources', keyField: 'id', parent: 'enterprise', foreignKey: 'enterprise_uuid' },
          { id: 'identities', table: 'employee_auth_identities', keyField: 'id', parent: 'employees', foreignKey: 'employee_id' },
        ],
        collect: [{
          key: 'schemaNames',
          node: 'datasources',
          mode: 'values',
          fields: ['uuid'],
          distinct: true,
          orderBy: [{ fieldName: 'uuid', direction: 'ASC' }],
        }],
      },
      withTransaction: harness.withTransaction,
      processValue,
    })

    expect(result).toEqual({
      affected: 1,
      affectedByNode: { enterprise: 1, employees: 2, datasources: 3, identities: 3 },
      totalAffected: 9,
      collected: { schemaNames: ['e_one', 'e_two'] },
    })
    expect(processValue).toHaveBeenCalledTimes(3)
    expect(harness.withTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'serializable',
      retries: 2,
    })
    expect(harness.queries.map(query => query.sql.match(/(?:FROM|DELETE FROM) "([^"]+)"/)?.[1]))
      .toEqual([
        'enterprise', 'employees', 'datasources', 'employee_auth_identities',
        'employee_auth_identities', 'datasources', 'employees', 'enterprise',
      ])
    expect(harness.queries.filter(query => query.sql.startsWith('SELECT')).every(query => query.sql.endsWith('FOR UPDATE')))
      .toBe(true)
    expect(harness.queries.filter(query => query.sql.startsWith('DELETE')).every(query => query.sql.includes('RETURNING 1 AS "affected_marker"')))
      .toBe(true)
  })

  it('uses MySQL affectedRows and supports rows mode with ProcessableKey fields', async () => {
    const harness = createHarness('mysql', ({ sql: text }) => {
      if (text.startsWith('SELECT') && text.includes('FROM `enterprise`')) {
        return { rows: [{ __cascade_key: 'enterprise-1', __cascade_value_0: 'Acme', __cascade_value_1: 'e_acme' }] }
      }
      if (text.startsWith('SELECT')) return { rows: [{ __cascade_key: 1 }] }
      return { affectedRows: 1 }
    })

    const result = await runCascade({
      databaseType: 'mysql',
      withTransaction: harness.withTransaction,
      inputs: {
        datasource: 'Mokelay',
        root,
        relations: [{ id: 'employees', table: 'employees', keyField: 'id', parent: 'enterprise', foreignKey: 'enterprise_uuid' }],
        collect: [{
          key: 'enterpriseRows',
          node: 'enterprise',
          mode: 'rows',
          fields: ['name', { key: 'uuid', processors: ['trim'] }],
        }],
      },
    })

    expect(result).toMatchObject({
      affected: 1,
      affectedByNode: { enterprise: 1, employees: 1 },
      totalAffected: 2,
      collected: { enterpriseRows: [{ name: 'Acme', uuid: 'e_acme' }] },
    })
    expect(harness.queries.filter(query => query.sql.startsWith('DELETE')).every(query => !query.sql.includes('RETURNING')))
      .toBe(true)
  })

  it('runs all collect processors before the first DELETE and aborts on validation failure', async () => {
    const harness = createHarness('postgres', ({ sql: text }) => text.startsWith('SELECT')
      ? { rows: [{ __cascade_key: 'enterprise-1', __cascade_value_0: 'unsafe' }] }
      : { rows: [{ affected_marker: 1 }] })
    const processValue = vi.fn<ProcessValue>(async () => {
      throw new Error('processor rejected')
    })

    await expect(runCascade({
      inputs: {
        datasource: 'Mokelay',
        root,
        collect: [{ key: 'names', node: 'enterprise', mode: 'values', fields: [{ key: 'uuid', processors: ['trim'] }] }],
      },
      withTransaction: harness.withTransaction,
      processValue,
    })).rejects.toThrow('processor rejected')

    expect(harness.queries.some(query => query.sql.startsWith('DELETE'))).toBe(false)
  })

  it.each([
    ['missing conditions', { ...root, conditions: [] }, 'BLOCK_CASCADE_UNSCOPED'],
    ['optional empty conditions', { ...root, conditions: [{ group: false, fieldName: 'uuid', fieldValue: '', conditionType: 'EQ', optional: true }] }, 'BLOCK_CASCADE_UNSCOPED'],
  ])('rejects an unscoped root: %s', async (_name, invalidRoot, code) => {
    await expect(runCascade({ inputs: { datasource: 'Mokelay', root: invalidRoot } }))
      .rejects.toMatchObject({ data: { code } })
  })

  it.each([
    ['unknown parent', [{ id: 'child', table: 'children', keyField: 'id', parent: 'missing', foreignKey: 'root_id' }]],
    ['cycle', [
      { id: 'a', table: 'a', keyField: 'id', parent: 'b', foreignKey: 'b_id' },
      { id: 'b', table: 'b', keyField: 'id', parent: 'a', foreignKey: 'a_id' },
    ]],
    ['duplicate table', [{ id: 'child', table: 'enterprise', keyField: 'id', parent: 'enterprise', foreignKey: 'parent_id' }]],
    ['qualified duplicate table', [{ id: 'child', table: 'public.enterprise', keyField: 'id', parent: 'enterprise', foreignKey: 'parent_id' }]],
  ])('rejects an invalid relation graph: %s', async (_name, relations) => {
    await expect(runCascade({ inputs: { datasource: 'Mokelay', root, relations } }))
      .rejects.toMatchObject({ data: { code: 'BLOCK_INVALID_CASCADE' } })
  })

  it.each([null, 1, true])('rejects non-string collect order direction %j', async direction => {
    await expect(runCascade({
      inputs: {
        datasource: 'Mokelay',
        root,
        collect: [{
          key: 'ids',
          node: 'enterprise',
          mode: 'values',
          fields: ['uuid'],
          orderBy: [{ fieldName: 'uuid', direction }],
        }],
      },
    })).rejects.toMatchObject({ data: { code: 'BLOCK_INVALID_CASCADE' } })
  })

  it('enforces configured root, affected and collected limits before DELETE', async () => {
    const scenarios = [
      {
        limits: { maxRootRows: 1 },
        collect: [],
        relations: [],
        rows: [{ __cascade_key: 'one' }, { __cascade_key: 'two' }],
      },
      {
        limits: { maxAffectedRows: 1 },
        collect: [],
        relations: [{ id: 'children', table: 'children', keyField: 'id', parent: 'enterprise', foreignKey: 'enterprise_id' }],
        rows: [{ __cascade_key: 'one' }],
      },
      {
        limits: { maxCollectedRows: 0 },
        collect: [{ key: 'ids', node: 'enterprise', mode: 'values', fields: ['uuid'] }],
        relations: [],
        rows: [{ __cascade_key: 'one', __cascade_value_0: 'one' }],
      },
    ]

    for (const scenario of scenarios) {
      const harness = createHarness('postgres', ({ sql: text }) => text.startsWith('SELECT')
        ? { rows: scenario.rows }
        : { rows: [{ affected_marker: 1 }] })

      await expect(runCascade({
        inputs: { datasource: 'Mokelay', root, ...scenario },
        withTransaction: harness.withTransaction,
      })).rejects.toMatchObject({ data: { code: 'BLOCK_CASCADE_LIMIT_EXCEEDED' } })
      expect(harness.queries.some(query => query.sql.startsWith('DELETE'))).toBe(false)
    }
  })

  it('counts maxCollectedRows across all collect candidates before distinct', async () => {
    const harness = createHarness('postgres', ({ sql: text }) => text.startsWith('SELECT')
      ? { rows: [{ __cascade_key: 'one', __cascade_value_0: 'duplicate' }] }
      : { rows: [{ affected_marker: 1 }] })

    await expect(runCascade({
      inputs: {
        datasource: 'Mokelay',
        root,
        collect: [
          { key: 'first', node: 'enterprise', mode: 'values', fields: ['uuid'], distinct: true },
          { key: 'second', node: 'enterprise', mode: 'values', fields: ['uuid'], distinct: true },
        ],
        limits: { maxCollectedRows: 1 },
      },
      withTransaction: harness.withTransaction,
    })).rejects.toMatchObject({ data: { code: 'BLOCK_CASCADE_LIMIT_EXCEEDED' } })
    expect(harness.queries.some(query => query.sql.startsWith('DELETE'))).toBe(false)
  })

  it('rejects hard-cap, graph-depth, node-count and condition-complexity violations', async () => {
    const chain = Array.from({ length: 8 }, (_, index) => ({
      id: `node_${index}`,
      table: `table_${index}`,
      keyField: 'id',
      parent: index === 0 ? 'enterprise' : `node_${index - 1}`,
      foreignKey: 'parent_id',
    }))
    const tooManyNodes = Array.from({ length: 32 }, (_, index) => ({
      id: `wide_${index}`,
      table: `wide_table_${index}`,
      keyField: 'id',
      parent: 'enterprise',
      foreignKey: 'parent_id',
    }))
    const tooManyLeaves = Array.from({ length: 101 }, (_, index) => ({
      group: false,
      fieldName: `field_${index}`,
      fieldValue: index,
      conditionType: 'EQ',
    }))
    const invalidInputs = [
      { root, limits: { maxAffectedRows: 1_000_001 } },
      { root, relations: chain },
      { root, relations: tooManyNodes },
      { root: { ...root, conditions: [{ group: true, groupType: 'AND', groups: tooManyLeaves }] } },
      { root, collect: Array.from({ length: 17 }, (_, index) => ({ key: `collect_${index}`, node: 'enterprise', mode: 'values', fields: ['uuid'] })) },
    ]

    for (const inputs of invalidInputs) {
      await expect(runCascade({ inputs: { datasource: 'Mokelay', ...inputs } }))
        .rejects.toMatchObject({ data: { code: expect.stringMatching(/^BLOCK_(INVALID_CASCADE|CASCADE_LIMIT_EXCEEDED)$/) } })
    }
  })

  it('batches large deletes and rolls back when locked and deleted counts differ', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({ __cascade_key: index + 1 }))
    let deleteCall = 0
    const harness = createHarness('postgres', ({ sql: text }) => {
      if (text.startsWith('SELECT')) return { rows }
      deleteCall += 1
      const count = deleteCall === 1 ? 500 : 1
      return { rows: Array.from({ length: count }, () => ({ affected_marker: 1 })) }
    })
    await expect(runCascade({
      inputs: { datasource: 'Mokelay', root, limits: { maxRootRows: 501 } },
      withTransaction: harness.withTransaction,
    })).resolves.toMatchObject({ affected: 501, totalAffected: 501 })
    expect(harness.queries.filter(query => query.sql.startsWith('DELETE'))).toHaveLength(2)

    const mismatchHarness = createHarness('postgres', ({ sql: text }) => text.startsWith('SELECT')
      ? { rows: [{ __cascade_key: 'one' }] }
      : { rows: [] })
    await expect(runCascade({
      inputs: { datasource: 'Mokelay', root },
      withTransaction: mismatchHarness.withTransaction,
    })).rejects.toMatchObject({ data: { code: 'BLOCK_INVALID_CASCADE' } })
  })

  it('registers the fixed outputs', () => {
    expect(blockDefinitions.cascadeDelete).toMatchObject({
      allowedOutputs: ['affected', 'affectedByNode', 'totalAffected', 'collected'],
      requiresDatasource: true,
    })
  })
})
