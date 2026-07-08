import { type BlockExecutor } from '../orchestration-schema.js'
import {
  assertExpectedHeadSha,
  buildGitCommitCounts,
  isRecord,
  mapGitStatusToError,
  normalizeGitCommitInputs,
  normalizeGitRepo,
  normalizeHttpBaseUrl,
  readJsonResponse,
  stringFromRecord,
  type GitCommitOutputs,
} from './gitShared.js'
import { mokelayError } from '../mokelay-error.js'

const defaultGithubApiBaseUrl = 'https://api.github.com'


function githubApiUrl(apiBaseUrl: string, path: string) {
  return `${apiBaseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function githubBranchRefPath(branch: string) {
  return `heads/${branch.split('/').map((part) => encodeURIComponent(part)).join('/')}`
}

async function githubFetchJson(url: string, token: string, init?: RequestInit, branchNotFound = false) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init?.headers,
    },
  })

  const body = await readJsonResponse(response)

  if (!response.ok) {
    throw mapGitStatusToError(response.status, branchNotFound)
  }

  if (!isRecord(body)) {
    throw mokelayError('BLOCK_GIT_REQUEST_FAILED', 'GitHub 返回内容无效。', 502)
  }

  return body
}

function githubAuthor(inputs: ReturnType<typeof normalizeGitCommitInputs>) {
  if (!inputs.authorName || !inputs.authorEmail) {
    return undefined
  }

  return {
    name: inputs.authorName,
    email: inputs.authorEmail,
  }
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "githubCommit",
 *   "displayName": "提交 GitHub 仓库",
 *   "category": "integration",
 *   "description": "通过 GitHub REST Git Database API 在远程仓库创建 commit，并把目标分支更新到该 commit。",
 *   "inputs": [
 *     { "key": "token", "type": "string", "required": true, "description": "GitHub 访问令牌；debug 输出会脱敏。" },
 *     { "key": "repo", "type": "string", "required": true, "description": "目标仓库，格式 owner/repo。" },
 *     { "key": "branch", "type": "string", "required": true, "description": "已存在的目标分支名。" },
 *     { "key": "message", "type": "string", "required": true, "description": "commit message。" },
 *     { "key": "files", "type": "GitFile[]", "required": true, "description": "非空文件变更数组；action 支持 upsert/delete，encoding 支持 utf8/base64。" },
 *     { "key": "apiBaseUrl", "type": "string", "required": false, "defaultValue": "https://api.github.com", "description": "GitHub Enterprise API 地址。" },
 *     { "key": "authorName", "type": "string", "required": false, "description": "commit author 名称；需与 authorEmail 同时配置。" },
 *     { "key": "authorEmail", "type": "string", "required": false, "description": "commit author 邮箱；需与 authorName 同时配置。" },
 *     { "key": "expectedHeadSha", "type": "string", "required": false, "description": "乐观锁，远程分支 HEAD 不一致时拒绝提交。" }
 *   ],
 *   "outputs": [
 *     { "key": "provider", "type": "github", "description": "固定为 github。" },
 *     { "key": "repo", "type": "string", "description": "输入仓库 owner/repo。" },
 *     { "key": "projectId", "type": "null", "description": "GitLab 兼容字段，固定为 null。" },
 *     { "key": "branch", "type": "string", "description": "实际提交分支。" },
 *     { "key": "commitSha", "type": "string", "description": "新 commit SHA。" },
 *     { "key": "commitUrl", "type": "string|null", "description": "新 commit 页面 URL。" },
 *     { "key": "treeSha", "type": "string|null", "description": "新 tree SHA。" },
 *     { "key": "parentSha", "type": "string", "description": "提交前分支 HEAD SHA。" },
 *     { "key": "fileCount", "type": "number", "description": "files 总数。" },
 *     { "key": "upsertedCount", "type": "number", "description": "upsert 文件数量。" },
 *     { "key": "deletedCount", "type": "number", "description": "delete 文件数量。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_GIT_INPUT_INVALID", "description": "token/repo/branch/message/files/author 输入无效。" },
 *     { "code": "BLOCK_GIT_BRANCH_NOT_FOUND", "description": "目标分支不存在。" },
 *     { "code": "BLOCK_GIT_HEAD_MISMATCH", "description": "expectedHeadSha 与远程 HEAD 不一致。" },
 *     { "code": "BLOCK_GIT_REQUEST_FAILED", "description": "GitHub API 请求失败或返回内容无效。" }
 *   ],
 *   "config": [
 *     { "key": "GitHub token permission", "type": "external", "required": true, "description": "令牌至少需要目标仓库 Contents: Read and write 权限。" }
 *   ],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "network", "type": "string", "value": "GitHub REST API", "description": "会读取 ref/commit/tree，并创建 blob/tree/commit、更新 ref。" }
 *   ],
 *   "examples": [
 *     { "title": "提交 API JSON", "block": { "uuid": "github_commit_block", "functionName": "githubCommit", "inputs": { "token": { "template": "{{request.body.token}}" }, "repo": "mokelay/mokelay-server", "branch": "main", "message": "Publish API JSON", "files": [{ "path": "server/assets/mokelay-apis/demo.json", "action": "upsert", "content": "{}", "encoding": "utf8" }] }, "outputs": ["provider", "repo", "projectId", "branch", "commitSha", "commitUrl", "treeSha", "parentSha", "fileCount", "upsertedCount", "deletedCount"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeGithubCommitBlock: BlockExecutor = async ({ inputs }): Promise<GitCommitOutputs> => {
  const normalizedInputs = normalizeGitCommitInputs(inputs)
  const repo = normalizeGitRepo(inputs.repo)
  const apiBaseUrl = normalizeHttpBaseUrl(inputs.apiBaseUrl, 'apiBaseUrl', defaultGithubApiBaseUrl)
  const repoPath = `repos/${repo}`
  const refPath = githubBranchRefPath(normalizedInputs.branch)

  const ref = await githubFetchJson(
    githubApiUrl(apiBaseUrl, `${repoPath}/git/ref/${refPath}`),
    normalizedInputs.token,
    undefined,
    true,
  )
  const refObject = isRecord(ref.object) ? ref.object : null
  const parentSha = refObject ? stringFromRecord(refObject, 'sha') : undefined

  if (!parentSha) {
    throw mokelayError('BLOCK_GIT_REQUEST_FAILED', 'GitHub 分支引用返回内容无效。', 502)
  }

  assertExpectedHeadSha(parentSha, normalizedInputs.expectedHeadSha)

  const parentCommit = await githubFetchJson(
    githubApiUrl(apiBaseUrl, `${repoPath}/git/commits/${encodeURIComponent(parentSha)}`),
    normalizedInputs.token,
  )
  const parentTree = isRecord(parentCommit.tree) ? parentCommit.tree : null
  const baseTreeSha = parentTree ? stringFromRecord(parentTree, 'sha') : undefined

  if (!baseTreeSha) {
    throw mokelayError('BLOCK_GIT_REQUEST_FAILED', 'GitHub commit 返回 tree 无效。', 502)
  }

  const treeEntries = []

  for (const file of normalizedInputs.files) {
    if (file.action === 'delete') {
      treeEntries.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: null,
      })
      continue
    }

    const blob = await githubFetchJson(
      githubApiUrl(apiBaseUrl, `${repoPath}/git/blobs`),
      normalizedInputs.token,
      {
        method: 'POST',
        body: JSON.stringify({
          content: file.content,
          encoding: file.encoding === 'utf8' ? 'utf-8' : 'base64',
        }),
      },
    )
    const blobSha = stringFromRecord(blob, 'sha')

    if (!blobSha) {
      throw mokelayError('BLOCK_GIT_REQUEST_FAILED', 'GitHub blob 返回 sha 无效。', 502)
    }

    treeEntries.push({
      path: file.path,
      mode: '100644',
      type: 'blob',
      sha: blobSha,
    })
  }

  const tree = await githubFetchJson(
    githubApiUrl(apiBaseUrl, `${repoPath}/git/trees`),
    normalizedInputs.token,
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeEntries,
      }),
    },
  )
  const treeSha = stringFromRecord(tree, 'sha')

  if (!treeSha) {
    throw mokelayError('BLOCK_GIT_REQUEST_FAILED', 'GitHub tree 返回 sha 无效。', 502)
  }

  const commit = await githubFetchJson(
    githubApiUrl(apiBaseUrl, `${repoPath}/git/commits`),
    normalizedInputs.token,
    {
      method: 'POST',
      body: JSON.stringify({
        message: normalizedInputs.message,
        tree: treeSha,
        parents: [parentSha],
        author: githubAuthor(normalizedInputs),
      }),
    },
  )
  const commitSha = stringFromRecord(commit, 'sha')

  if (!commitSha) {
    throw mokelayError('BLOCK_GIT_REQUEST_FAILED', 'GitHub commit 创建返回 sha 无效。', 502)
  }

  await githubFetchJson(
    githubApiUrl(apiBaseUrl, `${repoPath}/git/refs/${refPath}`),
    normalizedInputs.token,
    {
      method: 'PATCH',
      body: JSON.stringify({
        sha: commitSha,
        force: false,
      }),
    },
  )

  const htmlUrl = stringFromRecord(commit, 'html_url')
  const counts = buildGitCommitCounts(normalizedInputs.files)

  return {
    provider: 'github',
    repo,
    projectId: null,
    branch: normalizedInputs.branch,
    commitSha,
    commitUrl: htmlUrl ?? `https://github.com/${repo}/commit/${commitSha}`,
    treeSha,
    parentSha,
    ...counts,
  }
}
