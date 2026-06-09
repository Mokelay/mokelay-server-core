import { mokelayError } from '../mokelay-error.js'
import { type BlockExecutor } from '../orchestration-schema.js'
import {
  assertExpectedHeadSha,
  buildGitCommitCounts,
  isRecord,
  mapGitStatusToError,
  normalizeGitCommitInputs,
  normalizeGitProjectId,
  normalizeHttpBaseUrl,
  readJsonResponse,
  stringFromRecord,
  type GitCommitOutputs,
} from './gitShared.js'

const defaultGitlabBaseUrl = 'https://gitlab.com'

/**
 * gitlabCommit block
 *
 * 作用：
 * 通过 GitLab Commits API 在远程项目中创建一个 commit。该 block 不依赖服务端本地 Git
 * 工作目录，也不会执行 shell git 命令。
 *
 * inputs：
 * - token: 必填。GitLab 访问令牌，直接填入 API JSON 时会在 debug 输出中脱敏为 [redacted]。
 *   推荐来源：
 *   1. Personal Access Token：GitLab -> User settings -> Access tokens。
 *   2. Project Access Token：项目 -> Settings -> Access Tokens。
 *   3. Group Access Token：组 -> Settings -> Access Tokens。
 *   推荐授予 api scope；该 block 会读取 branch、检查文件是否存在，并调用 create commit API。
 * - projectId: 必填。GitLab project id 或 URL encoded 前的项目路径。
 *   示例：12345 或 "mokelay/mokelay-server"。代码会自动对该值做 URL encode。
 * - branch: 必填。目标分支名，例如 "main" 或 "release/api-json"；分支必须已存在，
 *   block 不会自动创建分支。
 * - message: 必填。commit message，例如 "Publish API JSON"。
 * - files: 必填非空数组。一次 commit 中要变更的文件列表。
 *   - path: 必填。仓库内相对路径，例如 "server/assets/mokelay-apis/demo.json"；
 *     不能是绝对路径，不能包含 ".."、反斜杠或空 path segment。
 *   - action: 可选，默认 "upsert"。支持：
 *     - "upsert": block 会先检查文件是否存在，存在则映射为 GitLab action="update"，
 *       不存在则映射为 action="create"。
 *     - "delete": 删除文件；delete 项不能设置 content。
 *   - content: action="upsert" 时必填。文件内容字符串。
 *   - encoding: 可选，默认 "utf8"。支持：
 *     - "utf8": 普通文本内容，会以 GitLab API 的 encoding="text" 提交。
 *     - "base64": base64 编码内容，适合二进制或调用方已编码内容。
 * - baseUrl: 可选，默认 "https://gitlab.com"。自建 GitLab 可配置成实例根地址，
 *   例如 "https://gitlab.example.com"；不要带 "/api/v4"。
 * - authorName / authorEmail: 可选，但必须同时配置。用于设置 commit author。
 * - expectedHeadSha: 可选。乐观锁；如果远程分支当前 HEAD 不是该 SHA，则返回
 *   BLOCK_GIT_HEAD_MISMATCH，避免覆盖调用方未预期的新提交。
 *
 * outputs：
 * - provider: 固定为 "gitlab"。
 * - repo: 固定为 null；该字段为 GitHub 输出兼容保留。
 * - projectId: 输入 projectId 的标准字符串形式。
 * - branch: 实际提交的目标分支。
 * - commitSha: 新创建 commit 的完整 SHA；如果 GitLab 只返回 short_id，则使用 short_id。
 * - commitUrl: 新 commit 的 GitLab 页面 URL；如果 API 未返回则为 null。
 * - treeSha: 新 commit 对应 tree SHA；如果 API 未返回则为 null。
 * - parentSha: 提交前目标分支的 HEAD SHA。
 * - fileCount: files 总数。
 * - upsertedCount: action="upsert" 的文件数量。
 * - deletedCount: action="delete" 的文件数量。
 */

function gitlabApiUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/api/v4/${path.replace(/^\/+/, '')}`
}

async function gitlabFetchJson(url: string, token: string, init?: RequestInit, branchNotFound = false) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': token,
      ...init?.headers,
    },
  })

  const body = await readJsonResponse(response)

  if (!response.ok) {
    throw mapGitStatusToError(response.status, branchNotFound)
  }

  if (!isRecord(body)) {
    throw mokelayError('BLOCK_GIT_REQUEST_FAILED', 'GitLab 返回内容无效。', 502)
  }

  return body
}

async function gitlabFileExists(baseUrl: string, token: string, projectId: string, branch: string, path: string) {
  const url = gitlabApiUrl(
    baseUrl,
    `projects/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
  )
  const response = await fetch(url, {
    method: 'HEAD',
    headers: {
      'PRIVATE-TOKEN': token,
    },
  })

  if (response.status === 200) {
    return true
  }

  if (response.status === 404) {
    return false
  }

  throw mapGitStatusToError(response.status)
}

export const executeGitlabCommitBlock: BlockExecutor = async ({ inputs }): Promise<GitCommitOutputs> => {
  const normalizedInputs = normalizeGitCommitInputs(inputs)
  const projectId = normalizeGitProjectId(inputs.projectId)
  const baseUrl = normalizeHttpBaseUrl(inputs.baseUrl, 'baseUrl', defaultGitlabBaseUrl)
  const encodedProjectId = encodeURIComponent(projectId)

  const branch = await gitlabFetchJson(
    gitlabApiUrl(baseUrl, `projects/${encodedProjectId}/repository/branches/${encodeURIComponent(normalizedInputs.branch)}`),
    normalizedInputs.token,
    undefined,
    true,
  )
  const commit = isRecord(branch.commit) ? branch.commit : null
  const parentSha = commit ? stringFromRecord(commit, 'id') : undefined

  if (!parentSha) {
    throw mokelayError('BLOCK_GIT_REQUEST_FAILED', 'GitLab 分支返回 commit 无效。', 502)
  }

  assertExpectedHeadSha(parentSha, normalizedInputs.expectedHeadSha)

  const actions = []

  for (const file of normalizedInputs.files) {
    if (file.action === 'delete') {
      actions.push({
        action: 'delete',
        file_path: file.path,
      })
      continue
    }

    const exists = await gitlabFileExists(baseUrl, normalizedInputs.token, projectId, normalizedInputs.branch, file.path)

    actions.push({
      action: exists ? 'update' : 'create',
      file_path: file.path,
      content: file.content,
      encoding: file.encoding === 'base64' ? 'base64' : 'text',
    })
  }

  const createdCommit = await gitlabFetchJson(
    gitlabApiUrl(baseUrl, `projects/${encodedProjectId}/repository/commits`),
    normalizedInputs.token,
    {
      method: 'POST',
      body: JSON.stringify({
        branch: normalizedInputs.branch,
        commit_message: normalizedInputs.message,
        actions,
        author_name: normalizedInputs.authorName,
        author_email: normalizedInputs.authorEmail,
      }),
    },
  )
  const commitSha = stringFromRecord(createdCommit, 'id') ?? stringFromRecord(createdCommit, 'short_id')

  if (!commitSha) {
    throw mokelayError('BLOCK_GIT_REQUEST_FAILED', 'GitLab commit 创建返回 id 无效。', 502)
  }

  const counts = buildGitCommitCounts(normalizedInputs.files)

  return {
    provider: 'gitlab',
    repo: null,
    projectId,
    branch: normalizedInputs.branch,
    commitSha,
    commitUrl: stringFromRecord(createdCommit, 'web_url') ?? null,
    treeSha: stringFromRecord(createdCommit, 'tree_id') ?? null,
    parentSha,
    ...counts,
  }
}
