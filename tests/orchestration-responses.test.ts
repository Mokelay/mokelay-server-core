import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, createRouter, toNodeListener } from 'h3'
import { createMokelayOrchestrationHandler } from '../src/utils/orchestration.js'

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

async function requestApi(rawApiJson: unknown, query = '') {
  const handler = createMokelayOrchestrationHandler({
    loadApiJson: async () => rawApiJson,
    blockDefinitions: {
      echoBlock: {
        executor: async ({ inputs }) => ({ value: inputs.value }),
        allowedOutputs: ['value'],
      },
      failBlock: {
        executor: async () => {
          throw new Error('expected failure')
        },
        allowedOutputs: [],
      },
    },
  })
  const baseUrl = await startServer(handler)
  const response = await fetch(`${baseUrl}/api/mokelay/branch_response_test${query}`)

  return await response.json() as Record<string, unknown>
}

async function fetchApi(rawApiJson: unknown, query = '') {
  const handler = createMokelayOrchestrationHandler({
    loadApiJson: async () => rawApiJson,
    blockDefinitions: {
      echoBlock: {
        executor: async ({ inputs }) => ({ value: inputs.value }),
        allowedOutputs: ['value'],
      },
      failBlock: {
        executor: async () => {
          throw new Error('expected failure')
        },
        allowedOutputs: [],
      },
    },
  })
  const baseUrl = await startServer(handler)

  return await fetch(`${baseUrl}/api/mokelay/branch_response_test${query}`, {
    redirect: 'manual',
  })
}

function apiJson(overrides: Record<string, unknown> = {}) {
  return {
    uuid: 'branch_response_test',
    method: 'GET',
    request: {
      query: [{ key: 'flag' }],
    },
    blocks: [
      { uuid: 'starter', nextBlock: 'choose' },
      {
        uuid: 'choose',
        functionName: 'if_controller',
        type: 'controller',
        inputs: {
          value: { template: '{{request.query.flag}}' },
        },
        nodes: [
          {
            uuid: 'true_node',
            value: true,
            nextBlock: 'true_block',
          },
          {
            uuid: 'false_node',
            value: false,
            nextBlock: null,
          },
        ],
      },
      {
        uuid: 'true_block',
        functionName: 'echoBlock',
        inputs: {
          value: 'true-output',
        },
        outputs: ['value'],
        nextBlock: null,
      },
    ],
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })))
})

describe('orchestration terminal responses', () => {
  it('uses the response mapped to the selected terminal', async () => {
    const rawApiJson = apiJson({
      responses: {
        true_block: {
          branch: 'true',
          value: { template: "{{blocks['true_block'].outputs.value}}" },
        },
        false_node: {
          branch: 'false',
          value: null,
        },
      },
    })

    await expect(requestApi(rawApiJson, '?flag=1')).resolves.toEqual({
      ok: true,
      data: {
        branch: 'true',
        value: 'true-output',
      },
    })
    await expect(requestApi(rawApiJson)).resolves.toEqual({
      ok: true,
      data: {
        branch: 'false',
        value: null,
      },
    })
  })

  it('falls back to response when a terminal response is not configured', async () => {
    await expect(requestApi(apiJson({
      response: {
        branch: 'fallback',
      },
      responses: {
        true_block: {
          branch: 'true',
        },
      },
    }))).resolves.toEqual({
      ok: true,
      data: {
        branch: 'fallback',
      },
    })
  })

  it('rejects response maps with missing or invalid terminals', async () => {
    await expect(requestApi(apiJson({
      responses: {
        true_block: {
          branch: 'true',
        },
      },
    }))).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'API_JSON_INVALID_RESPONSE',
      },
    })

    await expect(requestApi(apiJson({
      response: null,
      responses: {
        missing_terminal: {
          branch: 'missing',
        },
      },
    }))).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'API_JSON_INVALID_RESPONSE',
      },
    })
  })

  it('supports redirect responses for selected terminals', async () => {
    const response = await fetchApi(apiJson({
      responses: {
        true_block: {
          redirect: {
            statusCode: 302,
            url: { template: "{{blocks['true_block'].outputs.value}}" },
          },
        },
        false_node: {
          branch: 'false',
        },
      },
    }), '?flag=1')

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('true-output')
  })

  it('routes a Block failure through errorNextBlock and its terminal response', async () => {
    const blocks = [
      { uuid: 'starter', nextBlock: 'failing_block' },
      {
        uuid: 'failing_block',
        functionName: 'failBlock',
        inputs: {},
        nextBlock: 'success_block',
        errorNextBlock: null,
      },
      {
        uuid: 'success_block',
        functionName: 'echoBlock',
        inputs: { value: 'success' },
        outputs: ['value'],
        nextBlock: null,
      },
    ]
    const responses = {
      failing_block: { branch: 'error' },
      success_block: { branch: 'success' },
    }

    await expect(requestApi(apiJson({ blocks, responses }), '?__debug=1')).resolves.toMatchObject({
      ok: true,
      data: { branch: 'error' },
      debug: {
        nextBlock: {
          uuid: 'failing_block',
          error: { message: '服务器内部错误。' },
          nextBlock: null,
        },
      },
    })
  })

  it('supports a redirect response for an error terminal', async () => {
    const response = await fetchApi(apiJson({
      blocks: [
        { uuid: 'starter', nextBlock: 'failing_block' },
        {
          uuid: 'failing_block',
          functionName: 'failBlock',
          inputs: {},
          nextBlock: 'success_block',
          errorNextBlock: null,
        },
        {
          uuid: 'success_block',
          functionName: 'echoBlock',
          inputs: { value: 'success' },
          outputs: ['value'],
          nextBlock: null,
        },
      ],
      responses: {
        failing_block: {
          redirect: {
            statusCode: 302,
            url: '/login?oauth_error=registration_failed',
          },
        },
        success_block: { branch: 'success' },
      },
    }))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/login?oauth_error=registration_failed')
  })
})
