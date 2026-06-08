import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeListApifoxProjectsBlock } from '../src/utils/blocks/listApifoxProjects.js'

const originalApifoxAccessToken = process.env.APIFOX_ACCESS_TOKEN
const originalFetch = globalThis.fetch

const fetchMock = vi.fn()

function execute(inputs: Record<string, unknown>) {
  return executeListApifoxProjectsBlock({
    event: undefined as never,
    block: undefined as never,
    inputs,
    executeSql: undefined as never,
  })
}

describe('executeListApifoxProjectsBlock', () => {
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

  it('rejects missing APIFOX_ACCESS_TOKEN', async () => {
    delete process.env.APIFOX_ACCESS_TOKEN

    await expect(execute({})).rejects.toMatchObject({
      data: { code: 'BLOCK_APIFOX_CONFIG_MISSING' },
      statusCode: 500,
    })
  })

  it('rejects invalid baseUrl', async () => {
    await expect(execute({
      baseUrl: 'not-a-url',
    })).rejects.toMatchObject({
      data: { code: 'BLOCK_APIFOX_INPUT_INVALID' },
      statusCode: 400,
    })
  })

  it('maps non-2xx APIFox responses to request failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Forbidden', {
      status: 403,
      statusText: 'Forbidden',
    }))

    await expect(execute({})).rejects.toMatchObject({
      data: { code: 'BLOCK_APIFOX_REQUEST_FAILED' },
      statusCode: 502,
    })
  })

  it('maps invalid JSON to response failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not-json', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(execute({})).rejects.toMatchObject({
      data: { code: 'BLOCK_APIFOX_RESPONSE_INVALID' },
      statusCode: 502,
    })
  })

  it('maps responses without a project list to response failures', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: { total: 0 } }))

    await expect(execute({})).rejects.toMatchObject({
      data: { code: 'BLOCK_APIFOX_RESPONSE_INVALID' },
      statusCode: 502,
    })
  })

  it('extracts projects from data arrays and hides raw response by default', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({
      data: [
        {
          id: 123,
          name: 'Core API',
          description: 'Internal project.',
          role: 'admin',
          teamId: 9,
          teamName: 'Mokelay',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
        {
          projectId: '456',
          title: 'Website API',
          desc: 'Public project.',
          permission: 'reader',
          org_id: 'org-1',
          org_name: 'Mokelay Org',
          created_at: 1700000000,
          updated_at: 1700001000,
        },
      ],
    }))

    await expect(execute({})).resolves.toEqual({
      projects: [
        {
          id: 123,
          name: 'Core API',
          description: 'Internal project.',
          role: 'admin',
          teamId: 9,
          teamName: 'Mokelay',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
        {
          id: '456',
          name: 'Website API',
          description: 'Public project.',
          role: 'reader',
          teamId: 'org-1',
          teamName: 'Mokelay Org',
          createdAt: 1700000000,
          updatedAt: 1700001000,
        },
      ],
      count: 2,
      raw: null,
    })
  })

  it('extracts projects from data.list and returns raw response when requested', async () => {
    const raw = {
      data: {
        list: [
          {
            uuid: 'project-uuid',
            name: 'Gateway',
            introduction: 'Gateway project.',
          },
        ],
      },
    }

    fetchMock.mockResolvedValueOnce(Response.json(raw))

    await expect(execute({
      baseUrl: 'https://gateway.example.com/apifox',
      locale: 'en-US',
      includeRawResponse: true,
    })).resolves.toEqual({
      projects: [
        {
          id: 'project-uuid',
          name: 'Gateway',
          description: 'Gateway project.',
          role: null,
          teamId: null,
          teamName: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
      count: 1,
      raw,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://gateway.example.com/apifox/api/v1/user-projects?locale=en-US'),
      {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Authorization: 'Bearer test-token',
          'X-Apifox-Api-Version': '2024-03-28',
        },
      },
    )
  })
})
