import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeGitlabCommitBlock } from '../src/utils/blocks/gitlabCommit.js'

const originalFetch = globalThis.fetch
const fetchMock = vi.fn()

function execute(inputs: Record<string, unknown>) {
  return executeGitlabCommitBlock({
    event: undefined as never,
    block: undefined as never,
    inputs,
    executeSql: undefined as never,
  })
}

function baseInputs(overrides: Record<string, unknown> = {}) {
  return {
    token: 'gitlab-token',
    projectId: 'mokelay/demo',
    branch: 'main',
    message: 'Update generated files',
    files: [
      {
        path: 'server/assets/demo.json',
        action: 'upsert',
        content: '{"ok":true}',
      },
    ],
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status })
}

function emptyResponse(status: number) {
  return new Response(null, { status })
}

function lastRequestBody() {
  const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined

  if (!init || typeof init.body !== 'string') {
    throw new Error('Expected last fetch call to include JSON body.')
  }

  return JSON.parse(init.body) as Record<string, unknown>
}

describe('executeGitlabCommitBlock', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    globalThis.fetch = fetchMock as typeof fetch
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  it('rejects invalid files', async () => {
    await expect(execute(baseInputs({
      files: [
        { path: '/absolute.txt', action: 'upsert', content: 'x' },
      ],
    }))).rejects.toMatchObject({
      data: { code: 'BLOCK_GIT_INPUT_INVALID' },
      statusCode: 400,
    })

    await expect(execute(baseInputs({
      files: [
        { path: 'delete.txt', action: 'delete', content: 'x' },
      ],
    }))).rejects.toMatchObject({
      data: { code: 'BLOCK_GIT_INPUT_INVALID' },
      statusCode: 400,
    })

    await expect(execute(baseInputs({
      files: [
        { path: 'bad.txt', action: 'upsert', content: 'x', encoding: 'binary' },
      ],
    }))).rejects.toMatchObject({
      data: { code: 'BLOCK_GIT_INPUT_INVALID' },
      statusCode: 400,
    })
  })

  it('creates a GitLab commit and maps upserts to create/update actions', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ commit: { id: 'parent-sha' } }))
      .mockResolvedValueOnce(emptyResponse(200))
      .mockResolvedValueOnce(emptyResponse(404))
      .mockResolvedValueOnce(jsonResponse({
        id: 'commit-sha',
        web_url: 'https://gitlab.com/mokelay/demo/-/commit/commit-sha',
        tree_id: 'tree-sha',
      }))

    await expect(execute(baseInputs({
      expectedHeadSha: 'parent-sha',
      authorName: 'Mokelay Bot',
      authorEmail: 'bot@mokelay.com',
      files: [
        { path: 'existing.json', action: 'upsert', content: '{"old":false}' },
        { path: 'new.json', action: 'upsert', content: 'eyJuZXciOnRydWV9', encoding: 'base64' },
        { path: 'old.json', action: 'delete' },
      ],
    }))).resolves.toEqual({
      provider: 'gitlab',
      repo: null,
      projectId: 'mokelay/demo',
      branch: 'main',
      commitSha: 'commit-sha',
      commitUrl: 'https://gitlab.com/mokelay/demo/-/commit/commit-sha',
      treeSha: 'tree-sha',
      parentSha: 'parent-sha',
      fileCount: 3,
      upsertedCount: 2,
      deletedCount: 1,
    })

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://gitlab.com/api/v4/projects/mokelay%2Fdemo/repository/branches/main',
      'https://gitlab.com/api/v4/projects/mokelay%2Fdemo/repository/files/existing.json?ref=main',
      'https://gitlab.com/api/v4/projects/mokelay%2Fdemo/repository/files/new.json?ref=main',
      'https://gitlab.com/api/v4/projects/mokelay%2Fdemo/repository/commits',
    ])
    expect(lastRequestBody()).toMatchObject({
      branch: 'main',
      commit_message: 'Update generated files',
      author_name: 'Mokelay Bot',
      author_email: 'bot@mokelay.com',
      actions: [
        {
          action: 'update',
          file_path: 'existing.json',
          content: '{"old":false}',
          encoding: 'text',
        },
        {
          action: 'create',
          file_path: 'new.json',
          content: 'eyJuZXciOnRydWV9',
          encoding: 'base64',
        },
        {
          action: 'delete',
          file_path: 'old.json',
        },
      ],
    })
  })

  it('maps branch missing and head mismatch to Git errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: '404 Branch Not Found' }, 404))

    await expect(execute(baseInputs())).rejects.toMatchObject({
      data: { code: 'BLOCK_GIT_BRANCH_NOT_FOUND' },
      statusCode: 404,
    })

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse({ commit: { id: 'actual-sha' } }))

    await expect(execute(baseInputs({ expectedHeadSha: 'expected-sha' }))).rejects.toMatchObject({
      data: { code: 'BLOCK_GIT_HEAD_MISMATCH' },
      statusCode: 409,
    })
  })

  it('maps authentication and provider failures', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: '401 Unauthorized' }, 401))

    await expect(execute(baseInputs())).rejects.toMatchObject({
      data: { code: 'BLOCK_GIT_AUTH_FAILED' },
      statusCode: 401,
    })

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse({ commit: { id: 'parent-sha' } }))
    fetchMock.mockResolvedValueOnce(emptyResponse(500))

    await expect(execute(baseInputs())).rejects.toMatchObject({
      data: { code: 'BLOCK_GIT_REQUEST_FAILED' },
      statusCode: 502,
    })
  })
})
