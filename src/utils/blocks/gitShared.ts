import { mokelayError } from '../mokelay-error.js'

export type GitFileAction = 'upsert' | 'delete'
export type GitFileEncoding = 'utf8' | 'base64'

export type NormalizedGitFile = {
  path: string
  action: GitFileAction
  content?: string
  encoding: GitFileEncoding
}

export type NormalizedGitCommitInputs = {
  token: string
  branch: string
  message: string
  files: NormalizedGitFile[]
  authorName?: string
  authorEmail?: string
  expectedHeadSha?: string
}

export type GitCommitOutputs = {
  provider: 'github' | 'gitlab'
  repo: string | null
  projectId: string | null
  branch: string
  commitSha: string
  commitUrl: string | null
  treeSha: string | null
  parentSha: string
  fileCount: number
  upsertedCount: number
  deletedCount: number
}

export const gitCommitOutputKeys = [
  'provider',
  'repo',
  'projectId',
  'branch',
  'commitSha',
  'commitUrl',
  'treeSha',
  'parentSha',
  'fileCount',
  'upsertedCount',
  'deletedCount',
] as const

function requiredString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError('BLOCK_GIT_INPUT_INVALID', `${name} 必须是非空字符串。`, 400)
  }

  return value.trim()
}

export function normalizeGitToken(value: unknown) {
  return requiredString(value, 'token')
}

export function normalizeGitMessage(value: unknown) {
  return requiredString(value, 'message')
}

export function normalizeGitBranch(value: unknown) {
  const branch = requiredString(value, 'branch')

  if (
    branch.startsWith('/')
    || branch.endsWith('/')
    || branch.includes('..')
    || branch.includes('@{')
    || /[\s~^:?*[\\\]]/.test(branch)
  ) {
    throw mokelayError('BLOCK_GIT_INPUT_INVALID', 'branch 不是合法 Git 分支名。', 400)
  }

  return branch
}

export function normalizeGitRepo(value: unknown) {
  const repo = requiredString(value, 'repo')

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw mokelayError('BLOCK_GIT_INPUT_INVALID', 'repo 必须是 owner/repo 格式。', 400)
  }

  return repo
}

export function normalizeGitProjectId(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value)
  }

  return requiredString(value, 'projectId')
}

export function normalizeOptionalGitSha(value: unknown, name: string) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  return requiredString(value, name)
}

export function normalizeOptionalAuthorName(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  return requiredString(value, 'authorName')
}

export function normalizeOptionalAuthorEmail(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  const email = requiredString(value, 'authorEmail')

  if (!email.includes('@')) {
    throw mokelayError('BLOCK_GIT_INPUT_INVALID', 'authorEmail 必须是合法邮箱字符串。', 400)
  }

  return email
}

export function normalizeHttpBaseUrl(value: unknown, name: string, defaultValue: string) {
  if (value === undefined || value === null || value === '') {
    return defaultValue
  }

  const rawValue = requiredString(value, name)

  try {
    const url = new URL(rawValue)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Unsupported protocol: ${url.protocol}`)
    }

    return url.toString().replace(/\/+$/, '')
  } catch (error) {
    throw mokelayError('BLOCK_GIT_INPUT_INVALID', `${name} 必须是合法的 HTTP(S) URL。`, 400, error)
  }
}

function normalizeGitPath(value: unknown) {
  const path = requiredString(value, 'files[].path')
  const parts = path.split('/')

  if (
    path.startsWith('/')
    || path.includes('\\')
    || parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw mokelayError('BLOCK_GIT_INPUT_INVALID', 'files[].path 必须是安全的仓库相对路径。', 400)
  }

  return path
}

function normalizeGitFileAction(value: unknown): GitFileAction {
  if (value === undefined || value === null || value === '') {
    return 'upsert'
  }

  if (value === 'upsert' || value === 'delete') {
    return value
  }

  throw mokelayError('BLOCK_GIT_INPUT_INVALID', 'files[].action 必须是 upsert 或 delete。', 400)
}

function normalizeGitFileEncoding(value: unknown): GitFileEncoding {
  if (value === undefined || value === null || value === '') {
    return 'utf8'
  }

  if (value === 'utf8' || value === 'base64') {
    return value
  }

  throw mokelayError('BLOCK_GIT_INPUT_INVALID', 'files[].encoding 必须是 utf8 或 base64。', 400)
}

export function normalizeGitFiles(value: unknown): NormalizedGitFile[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw mokelayError('BLOCK_GIT_INPUT_INVALID', 'files 必须是非空数组。', 400)
  }

  const seenPaths = new Set<string>()

  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw mokelayError('BLOCK_GIT_INPUT_INVALID', 'files[] 必须是对象。', 400)
    }

    const record = item as Record<string, unknown>
    const path = normalizeGitPath(record.path)

    if (seenPaths.has(path)) {
      throw mokelayError('BLOCK_GIT_INPUT_INVALID', `files 包含重复路径：${path}`, 400)
    }

    seenPaths.add(path)

    const action = normalizeGitFileAction(record.action)
    const encoding = normalizeGitFileEncoding(record.encoding)

    if (action === 'delete') {
      if (Object.prototype.hasOwnProperty.call(record, 'content')) {
        throw mokelayError('BLOCK_GIT_INPUT_INVALID', 'delete 文件不能配置 content。', 400)
      }

      return { path, action, encoding }
    }

    if (typeof record.content !== 'string') {
      throw mokelayError('BLOCK_GIT_INPUT_INVALID', 'upsert 文件的 content 必须是字符串。', 400)
    }

    return { path, action, content: record.content, encoding }
  })
}

export function normalizeGitCommitInputs(inputs: Record<string, unknown>): NormalizedGitCommitInputs {
  const authorName = normalizeOptionalAuthorName(inputs.authorName)
  const authorEmail = normalizeOptionalAuthorEmail(inputs.authorEmail)

  if ((authorName && !authorEmail) || (!authorName && authorEmail)) {
    throw mokelayError('BLOCK_GIT_INPUT_INVALID', 'authorName 和 authorEmail 必须同时配置。', 400)
  }

  return {
    token: normalizeGitToken(inputs.token),
    branch: normalizeGitBranch(inputs.branch),
    message: normalizeGitMessage(inputs.message),
    files: normalizeGitFiles(inputs.files),
    authorName,
    authorEmail,
    expectedHeadSha: normalizeOptionalGitSha(inputs.expectedHeadSha, 'expectedHeadSha'),
  }
}

export function buildGitCommitCounts(files: NormalizedGitFile[]) {
  const upsertedCount = files.filter((file) => file.action === 'upsert').length
  const deletedCount = files.filter((file) => file.action === 'delete').length

  return {
    fileCount: files.length,
    upsertedCount,
    deletedCount,
  }
}

export async function readJsonResponse(response: Response) {
  try {
    return await response.json() as unknown
  } catch {
    return null
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key]

  return typeof value === 'string' ? value : undefined
}

export function assertExpectedHeadSha(actual: string, expected: string | undefined) {
  if (expected && actual !== expected) {
    throw mokelayError('BLOCK_GIT_HEAD_MISMATCH', '远程分支 HEAD 与 expectedHeadSha 不一致。', 409)
  }
}

export function mapGitStatusToError(status: number, branchNotFound = false) {
  if (status === 401 || status === 403) {
    return mokelayError('BLOCK_GIT_AUTH_FAILED', 'Git 服务认证失败。', 401)
  }

  if (status === 404 && branchNotFound) {
    return mokelayError('BLOCK_GIT_BRANCH_NOT_FOUND', '目标分支不存在。', 404)
  }

  return mokelayError('BLOCK_GIT_REQUEST_FAILED', 'Git 服务请求失败。', 502)
}
