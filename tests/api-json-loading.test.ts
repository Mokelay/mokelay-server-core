import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatasourceSqlExecutor } from '../src/utils/orchestration-schema.js'

const { loadApiJsonFromR2Mock } = vi.hoisted(() => ({
  loadApiJsonFromR2Mock: vi.fn(),
}))

vi.mock('../src/utils/r2-api-json.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/r2-api-json.js')>()

  return {
    ...actual,
    loadApiJsonFromR2: loadApiJsonFromR2Mock,
  }
})

import { loadApiJson } from '../src/utils/orchestration.js'

function endpointApi(uuid: string) {
  return {
    uuid,
    method: 'GET',
    blocks: [{ uuid: 'starter', nextBlock: null }],
    response: null,
  }
}

beforeEach(() => {
  loadApiJsonFromR2Mock.mockReset()
  vi.stubEnv('Mokelay_DATABASE_URL', 'postgres://user:password@localhost:5432/mokelay')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('HTTP API JSON loading', () => {
  it.each(['draft', 'published'])('does not let stale R2 endpoint JSON shadow a %s Fragment record', async (status) => {
    const uuid = `stale_r2_${status}_fragment`
    loadApiJsonFromR2Mock.mockResolvedValue(JSON.stringify(endpointApi(uuid)))
    const executeSql = vi.fn(async () => ({
      databaseType: 'postgres' as const,
      rows: [{
        api_json: {
          uuid,
          fragment: true,
          params: [],
          blocks: [{ uuid: 'starter', nextBlock: null }],
          response: { ok: true },
        },
        fragment: true,
        status,
      }],
    })) as unknown as DatasourceSqlExecutor

    await expect(loadApiJson(uuid, executeSql)).rejects.toMatchObject({
      data: { code: 'FRAGMENT_DIRECT_EXECUTION_FORBIDDEN' },
    })
    expect(loadApiJsonFromR2Mock).toHaveBeenCalledWith(uuid)
    expect(executeSql).toHaveBeenCalledOnce()
  })

  it('preserves R2 priority for a non-Fragment database record', async () => {
    const uuid = 'r2_endpoint_priority'
    const r2Api = endpointApi(uuid)
    loadApiJsonFromR2Mock.mockResolvedValue(JSON.stringify(r2Api))
    const executeSql = vi.fn(async () => ({
      databaseType: 'postgres' as const,
      rows: [{ api_json: { ...r2Api, response: { source: 'database' } }, fragment: false, status: 'published' }],
    })) as unknown as DatasourceSqlExecutor

    await expect(loadApiJson(uuid, executeSql)).resolves.toEqual(r2Api)
  })

  it('does not resurrect a deleted database API from a stale R2 object', async () => {
    const uuid = 'deleted_database_endpoint'
    loadApiJsonFromR2Mock.mockResolvedValue(JSON.stringify(endpointApi(uuid)))
    const executeSql = vi.fn(async () => ({
      databaseType: 'postgres' as const,
      rows: [],
    })) as unknown as DatasourceSqlExecutor

    await expect(loadApiJson(uuid, executeSql)).rejects.toMatchObject({
      data: { code: 'API_JSON_NOT_FOUND' },
    })
  })

  it('uses R2 without a database preflight when Mokelay has no database configuration', async () => {
    for (const key of [
      'Mokelay_DATABASE_URL',
      'Mokelay_Type',
      'Mokelay_Host',
      'Mokelay_Port',
      'Mokelay_Schema',
      'Mokelay_User',
      'Mokelay_Password',
    ]) {
      delete process.env[key]
    }

    const uuid = 'r2_without_database'
    const r2Api = endpointApi(uuid)
    loadApiJsonFromR2Mock.mockResolvedValue(JSON.stringify(r2Api))
    const executeSql = vi.fn() as unknown as DatasourceSqlExecutor

    await expect(loadApiJson(uuid, executeSql)).resolves.toEqual(r2Api)
    expect(executeSql).not.toHaveBeenCalled()
  })

  it('fails closed when the database kind preflight fails even if R2 has an endpoint', async () => {
    const uuid = 'r2_unknown_database_kind'
    loadApiJsonFromR2Mock.mockResolvedValue(JSON.stringify(endpointApi(uuid)))
    const databaseError = new Error('database unavailable')
    const executeSql = vi.fn(async () => {
      throw databaseError
    }) as unknown as DatasourceSqlExecutor

    await expect(loadApiJson(uuid, executeSql)).rejects.toBe(databaseError)
  })
})
