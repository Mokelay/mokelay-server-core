import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeGithubCommitBlock } from '../src/utils/blocks/githubCommit.js'

const originalFetch = globalThis.fetch
const fetchMock = vi.fn()

function execute(inputs: Record<string, unknown>) {
  return executeGithubCommitBlock({
    event: undefined as never,
    block: undefined as never,
    inputs,
    executeSql: undefined as never,
  })
}

function baseInputs(overrides: Record<string, unknown> = {}) {
  return {
    token: 'github-token',
    repo: 'mokelay/demo',
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

function requestBody(callIndex: number) {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined

  if (!init || typeof init.body !== 'string') {
    throw new Error(`Expected call ${callIndex} to include JSON body.`)
  }

  return JSON.parse(init.body) as Record<string, unknown>
}

describe('executeGithubCommitBlock', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    globalThis.fetch = fetchMock as typeof fetch
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  it('rejects invalid shared inputs', async () => {
    await expect(execute(baseInputs({ token: '' }))).rejects.toMatchObject({
      data: { code: 'BLOCK_GIT_INPUT_INVALID' },
      statusCode: 400,
    })

    await expect(execute(baseInputs({ repo: 'mokelay' }))).rejects.toMatchObject({
      data: { code: 'BLOCK_GIT_INPUT_INVALID' },
      statusCode: 400,
    })

    await expect(execute(baseInputs({
      files: [
        { path: '../secret.txt', action: 'upsert', content: 'x' },
      ],
    }))).rejects.toMatchObject({
      data: { code: 'BLOCK_GIT_INPUT_INVALID' },
      statusCode: 400,
    })

    await expect(execute(baseInputs({
      files: [
        { path: 'a.txt', action: 'upsert', content: 'x' },
        { path: 'a.txt', action: 'delete' },
      ],
    }))).rejects.toMatchObject({
      data: { code: 'BLOCK_GIT_INPUT_INVALID' },
      statusCode: 400,
    })
  })

  it('creates a multi-file GitHub commit with blobs, tree, commit, and ref update', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'parent-sha' } }))
      .mockResolvedValueOnce(jsonResponse({ tree: { sha: 'base-tree-sha' } }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'blob-sha-1' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'new-tree-sha' }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'commit-sha', html_url: 'https://github.com/mokelay/demo/commit/commit-sha' }))
      .mockResolvedValueOnce(jsonResponse({ ref: 'refs/heads/main' }))

    await expect(execute(baseInputs({
      expectedHeadSha: 'parent-sha',
      authorName: 'Mokelay Bot',
      authorEmail: 'bot@mokelay.com',
      files: [
        { path: 'server/assets/demo.json', action: 'upsert', content: '{"ok":true}', encoding: 'utf8' },
        { path: 'old/demo.json', action: 'delete' },
      ],
    }))).resolves.toEqual({
      provider: 'github',
      repo: 'mokelay/demo',
      projectId: null,
      branch: 'main',
      commitSha: 'commit-sha',
      commitUrl: 'https://github.com/mokelay/demo/commit/commit-sha',
      treeSha: 'new-tree-sha',
      parentSha: 'parent-sha',
      fileCount: 2,
      upsertedCount: 1,
      deletedCount: 1,
    })

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://api.github.com/repos/mokelay/demo/git/ref/heads/main',
      'https://api.github.com/repos/mokelay/demo/git/commits/parent-sha',
      'https://api.github.com/repos/mokelay/demo/git/blobs',
      'https://api.github.com/repos/mokelay/demo/git/trees',
      'https://api.github.com/repos/mokelay/demo/git/commits',
      'https://api.github.com/repos/mokelay/demo/git/refs/heads/main',
    ])
    expect(requestBody(2)).toMatchObject({
      content: '{"ok":true}',
      encoding: 'utf-8',
    })
    expect(requestBody(3)).toEqual({
      base_tree: 'base-tree-sha',
      tree: [
        {
          path: 'server/assets/demo.json',
          mode: '100644',
          type: 'blob',
          sha: 'blob-sha-1',
        },
        {
          path: 'old/demo.json',
          mode: '100644',
          type: 'blob',
          sha: null,
        },
      ],
    })
    expect(requestBody(4)).toMatchObject({
      message: 'Update generated files',
      tree: 'new-tree-sha',
      parents: ['parent-sha'],
      author: {
        name: 'Mokelay Bot',
        email: 'bot@mokelay.com',
      },
    })
  })

  it('maps missing branch and head mismatch to Git errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404))

    await expect(execute(baseInputs())).rejects.toMatchObject({
      data: { code: 'BLOCK_GIT_BRANCH_NOT_FOUND' },
      statusCode: 404,
    })

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse({ object: { sha: 'actual-sha' } }))

    await expect(execute(baseInputs({ expectedHeadSha: 'expected-sha' }))).rejects.toMatchObject({
      data: { code: 'BLOCK_GIT_HEAD_MISMATCH' },
      statusCode: 409,
    })
  })

  it('maps authentication and provider failures', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Bad credentials' }, 401))

    await expect(execute(baseInputs())).rejects.toMatchObject({
      data: { code: 'BLOCK_GIT_AUTH_FAILED' },
      statusCode: 401,
    })

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse({ object: { sha: 'parent-sha' } }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Server error' }, 500))

    await expect(execute(baseInputs())).rejects.toMatchObject({
      data: { code: 'BLOCK_GIT_REQUEST_FAILED' },
      statusCode: 502,
    })
  })
})
