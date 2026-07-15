import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  createApp,
  createRouter,
  defineEventHandler,
  toNodeListener,
  type EventHandler,
} from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatasourceSqlExecutor } from '../src/utils/orchestration-schema.js'

const {
  readFileMock,
  nitroGetItemMock,
  loadApiJsonFromR2Mock,
} = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  nitroGetItemMock: vi.fn(),
  loadApiJsonFromR2Mock: vi.fn(),
}))

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  readFile: readFileMock,
}))

vi.mock('nitropack/runtime', () => ({
  useStorage: () => ({ getItem: nitroGetItemMock }),
}))

vi.mock('../src/utils/r2-api-json.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/utils/r2-api-json.js')>(),
  loadApiJsonFromR2: loadApiJsonFromR2Mock,
}))

import {
  createMokelayOrchestrationHandler,
  executeApiJson,
  loadApiJsonWithSource,
} from '../src/utils/orchestration.js'

const servers: Server[] = []
const fileAssets = new Map<string, unknown>()

function endpointApi(uuid: string, fragmentUuid = 'same_fragment') {
  return {
    uuid,
    method: 'GET',
    blocks: [
      { uuid: 'starter', nextBlock: 'execute_fragment' },
      {
        uuid: 'execute_fragment',
        functionName: 'executeFragment',
        inputs: { fragmentUuid, params: {} },
        outputs: ['result'],
        nextBlock: null,
      },
    ],
    response: {
      result: { template: "{{blocks['execute_fragment'].outputs.result}}" },
    },
  }
}

function fragmentApi(uuid: string, source: string) {
  return {
    uuid,
    fragment: true,
    params: [],
    blocks: [{ uuid: 'starter', nextBlock: null }],
    response: { source },
  }
}

function databaseResult(rows: Record<string, unknown>[]) {
  return {
    databaseType: 'postgres' as const,
    rows,
  }
}

function databaseRow(apiJson: unknown, fragment: boolean) {
  return {
    api_json: apiJson,
    fragment,
    status: 'published',
  }
}

async function request(handler: EventHandler, uuid: string) {
  const app = createApp()
  const router = createRouter()

  router.use('/api/mokelay/:apiJsonUuid', handler)
  app.use(router)

  const server = createServer(toNodeListener(app))
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const { port } = server.address() as AddressInfo
  const response = await fetch(`http://127.0.0.1:${port}/api/mokelay/${uuid}`)

  return await response.json() as Record<string, unknown>
}

beforeEach(() => {
  vi.stubEnv('Mokelay_DATABASE_URL', 'postgres://user:password@localhost:5432/mokelay')
  fileAssets.clear()
  readFileMock.mockReset()
  readFileMock.mockImplementation(async (path: unknown) => {
    const value = fileAssets.get(String(path))

    if (value !== undefined) {
      return typeof value === 'string' ? value : JSON.stringify(value)
    }

    throw Object.assign(new Error('not found'), { code: 'ENOENT' })
  })
  nitroGetItemMock.mockReset()
  nitroGetItemMock.mockResolvedValue(undefined)
  loadApiJsonFromR2Mock.mockReset()
  loadApiJsonFromR2Mock.mockResolvedValue(undefined)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })))
})

describe('Fragment source isolation', () => {
  it('resolves a system caller to the nested system Fragment when the database has the same UUID', async () => {
    const fragmentUuid = 'same_fragment'
    const apiUuid = 'system_caller'
    fileAssets.set(`${process.cwd()}/server/assets/mokelay-apis/${apiUuid}.json`, endpointApi(apiUuid, fragmentUuid))
    fileAssets.set(
      `${process.cwd()}/server/assets/mokelay-apis/fragment/${fragmentUuid}.json`,
      fragmentApi(fragmentUuid, 'system'),
    )
    const executeSql = vi.fn(async () => databaseResult([
      databaseRow(fragmentApi(fragmentUuid, 'database'), true),
    ])) as unknown as DatasourceSqlExecutor

    const body = await request(createMokelayOrchestrationHandler({ executeSql }), apiUuid)

    expect(body).toMatchObject({
      ok: true,
      data: { result: { source: 'system' } },
    })
    expect(executeSql).not.toHaveBeenCalled()
    expect(loadApiJsonFromR2Mock).not.toHaveBeenCalled()
  })

  it('uses the matching nested Nitro asset path for a system Fragment', async () => {
    const fragmentUuid = 'nitro_fragment'
    const apiUuid = 'nitro_caller'
    nitroGetItemMock.mockImplementation(async (key: string) => {
      if (key === `mokelay-apis/${apiUuid}.json`) {
        return endpointApi(apiUuid, fragmentUuid)
      }

      if (key === `mokelay-apis/fragment/${fragmentUuid}.json`) {
        return fragmentApi(fragmentUuid, 'nitro-system')
      }

      return undefined
    })
    const executeSql = vi.fn() as unknown as DatasourceSqlExecutor

    const body = await request(createMokelayOrchestrationHandler({ executeSql }), apiUuid)

    expect(body).toMatchObject({
      ok: true,
      data: { result: { source: 'nitro-system' } },
    })
    expect(nitroGetItemMock.mock.calls).toEqual([
      [`mokelay-apis/${apiUuid}.json`],
      [`mokelay-apis/fragment/${fragmentUuid}.json`],
    ])
    expect(executeSql).not.toHaveBeenCalled()
    expect(loadApiJsonFromR2Mock).not.toHaveBeenCalled()
  })

  it('resolves a user caller to the database Fragment when a nested system Fragment has the same UUID', async () => {
    const fragmentUuid = 'same_fragment'
    const apiUuid = 'user_caller'
    fileAssets.set(
      `${process.cwd()}/server/assets/mokelay-apis/fragment/${fragmentUuid}.json`,
      fragmentApi(fragmentUuid, 'system'),
    )
    const executeSql = vi.fn()
      .mockResolvedValueOnce(databaseResult([databaseRow(endpointApi(apiUuid, fragmentUuid), false)]))
      .mockResolvedValueOnce(databaseResult([databaseRow(fragmentApi(fragmentUuid, 'database'), true)])) as unknown as DatasourceSqlExecutor

    const body = await request(createMokelayOrchestrationHandler({ executeSql }), apiUuid)

    expect(body).toMatchObject({
      ok: true,
      data: { result: { source: 'database' } },
    })
    expect(executeSql).toHaveBeenCalledTimes(2)
    expect(readFileMock.mock.calls.some(([path]) => String(path).includes('/mokelay-apis/fragment/'))).toBe(false)
    expect(loadApiJsonFromR2Mock).toHaveBeenCalledTimes(1)
  })

  it('does not let a system caller fall through to a user Fragment', async () => {
    const fragmentUuid = 'database_only_fragment'
    const apiUuid = 'system_caller'
    fileAssets.set(`${process.cwd()}/server/assets/mokelay-apis/${apiUuid}.json`, endpointApi(apiUuid, fragmentUuid))
    const executeSql = vi.fn(async () => databaseResult([
      databaseRow(fragmentApi(fragmentUuid, 'database'), true),
    ])) as unknown as DatasourceSqlExecutor

    const body = await request(createMokelayOrchestrationHandler({ executeSql }), apiUuid)

    expect(body).toMatchObject({
      ok: false,
      error: { code: 'API_JSON_NOT_FOUND' },
    })
    expect(executeSql).not.toHaveBeenCalled()
    expect(loadApiJsonFromR2Mock).not.toHaveBeenCalled()
  })

  it('does not let a user caller fall through to a system Fragment', async () => {
    const fragmentUuid = 'system_only_fragment'
    const apiUuid = 'user_caller'
    fileAssets.set(
      `${process.cwd()}/server/assets/mokelay-apis/fragment/${fragmentUuid}.json`,
      fragmentApi(fragmentUuid, 'system'),
    )
    const executeSql = vi.fn()
      .mockResolvedValueOnce(databaseResult([databaseRow(endpointApi(apiUuid, fragmentUuid), false)]))
      .mockResolvedValueOnce(databaseResult([])) as unknown as DatasourceSqlExecutor

    const body = await request(createMokelayOrchestrationHandler({ executeSql }), apiUuid)

    expect(body).toMatchObject({
      ok: false,
      error: { code: 'API_JSON_NOT_FOUND' },
    })
    expect(executeSql).toHaveBeenCalledTimes(2)
    expect(readFileMock.mock.calls.some(([path]) => String(path).includes('/mokelay-apis/fragment/'))).toBe(false)
  })

  it('does not expose a nested system Fragment as a top-level HTTP API', async () => {
    const fragmentUuid = 'nested_only_fragment'
    fileAssets.set(
      `${process.cwd()}/server/assets/mokelay-apis/fragment/${fragmentUuid}.json`,
      fragmentApi(fragmentUuid, 'system'),
    )
    const executeSql = vi.fn(async () => databaseResult([])) as unknown as DatasourceSqlExecutor

    await expect(loadApiJsonWithSource(fragmentUuid, executeSql)).rejects.toMatchObject({
      data: { code: 'API_JSON_NOT_FOUND' },
    })
    expect(readFileMock.mock.calls.some(([path]) => String(path).includes('/mokelay-apis/fragment/'))).toBe(false)
    expect(nitroGetItemMock).toHaveBeenCalledWith(`mokelay-apis/${fragmentUuid}.json`)
    expect(nitroGetItemMock).not.toHaveBeenCalledWith(`mokelay-apis/fragment/${fragmentUuid}.json`)
  })

  it('does not fall through to the user namespace when Nitro asset storage fails', async () => {
    const apiUuid = 'shared_top_level_uuid'
    const storageError = new Error('asset storage unavailable')
    nitroGetItemMock.mockRejectedValue(storageError)
    loadApiJsonFromR2Mock.mockResolvedValue(endpointApi(apiUuid))
    const executeSql = vi.fn(async () => databaseResult([
      databaseRow(endpointApi(apiUuid), false),
    ])) as unknown as DatasourceSqlExecutor

    await expect(loadApiJsonWithSource(apiUuid, executeSql)).rejects.toBe(storageError)
    expect(loadApiJsonFromR2Mock).not.toHaveBeenCalled()
    expect(executeSql).not.toHaveBeenCalled()
  })

  it('keeps a custom loader self-contained for embedded hosts and tests', async () => {
    const apiUuid = 'custom_caller'
    const fragmentUuid = 'custom_fragment'
    const values: Record<string, unknown> = {
      [apiUuid]: endpointApi(apiUuid, fragmentUuid),
      [fragmentUuid]: fragmentApi(fragmentUuid, 'custom'),
    }
    const loader = vi.fn(async (uuid: string) => values[uuid])

    const body = await request(createMokelayOrchestrationHandler({ loadApiJson: loader }), apiUuid)

    expect(body).toMatchObject({
      ok: true,
      data: { result: { source: 'custom' } },
    })
    expect(loader.mock.calls).toEqual([[apiUuid], [fragmentUuid]])
    expect(readFileMock).not.toHaveBeenCalled()
    expect(loadApiJsonFromR2Mock).not.toHaveBeenCalled()
  })

  it('lets direct executeApiJson callers explicitly mark a raw built-in DSL as system-owned', async () => {
    const apiUuid = 'raw_system_caller'
    const fragmentUuid = 'raw_system_fragment'
    fileAssets.set(
      `${process.cwd()}/server/assets/mokelay-apis/fragment/${fragmentUuid}.json`,
      fragmentApi(fragmentUuid, 'raw-system'),
    )
    const executeSql = vi.fn(async () => databaseResult([
      databaseRow(fragmentApi(fragmentUuid, 'database'), true),
    ])) as unknown as DatasourceSqlExecutor
    const handler = defineEventHandler(async (event) => await executeApiJson(
      event,
      endpointApi(apiUuid, fragmentUuid),
      { apiJsonSource: 'system', executeSql },
    ))

    const body = await request(handler, apiUuid)

    expect(body).toMatchObject({
      ok: true,
      data: { result: { source: 'raw-system' } },
    })
    expect(executeSql).not.toHaveBeenCalled()
    expect(loadApiJsonFromR2Mock).not.toHaveBeenCalled()
  })
})
