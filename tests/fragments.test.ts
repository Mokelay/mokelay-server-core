import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, createRouter, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toMokelayErrorResponse } from '../src/utils/mokelay-error.js'
import { createMokelayOrchestrationHandler, loadFragmentApiJson } from '../src/utils/orchestration.js'
import {
  parseApiJson,
  type BlockDefinition,
  type DatasourceSqlExecutor,
} from '../src/utils/orchestration-schema.js'

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

function callerApi(fragmentUuid = 'shared_fragment', params: Record<string, unknown> = {}) {
  return {
    uuid: 'fragment_caller',
    method: 'POST',
    request: {
      body: [
        { key: 'required', processors: ['trim'] },
        { key: 'normalized', processors: ['trim'] },
      ],
    },
    blocks: [
      { uuid: 'starter', nextBlock: 'run_fragment' },
      {
        uuid: 'run_fragment',
        functionName: 'executeFragment',
        inputs: {
          fragmentUuid,
          params,
        },
        outputs: ['result'],
        nextBlock: null,
      },
    ],
    response: {
      result: { template: "{{blocks['run_fragment'].outputs.result}}" },
    },
  }
}

function fragmentApi(overrides: Record<string, unknown> = {}) {
  return {
    uuid: 'shared_fragment',
    fragment: true,
    params: [
      'required',
      { key: 'normalized', processors: ['trim'] },
    ],
    blocks: [
      { uuid: 'starter', nextBlock: 'echo' },
      {
        uuid: 'echo',
        functionName: 'testEcho',
        inputs: {
          required: { template: '{{params.required}}' },
          normalized: { template: '{{params.normalized}}' },
          now: { template: '{{now}}' },
        },
        outputs: ['value'],
        nextBlock: null,
      },
    ],
    response: {
      value: { template: "{{blocks['echo'].outputs.value}}" },
    },
    ...overrides,
  }
}

async function requestApis(
  apis: Record<string, unknown>,
  apiJsonUuid: string,
  init?: RequestInit,
  definitions?: Record<string, BlockDefinition>,
  query = '',
) {
  const handler = createMokelayOrchestrationHandler({
    loadApiJson: async (uuid) => apis[uuid],
    blockDefinitions: definitions,
  })
  const baseUrl = await startServer(handler)
  const response = await fetch(`${baseUrl}/api/mokelay/${apiJsonUuid}${query}`, init)

  return await response.json() as Record<string, unknown>
}

function errorCode(callback: () => unknown) {
  try {
    callback()
    return undefined
  } catch (error) {
    return toMokelayErrorResponse(error).error.code
  }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })))
})

describe('Fragment loading', () => {
  it('uses the published Fragment database record as the authoritative dynamic source', async () => {
    vi.stubEnv('Mokelay_DATABASE_URL', 'postgres://user:password@localhost:5432/mokelay')
    const apiJson = fragmentApi()
    const executeSql = vi.fn(async () => ({
      databaseType: 'postgres' as const,
      rows: [{ api_json: apiJson, fragment: true, status: 'published' }],
    })) as unknown as DatasourceSqlExecutor

    await expect(loadFragmentApiJson('shared_fragment', executeSql)).resolves.toEqual(apiJson)
    expect(executeSql).toHaveBeenCalledOnce()
  })

  it.each([
    [{ api_json: fragmentApi(), fragment: true, status: 'draft' }, '尚未发布'],
    [{ api_json: callerApi(), fragment: false, status: 'published' }, '不是 Fragment'],
  ])('rejects non-published or non-Fragment database targets', async (row, message) => {
    vi.stubEnv('Mokelay_DATABASE_URL', 'postgres://user:password@localhost:5432/mokelay')
    const executeSql = vi.fn(async () => ({
      databaseType: 'postgres' as const,
      rows: [row],
    })) as unknown as DatasourceSqlExecutor

    await expect(loadFragmentApiJson('shared_fragment', executeSql)).rejects.toMatchObject({
      data: { code: 'FRAGMENT_TARGET_INVALID' },
      message: expect.stringContaining(message),
    })
  })
})

describe('Fragment DSL schema', () => {
  it('parses endpoint and Fragment as a strict discriminated union', () => {
    expect(parseApiJson('endpoint', {
      uuid: 'endpoint',
      method: 'get',
      blocks: [{ uuid: 'starter', nextBlock: null }],
      response: null,
    })).toMatchObject({ fragment: false, method: 'GET' })

    expect(parseApiJson('fragment', {
      uuid: 'fragment',
      fragment: true,
      params: ['email'],
      blocks: [{ uuid: 'starter', nextBlock: null }],
      response: { email: { template: '{{params.email}}' } },
    })).toMatchObject({ fragment: true, params: ['email'] })

    expect(errorCode(() => parseApiJson('fragment', {
      uuid: 'fragment',
      fragment: true,
      method: 'POST',
      params: [],
      blocks: [{ uuid: 'starter', nextBlock: null }],
      response: { ok: true },
    }))).toBe('API_JSON_INVALID_SCHEMA')

    expect(errorCode(() => parseApiJson('endpoint', {
      uuid: 'endpoint',
      fragment: false,
      method: 'POST',
      params: [],
      blocks: [{ uuid: 'starter', nextBlock: null }],
      response: null,
    }))).toBe('API_JSON_INVALID_SCHEMA')
  })

  it('requires ExecuteFragment literal inputs and its fixed result output', () => {
    expect(errorCode(() => parseApiJson('fragment_caller', callerApi(
      'shared_fragment',
      {},
    )))).toBeUndefined()

    const dynamicUuid = callerApi() as Record<string, unknown>
    const dynamicBlocks = dynamicUuid.blocks as Array<Record<string, unknown>>
    dynamicBlocks[1].inputs = {
      fragmentUuid: { template: '{{request.body.fragmentUuid}}' },
      params: {},
    }
    expect(errorCode(() => parseApiJson('fragment_caller', dynamicUuid))).toBe('API_JSON_INVALID_SCHEMA')

    const wrongOutputs = callerApi() as Record<string, unknown>
    const blocks = wrongOutputs.blocks as Array<Record<string, unknown>>
    blocks[1].outputs = ['result', 'other']
    expect(errorCode(() => parseApiJson('fragment_caller', wrongOutputs))).toBe('API_JSON_INVALID_SCHEMA')
  })

  it('rejects nested fragments, redirects, empty results, and inconsistent terminal keys', () => {
    expect(errorCode(() => parseApiJson('shared_fragment', fragmentApi({
      blocks: [
        { uuid: 'starter', nextBlock: 'nested' },
        {
          uuid: 'nested',
          functionName: 'executeFragment',
          inputs: { fragmentUuid: 'other_fragment', params: {} },
          outputs: ['result'],
          nextBlock: null,
        },
      ],
      response: { result: true },
    })))).toBe('FRAGMENT_NESTING_FORBIDDEN')

    expect(errorCode(() => parseApiJson('shared_fragment', fragmentApi({
      response: { redirect: { url: '/dashboard' } },
    })))).toBe('API_JSON_INVALID_RESPONSE')

    expect(errorCode(() => parseApiJson('shared_fragment', fragmentApi({ response: {} })))).toBe(
      'API_JSON_INVALID_RESPONSE',
    )

    expect(errorCode(() => parseApiJson('shared_fragment', fragmentApi({
      response: { value: true },
      responses: { echo: { other: true } },
    })))).toBe('API_JSON_INVALID_RESPONSE')
  })

  it('limits Fragment templates to declared params, blocks, and now', () => {
    expect(errorCode(() => parseApiJson('shared_fragment', fragmentApi({
      response: { value: { template: '{{request.body.email}}' } },
    })))).toBe('API_JSON_INVALID_SCHEMA')

    expect(errorCode(() => parseApiJson('shared_fragment', fragmentApi({
      response: { value: { template: '{{params.missing}}' } },
    })))).toBe('API_JSON_INVALID_SCHEMA')

    expect(errorCode(() => parseApiJson('shared_fragment', fragmentApi({
      response: { value: { template: "{{params['required']}}" } },
    })))).toBeUndefined()
  })
})

describe('Fragment execution', () => {
  it('runs with processed params in an isolated context and returns result', async () => {
    const echo = vi.fn<BlockDefinition['executor']>(async ({ inputs }) => ({ value: inputs }))
    const apis = {
      fragment_caller: callerApi('shared_fragment', {
        required: { template: '{{request.body.required}}' },
        normalized: { template: '{{request.body.normalized}}' },
      }),
      shared_fragment: fragmentApi(),
    }
    const body = await requestApis(apis, 'fragment_caller', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ required: 'caller value', normalized: '  child value  ' }),
    }, {
      testEcho: { executor: echo, allowedOutputs: ['value'] },
    }, '?__debug=1')

    expect(body).toMatchObject({
      ok: true,
      data: {
        result: {
          value: {
            required: 'caller value',
            normalized: 'child value',
          },
        },
      },
      debug: {
        nextBlock: {
          uuid: 'run_fragment',
          fragment: {
            nextBlock: { uuid: 'echo' },
          },
        },
      },
    })
    expect(echo).toHaveBeenCalledOnce()
    expect(echo.mock.calls[0]?.[0].inputs).not.toHaveProperty('request')
  })

  it('rejects direct HTTP execution before running any Block', async () => {
    const echo = vi.fn<BlockDefinition['executor']>(async () => ({ value: 'side effect' }))
    const body = await requestApis(
      { shared_fragment: fragmentApi() },
      'shared_fragment',
      undefined,
      { testEcho: { executor: echo, allowedOutputs: ['value'] } },
    )

    expect(body).toMatchObject({
      ok: false,
      error: { code: 'FRAGMENT_DIRECT_EXECUTION_FORBIDDEN' },
    })
    expect(echo).not.toHaveBeenCalled()
  })

  it('validates required, undeclared, and non-Fragment targets', async () => {
    const definitions = {
      testEcho: { executor: async ({ inputs }) => ({ value: inputs }), allowedOutputs: ['value'] },
    } satisfies Record<string, BlockDefinition>

    await expect(requestApis({
      fragment_caller: callerApi('shared_fragment', { normalized: 'value' }),
      shared_fragment: fragmentApi(),
    }, 'fragment_caller', { method: 'POST' }, definitions)).resolves.toMatchObject({
      ok: false,
      error: { code: 'FRAGMENT_PARAMETER_MISSING' },
    })

    await expect(requestApis({
      fragment_caller: callerApi('shared_fragment', { required: 'value', extra: true }),
      shared_fragment: fragmentApi(),
    }, 'fragment_caller', { method: 'POST' }, definitions)).resolves.toMatchObject({
      ok: false,
      error: { code: 'FRAGMENT_PARAMETER_UNDECLARED' },
    })

    await expect(requestApis({
      fragment_caller: callerApi('ordinary_api', {}),
      ordinary_api: {
        uuid: 'ordinary_api',
        method: 'GET',
        blocks: [{ uuid: 'starter', nextBlock: null }],
        response: null,
      },
    }, 'fragment_caller', { method: 'POST' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'FRAGMENT_TARGET_INVALID' },
    })
  })

  it('rejects caller request templates before running a Fragment Block and preserves the nested trace', async () => {
    const echo = vi.fn<BlockDefinition['executor']>(async ({ inputs }) => ({ value: inputs }))
    const leakingFragment = fragmentApi({
      params: ['required'],
      blocks: [
        { uuid: 'starter', nextBlock: 'echo' },
        {
          uuid: 'echo',
          functionName: 'testEcho',
          inputs: { leaked: { template: '{{request.body.required}}' } },
          outputs: ['value'],
          nextBlock: null,
        },
      ],
    })
    const body = await requestApis({
      fragment_caller: callerApi('shared_fragment', { required: 'value' }),
      shared_fragment: leakingFragment,
    }, 'fragment_caller', { method: 'POST' }, {
      testEcho: { executor: echo, allowedOutputs: ['value'] },
    }, '?__debug=1')

    expect(body).toMatchObject({
      ok: false,
      error: { code: 'API_JSON_INVALID_SCHEMA' },
      debug: {
        nextBlock: {
          uuid: 'run_fragment',
          error: { code: 'API_JSON_INVALID_SCHEMA' },
          fragment: {
            nextBlock: null,
          },
        },
      },
    })
    expect(echo).not.toHaveBeenCalled()
  })

  it('does not let injected custom Blocks bypass ExecuteFragment', async () => {
    const indirectFragment = fragmentApi({
      params: [],
      blocks: [
        { uuid: 'starter', nextBlock: 'indirect' },
        {
          uuid: 'indirect',
          functionName: 'indirectInvoke',
          inputs: {},
          outputs: ['value'],
          nextBlock: null,
        },
      ],
      response: { value: { template: "{{blocks['indirect'].outputs.value}}" } },
    })
    const body = await requestApis({
      fragment_caller: callerApi('shared_fragment', {}),
      shared_fragment: indirectFragment,
    }, 'fragment_caller', { method: 'POST' }, {
      indirectInvoke: {
        executor: async ({ invokeFragment }) => ({
          value: await invokeFragment({ fragmentUuid: 'another_fragment', params: {} }),
        }),
        allowedOutputs: ['value'],
      },
    })

    expect(body).toMatchObject({
      ok: false,
      error: {
        code: 'FRAGMENT_TARGET_INVALID',
        message: 'Fragment 只能通过 executeFragment Block 调用。',
      },
    })
  })
})
