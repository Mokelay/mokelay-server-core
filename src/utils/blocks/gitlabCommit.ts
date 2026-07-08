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

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "gitlabCommit",
 *   "displayName": "提交 GitLab 项目",
 *   "category": "integration",
 *   "description": "通过 GitLab Commits API 在远程项目中创建 commit，不依赖服务端本地 Git 工作目录。",
 *   "inputs": [
 *     { "key": "token", "type": "string", "required": true, "description": "GitLab 访问令牌；debug 输出会脱敏。" },
 *     { "key": "projectId", "type": "string|number", "required": true, "description": "GitLab project id 或项目路径。" },
 *     { "key": "branch", "type": "string", "required": true, "description": "已存在的目标分支名。" },
 *     { "key": "message", "type": "string", "required": true, "description": "commit message。" },
 *     { "key": "files", "type": "GitFile[]", "required": true, "description": "非空文件变更数组；action 支持 upsert/delete，encoding 支持 utf8/base64。" },
 *     { "key": "baseUrl", "type": "string", "required": false, "defaultValue": "https://gitlab.com", "description": "GitLab 实例根地址，不包含 /api/v4。" },
 *     { "key": "authorName", "type": "string", "required": false, "description": "commit author 名称；需与 authorEmail 同时配置。" },
 *     { "key": "authorEmail", "type": "string", "required": false, "description": "commit author 邮箱；需与 authorName 同时配置。" },
 *     { "key": "expectedHeadSha", "type": "string", "required": false, "description": "乐观锁，远程分支 HEAD 不一致时拒绝提交。" }
 *   ],
 *   "outputs": [
 *     { "key": "provider", "type": "gitlab", "description": "固定为 gitlab。" },
 *     { "key": "repo", "type": "null", "description": "GitHub 兼容字段，固定为 null。" },
 *     { "key": "projectId", "type": "string", "description": "标准化后的 projectId。" },
 *     { "key": "branch", "type": "string", "description": "实际提交分支。" },
 *     { "key": "commitSha", "type": "string", "description": "新 commit SHA 或 short_id。" },
 *     { "key": "commitUrl", "type": "string|null", "description": "新 commit 页面 URL。" },
 *     { "key": "treeSha", "type": "string|null", "description": "新 commit tree SHA。" },
 *     { "key": "parentSha", "type": "string", "description": "提交前分支 HEAD SHA。" },
 *     { "key": "fileCount", "type": "number", "description": "files 总数。" },
 *     { "key": "upsertedCount", "type": "number", "description": "upsert 文件数量。" },
 *     { "key": "deletedCount", "type": "number", "description": "delete 文件数量。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_GIT_INPUT_INVALID", "description": "token/projectId/branch/message/files/author 输入无效。" },
 *     { "code": "BLOCK_GIT_BRANCH_NOT_FOUND", "description": "目标分支不存在。" },
 *     { "code": "BLOCK_GIT_HEAD_MISMATCH", "description": "expectedHeadSha 与远程 HEAD 不一致。" },
 *     { "code": "BLOCK_GIT_REQUEST_FAILED", "description": "GitLab API 请求失败或返回内容无效。" }
 *   ],
 *   "config": [
 *     { "key": "GitLab token scope", "type": "external", "required": true, "description": "推荐授予 api scope；block 会读取 branch、检查文件并创建 commit。" }
 *   ],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "network", "type": "string", "value": "GitLab REST API", "description": "会读取 branch、检查文件是否存在，并调用 create commit API。" }
 *   ],
 *   "examples": [
 *     { "title": "提交 API JSON", "block": { "uuid": "gitlab_commit_block", "functionName": "gitlabCommit", "inputs": { "token": { "template": "{{request.body.token}}" }, "projectId": "mokelay/mokelay-server", "branch": "main", "message": "Publish API JSON", "files": [{ "path": "server/assets/mokelay-apis/demo.json", "action": "upsert", "content": "{}", "encoding": "utf8" }] }, "outputs": ["provider", "repo", "projectId", "branch", "commitSha", "commitUrl", "treeSha", "parentSha", "fileCount", "upsertedCount", "deletedCount"], "nextBlock": null } }
 *   ]
 * }
 */
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
