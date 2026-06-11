import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { sql } from 'drizzle-orm'
import { createApp, createRouter, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMokelayOrchestrationHandler } from '../src/utils/orchestration.js'
import type { BlockDefinition } from '../src/utils/orchestration-schema.js'

const servers: Server[] = []

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

function apiJson(functionName: string, outputs: string[], inputs: Record<string, unknown> = {}) {
  return {
    uuid: 'custom_block_test',
    method: 'GET',
    blocks: [
      { uuid: 'starter', nextBlock: 'custom_block' },
      {
        uuid: 'custom_block',
        functionName,
        inputs,
        outputs,
        nextBlock: null,
      },
    ],
    response: Object.fromEntries(outputs.map((output) => [
      output,
      { template: `{{blocks['custom_block'].outputs.${output}}}` },
    ])),
  }
}

async function requestApi(definition: BlockDefinition, rawApiJson: unknown) {
  const handler = createMokelayOrchestrationHandler({
    loadApiJson: async () => rawApiJson,
    blockDefinitions: { customBlock: definition },
  })
  const baseUrl = await startServer(handler)
  const response = await fetch(`${baseUrl}/api/mokelay/custom_block_test`)

  return await response.json() as Record<string, unknown>
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })))
})

describe('custom block definitions', () => {
  it('executes a registered non-database block', async () => {
    const executor = vi.fn<BlockDefinition['executor']>(async ({ inputs, databaseType }) => ({
      value: inputs.value,
      databaseType: databaseType ?? null,
    }))

    const body = await requestApi({
      executor,
      allowedOutputs: ['value', 'databaseType'],
    }, apiJson('customBlock', ['value', 'databaseType'], { value: 'custom-result' }))

    expect(body).toEqual({
      ok: true,
      data: {
        value: 'custom-result',
        databaseType: null,
      },
    })
    expect(executor).toHaveBeenCalledOnce()
  })

  it('validates declared outputs against the custom definition', async () => {
    const body = await requestApi({
      executor: async () => ({ value: 'unused' }),
      allowedOutputs: ['value'],
    }, apiJson('customBlock', ['unsupported']))

    expect(body).toMatchObject({
      ok: false,
      error: { code: 'BLOCK_UNSUPPORTED_OUTPUT' },
    })
  })

  it('keeps unknown functions unsupported', async () => {
    const handler = createMokelayOrchestrationHandler({
      loadApiJson: async () => apiJson('missingBlock', []),
    })
    const baseUrl = await startServer(handler)
    const response = await fetch(`${baseUrl}/api/mokelay/custom_block_test`)

    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'BLOCK_UNSUPPORTED_FUNCTION' },
    })
  })

  it('does not allow custom definitions to override built-in blocks', () => {
    expect(() => createMokelayOrchestrationHandler({
      blockDefinitions: {
        list: {
          executor: async () => ({}),
          allowedOutputs: [],
        },
      },
    })).toThrow('cannot override built-in Block: list')
  })

  it('does not expose SQL execution to non-database custom blocks', async () => {
    const body = await requestApi({
      executor: async ({ executeSql }) => {
        try {
          await executeSql(sql`select 1`)
          return { code: null }
        } catch (error) {
          const data = typeof error === 'object' && error && 'data' in error ? error.data : undefined
          const code = typeof data === 'object' && data && 'code' in data ? data.code : null
          return { code }
        }
      },
      allowedOutputs: ['code'],
    }, apiJson('customBlock', ['code']))

    expect(body).toEqual({
      ok: true,
      data: { code: 'BLOCK_SQL_UNSUPPORTED' },
    })
  })

  it('provides datasource SQL execution when requested by the definition', async () => {
    const originalUrl = process.env.Custom_DATABASE_URL
    process.env.Custom_DATABASE_URL = 'postgres://unit-test'
    const executeSql = vi.fn(async () => ({ databaseType: 'postgres' as const, rows: [{ value: 1 }] }))

    try {
      const handler = createMokelayOrchestrationHandler({
        loadApiJson: async () => apiJson('customDatabaseBlock', ['value'], { datasource: 'Custom' }),
        executeSql,
        blockDefinitions: {
          customDatabaseBlock: {
            executor: async ({ executeSql: executeBlockSql, databaseType }) => {
              const result = await executeBlockSql(sql`select 1`)
              return { value: result.rows[0]?.value, databaseType }
            },
            allowedOutputs: ['value'],
            requiresDatasource: true,
          },
        },
      })
      const baseUrl = await startServer(handler)
      const response = await fetch(`${baseUrl}/api/mokelay/custom_block_test`)

      await expect(response.json()).resolves.toEqual({
        ok: true,
        data: { value: 1 },
      })
      expect(executeSql).toHaveBeenCalledWith(expect.anything(), 'Custom', 'postgres')
    } finally {
      if (originalUrl === undefined) {
        delete process.env.Custom_DATABASE_URL
      } else {
        process.env.Custom_DATABASE_URL = originalUrl
      }
    }
  })
})
