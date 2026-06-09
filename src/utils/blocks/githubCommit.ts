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

/**
 * githubCommit block
 *
 * 作用：
 * 通过 GitHub REST Git Database API 在远程仓库创建一个 commit，并把目标分支更新到该 commit。
 * 该 block 不依赖服务端本地 Git 工作目录，也不会执行 shell git 命令。
 *
 * inputs：
 * - token: 必填。GitHub 访问令牌，直接填入 API JSON 时会在 debug 输出中脱敏为 [redacted]。
 *   推荐来源：
 *   1. Fine-grained Personal Access Token：GitHub -> Settings -> Developer settings
 *      -> Personal access tokens -> Fine-grained tokens。
 *   2. GitHub App installation token。
 *   令牌至少需要目标仓库的 Contents: Read and write 权限，因为本 block 会读取 ref/commit/tree，
 *   并创建 blob/tree/commit、更新 branch ref。
 * - repo: 必填。目标仓库，格式固定为 "owner/repo"，例如 "mokelay/mokelay-server"。
 * - branch: 必填。目标分支名，例如 "main" 或 "release/api-json"；分支必须已存在，block 不会自动创建分支。
 * - message: 必填。commit message，例如 "Publish API JSON"。
 * - files: 必填非空数组。一次 commit 中要变更的文件列表。
 *   - path: 必填。仓库内相对路径，例如 "server/assets/mokelay-apis/demo.json"；
 *     不能是绝对路径，不能包含 ".."、反斜杠或空 path segment。
 *   - action: 可选，默认 "upsert"。支持：
 *     - "upsert": 文件不存在则新增，存在则更新。
 *     - "delete": 删除文件；delete 项不能设置 content。
 *   - content: action="upsert" 时必填。文件内容字符串。
 *   - encoding: 可选，默认 "utf8"。支持：
 *     - "utf8": 普通文本内容，会以 GitHub API 的 "utf-8" 传给 blob API。
 *     - "base64": base64 编码内容，适合二进制或调用方已编码内容。
 * - apiBaseUrl: 可选，默认 "https://api.github.com"。GitHub Enterprise 可配置成企业 API 地址。
 * - authorName / authorEmail: 可选，但必须同时配置。用于设置 commit author。
 * - expectedHeadSha: 可选。乐观锁；如果远程分支当前 HEAD 不是该 SHA，则返回
 *   BLOCK_GIT_HEAD_MISMATCH，避免覆盖调用方未预期的新提交。
 *
 * outputs：
 * - provider: 固定为 "github"。
 * - repo: 输入 repo，例如 "owner/repo"。
 * - projectId: 固定为 null；该字段为 GitLab 输出兼容保留。
 * - branch: 实际提交的目标分支。
 * - commitSha: 新创建 commit 的完整 SHA。
 * - commitUrl: 新 commit 的 GitHub 页面 URL。
 * - treeSha: 新创建 tree 的 SHA。
 * - parentSha: 提交前目标分支的 HEAD SHA。
 * - fileCount: files 总数。
 * - upsertedCount: action="upsert" 的文件数量。
 * - deletedCount: action="delete" 的文件数量。
 */

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
