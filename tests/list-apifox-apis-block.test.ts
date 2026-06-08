import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeListApifoxApisBlock } from '../src/utils/blocks/listApifoxApis.js'

const originalApifoxAccessToken = process.env.APIFOX_ACCESS_TOKEN
const originalFetch = globalThis.fetch

const fetchMock = vi.fn()

function execute(inputs: Record<string, unknown>) {
  return executeListApifoxApisBlock({
    event: undefined as never,
    block: undefined as never,
    inputs,
    executeSql: undefined as never,
  })
}

describe('executeListApifoxApisBlock', () => {
  beforeEach(() => {
    process.env.APIFOX_ACCESS_TOKEN = 'test-token'
    fetchMock.mockReset()
    globalThis.fetch = fetchMock as typeof fetch
  })

  afterAll(() => {
    if (originalApifoxAccessToken === undefined) {
      delete process.env.APIFOX_ACCESS_TOKEN
    } else {
      process.env.APIFOX_ACCESS_TOKEN = originalApifoxAccessToken
    }

    globalThis.fetch = originalFetch
  })

  it('rejects missing projectId', async () => {
    await expect(execute({})).rejects.toMatchObject({
      data: { code: 'BLOCK_APIFOX_INPUT_INVALID' },
      statusCode: 400,
    })
  })

  it('rejects missing APIFOX_ACCESS_TOKEN', async () => {
    delete process.env.APIFOX_ACCESS_TOKEN

    await expect(execute({ projectId: '123456' })).rejects.toMatchObject({
      data: { code: 'BLOCK_APIFOX_CONFIG_MISSING' },
      statusCode: 500,
    })
  })

  it('rejects invalid baseUrl', async () => {
    await expect(execute({
      projectId: '123456',
      baseUrl: 'not-a-url',
    })).rejects.toMatchObject({
      data: { code: 'BLOCK_APIFOX_INPUT_INVALID' },
      statusCode: 400,
    })
  })

  it('maps non-2xx APIFox responses to request failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', {
      status: 401,
      statusText: 'Unauthorized',
    }))

    await expect(execute({ projectId: '123456' })).rejects.toMatchObject({
      data: { code: 'BLOCK_APIFOX_REQUEST_FAILED' },
      statusCode: 502,
    })
  })

  it('maps invalid JSON to response failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not-json', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(execute({ projectId: '123456' })).rejects.toMatchObject({
      data: { code: 'BLOCK_APIFOX_RESPONSE_INVALID' },
      statusCode: 502,
    })
  })

  it('maps OpenAPI responses without paths to response failures', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ openapi: '3.1.0' }))

    await expect(execute({ projectId: '123456' })).rejects.toMatchObject({
      data: { code: 'BLOCK_APIFOX_RESPONSE_INVALID' },
      statusCode: 502,
    })
  })

  it('extracts APIs from OpenAPI paths and hides raw OpenAPI by default', async () => {
    const openapi = {
      openapi: '3.1.0',
      paths: {
        '/users/{id}': {
          parameters: [
            { name: 'x-request-id', in: 'header' },
          ],
          get: {
            summary: 'Read user',
            description: 'Read one user.',
            tags: ['User'],
            operationId: 'readUser',
            parameters: [
              { name: 'id', in: 'path' },
              { name: 'includePosts', in: 'query' },
            ],
            responses: {
              200: { description: 'OK' },
              404: { description: 'Not found' },
            },
          },
          post: {
            deprecated: true,
            requestBody: {
              content: {
                'application/json': {},
              },
            },
            responses: {
              201: { description: 'Created' },
            },
          },
        },
      },
    }

    fetchMock.mockResolvedValueOnce(Response.json(openapi))

    await expect(execute({ projectId: '123456' })).resolves.toEqual({
      apis: [
        {
          path: '/users/{id}',
          method: 'GET',
          summary: 'Read user',
          description: 'Read one user.',
          tags: ['User'],
          deprecated: false,
          operationId: 'readUser',
          parameters: {
            path: ['id'],
            query: ['includePosts'],
            header: ['x-request-id'],
            cookie: [],
          },
          requestBodyContentTypes: [],
          responseStatusCodes: ['200', '404'],
        },
        {
          path: '/users/{id}',
          method: 'POST',
          summary: null,
          description: null,
          tags: [],
          deprecated: true,
          operationId: null,
          parameters: {
            path: [],
            query: [],
            header: ['x-request-id'],
            cookie: [],
          },
          requestBodyContentTypes: ['application/json'],
          responseStatusCodes: ['201'],
        },
      ],
      count: 2,
      openapi: null,
    })
  })

  it('returns raw OpenAPI when includeRawOpenapi is true', async () => {
    const openapi = {
      openapi: '3.1.0',
      paths: {},
    }

    fetchMock.mockResolvedValueOnce(Response.json(openapi))

    await expect(execute({
      projectId: 123456,
      baseUrl: 'https://gateway.example.com/apifox',
      locale: 'en-US',
      branchId: 1,
      moduleId: 2,
      includeRawOpenapi: true,
    })).resolves.toEqual({
      apis: [],
      count: 0,
      openapi,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://gateway.example.com/apifox/v1/projects/123456/export-openapi?locale=en-US'),
      {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Authorization: 'Bearer test-token',
          'X-Apifox-Api-Version': '2024-03-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scope: { type: 'ALL' },
          options: {
            includeApifoxExtensionProperties: false,
            addFoldersToTags: false,
          },
          oasVersion: '3.1',
          exportFormat: 'JSON',
          branchId: 1,
          moduleId: 2,
        }),
      },
    )
  })
})
