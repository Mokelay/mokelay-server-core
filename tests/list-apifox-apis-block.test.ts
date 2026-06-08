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

function lastRequestBody() {
  const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined

  if (!init || typeof init.body !== 'string') {
    throw new Error('Expected fetch to be called with a JSON string body.')
  }

  return JSON.parse(init.body) as Record<string, unknown>
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
            {
              name: 'x-request-id',
              in: 'header',
              description: 'Trace request id.',
              example: 'req-123',
            },
          ],
          get: {
            summary: 'Read user',
            description: 'Read one user.',
            tags: ['User'],
            operationId: 'readUser',
            parameters: [
              {
                name: 'id',
                in: 'path',
                description: 'User ID.',
                required: true,
                example: 'user-1',
              },
              {
                name: 'includePosts',
                in: 'query',
                description: 'Include user posts.',
                schema: {
                  type: 'boolean',
                  example: true,
                },
              },
            ],
            responses: {
              200: {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['data'],
                      properties: {
                        code: {
                          type: 'integer',
                          description: 'Status code.',
                          example: 0,
                        },
                        data: {
                          description: 'User payload.',
                          $ref: '#/components/schemas/User',
                        },
                      },
                    },
                    examples: {
                      success: {
                        summary: 'Success example.',
                        value: {
                          code: 0,
                          data: {
                            id: 'user-1',
                            name: 'Ada',
                          },
                        },
                      },
                    },
                  },
                },
              },
              404: { description: 'Not found' },
            },
          },
          post: {
            deprecated: true,
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['email'],
                    properties: {
                      email: {
                        type: 'string',
                        description: 'User email.',
                        example: 'ada@example.com',
                      },
                      profile: {
                        type: 'object',
                        description: 'User profile.',
                        required: ['nickname'],
                        properties: {
                          nickname: {
                            type: 'string',
                            description: 'Display name.',
                            example: 'Ada',
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            responses: {
              201: { description: 'Created' },
            },
          },
        },
      },
      components: {
        schemas: {
          User: {
            type: 'object',
            required: ['id'],
            properties: {
              id: {
                type: 'string',
                description: 'User ID.',
                example: 'user-1',
              },
              name: {
                type: 'string',
                description: 'User name.',
                example: 'Ada',
              },
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
          parameterDetails: {
            path: [
              {
                name: 'id',
                in: 'path',
                description: 'User ID.',
                required: true,
                deprecated: false,
                example: 'user-1',
                examples: null,
              },
            ],
            query: [
              {
                name: 'includePosts',
                in: 'query',
                description: 'Include user posts.',
                required: false,
                deprecated: false,
                example: true,
                examples: null,
              },
            ],
            header: [
              {
                name: 'x-request-id',
                in: 'header',
                description: 'Trace request id.',
                required: false,
                deprecated: false,
                example: 'req-123',
                examples: null,
              },
            ],
            cookie: [],
          },
          requestBodyContentTypes: [],
          requestBodyParameters: [],
          responseStatusCodes: ['200', '404'],
          responseDetails: [
            {
              statusCode: '200',
              description: 'OK',
              contentTypes: ['application/json'],
              contents: [
                {
                  contentType: 'application/json',
                  schemaDescription: null,
                  example: null,
                  examples: {
                    success: {
                      summary: 'Success example.',
                      value: {
                        code: 0,
                        data: {
                          id: 'user-1',
                          name: 'Ada',
                        },
                      },
                    },
                  },
                },
              ],
            },
            {
              statusCode: '404',
              description: 'Not found',
              contentTypes: [],
              contents: [],
            },
          ],
          responseBodyParameters: [
            {
              statusCode: '200',
              contentType: 'application/json',
              name: 'code',
              path: 'code',
              description: 'Status code.',
              required: false,
              deprecated: false,
              example: 0,
              examples: null,
            },
            {
              statusCode: '200',
              contentType: 'application/json',
              name: 'data',
              path: 'data',
              description: 'User payload.',
              required: true,
              deprecated: false,
              example: null,
              examples: null,
            },
            {
              statusCode: '200',
              contentType: 'application/json',
              name: 'id',
              path: 'data.id',
              description: 'User ID.',
              required: true,
              deprecated: false,
              example: 'user-1',
              examples: null,
            },
            {
              statusCode: '200',
              contentType: 'application/json',
              name: 'name',
              path: 'data.name',
              description: 'User name.',
              required: false,
              deprecated: false,
              example: 'Ada',
              examples: null,
            },
          ],
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
          parameterDetails: {
            path: [],
            query: [],
            header: [
              {
                name: 'x-request-id',
                in: 'header',
                description: 'Trace request id.',
                required: false,
                deprecated: false,
                example: 'req-123',
                examples: null,
              },
            ],
            cookie: [],
          },
          requestBodyContentTypes: ['application/json'],
          requestBodyParameters: [
            {
              contentType: 'application/json',
              name: 'email',
              path: 'email',
              description: 'User email.',
              required: true,
              deprecated: false,
              example: 'ada@example.com',
              examples: null,
            },
            {
              contentType: 'application/json',
              name: 'profile',
              path: 'profile',
              description: 'User profile.',
              required: false,
              deprecated: false,
              example: null,
              examples: null,
            },
            {
              contentType: 'application/json',
              name: 'nickname',
              path: 'profile.nickname',
              description: 'Display name.',
              required: true,
              deprecated: false,
              example: 'Ada',
              examples: null,
            },
          ],
          responseStatusCodes: ['201'],
          responseDetails: [
            {
              statusCode: '201',
              description: 'Created',
              contentTypes: [],
              contents: [],
            },
          ],
          responseBodyParameters: [],
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

  it('exports APIs from a selected folder when folderId is provided', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({
      openapi: '3.1.0',
      paths: {},
    }))

    await expect(execute({
      projectId: '123456',
      folderId: '76',
    })).resolves.toMatchObject({
      apis: [],
      count: 0,
      openapi: null,
    })

    expect(lastRequestBody().scope).toEqual({
      type: 'SELECTED_FOLDERS',
      selectedFolderIds: [76],
    })
  })

  it('exports a selected endpoint when apiId is provided', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({
      openapi: '3.1.0',
      paths: {},
    }))

    await expect(execute({
      projectId: '123456',
      apiId: '88',
    })).resolves.toMatchObject({
      apis: [],
      count: 0,
      openapi: null,
    })

    expect(lastRequestBody().scope).toEqual({
      type: 'SELECTED_ENDPOINTS',
      selectedEndpointIds: [88],
    })
  })

  it('prioritizes apiId over folderId when both are provided', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({
      openapi: '3.1.0',
      paths: {},
    }))

    await expect(execute({
      projectId: '123456',
      folderId: 76,
      apiId: 88,
    })).resolves.toMatchObject({
      apis: [],
      count: 0,
      openapi: null,
    })

    expect(lastRequestBody().scope).toEqual({
      type: 'SELECTED_ENDPOINTS',
      selectedEndpointIds: [88],
    })
  })

  it.each([
    ['folderId', 0],
    ['folderId', -1],
    ['folderId', 1.5],
    ['folderId', 'abc'],
    ['folderId', '1.5'],
    ['apiId', 0],
    ['apiId', -1],
    ['apiId', 1.5],
    ['apiId', 'abc'],
    ['apiId', '1.5'],
  ])('rejects invalid %s value %p', async (name, value) => {
    await expect(execute({
      projectId: '123456',
      [name]: value,
    })).rejects.toMatchObject({
      data: { code: 'BLOCK_APIFOX_INPUT_INVALID' },
      statusCode: 400,
    })
  })
})
