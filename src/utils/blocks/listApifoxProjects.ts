import { mokelayError } from '../mokelay-error.js'
import { type BlockExecutor } from '../orchestration-schema.js'
import {
  apifoxApiVersion,
  buildApifoxUrl,
  normalizeApifoxBaseUrl,
  normalizeApifoxLocale,
  readApifoxAccessToken,
} from './apifoxShared.js'
import { isRecord } from './shared.js'

type ApifoxProject = {
  id: string | number | null
  name: string | null
  description: string | null
  role: string | null
  teamId: string | number | null
  teamName: string | null
  createdAt: string | number | null
  updatedAt: string | number | null
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' ? value : null
}

function scalarOrNull(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function projectListFromResponse(value: unknown) {
  if (Array.isArray(value)) {
    return value
  }

  if (!isRecord(value)) {
    throw mokelayError('BLOCK_APIFOX_RESPONSE_INVALID', 'APIFox 返回的项目列表不是合法 JSON 对象。', 502)
  }

  if (Array.isArray(value.data)) {
    return value.data
  }

  if (isRecord(value.data) && Array.isArray(value.data.list)) {
    return value.data.list
  }

  if (Array.isArray(value.projects)) {
    return value.projects
  }

  if (Array.isArray(value.list)) {
    return value.list
  }

  throw mokelayError('BLOCK_APIFOX_RESPONSE_INVALID', 'APIFox 返回的项目列表缺少 projects 数组。', 502)
}

function normalizeProject(value: unknown): ApifoxProject {
  if (!isRecord(value)) {
    throw mokelayError('BLOCK_APIFOX_RESPONSE_INVALID', 'APIFox 返回的项目列表包含非法项目。', 502)
  }

  return {
    id: scalarOrNull(value.id ?? value.projectId ?? value.uuid),
    name: stringOrNull(value.name ?? value.title),
    description: stringOrNull(value.description ?? value.introduction ?? value.desc),
    role: stringOrNull(value.role ?? value.permission),
    teamId: scalarOrNull(value.teamId ?? value.team_id ?? value.orgId ?? value.org_id),
    teamName: stringOrNull(value.teamName ?? value.team_name ?? value.orgName ?? value.org_name),
    createdAt: scalarOrNull(value.createdAt ?? value.created_at),
    updatedAt: scalarOrNull(value.updatedAt ?? value.updated_at),
  }
}

async function parseProjectsResponse(response: Response) {
  try {
    return await response.json() as unknown
  } catch (error) {
    throw mokelayError('BLOCK_APIFOX_RESPONSE_INVALID', 'APIFox 返回的项目列表不是合法 JSON。', 502, error)
  }
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "listApifoxProjects",
 *   "displayName": "读取 APIFox 项目",
 *   "category": "integration",
 *   "description": "调用 APIFox 开放 API 读取当前访问令牌可见的项目列表。",
 *   "inputs": [
 *     { "key": "baseUrl", "type": "string", "required": false, "description": "APIFox API 基础地址。" },
 *     { "key": "locale", "type": "string", "required": false, "description": "APIFox locale 参数。" },
 *     { "key": "includeRawResponse", "type": "boolean", "required": false, "defaultValue": false, "description": "是否在 raw 输出中保留原始响应。" }
 *   ],
 *   "outputs": [
 *     { "key": "projects", "type": "ApifoxProject[]", "description": "标准化后的项目列表。" },
 *     { "key": "count", "type": "number", "description": "项目数量。" },
 *     { "key": "raw", "type": "unknown|null", "description": "includeRawResponse=true 时返回原始响应，否则为 null。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_APIFOX_CONFIG_MISSING", "description": "APIFox access token 未配置。" },
 *     { "code": "BLOCK_APIFOX_INPUT_INVALID", "description": "baseUrl 或 locale 输入无效。" },
 *     { "code": "BLOCK_APIFOX_REQUEST_FAILED", "description": "APIFox 项目列表请求失败。" },
 *     { "code": "BLOCK_APIFOX_RESPONSE_INVALID", "description": "APIFox 返回内容不是预期 JSON 结构。" }
 *   ],
 *   "config": [
 *     { "key": "APIFOX_ACCESS_TOKEN", "type": "string", "required": true, "description": "APIFox 开放 API access token。" }
 *   ],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "network", "type": "string", "value": "APIFox Open API", "description": "会请求 APIFox 项目列表接口。" }
 *   ],
 *   "examples": [
 *     { "title": "列出项目", "block": { "uuid": "list_apifox_projects", "functionName": "listApifoxProjects", "inputs": { "includeRawResponse": false }, "outputs": ["projects", "count", "raw"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeListApifoxProjectsBlock: BlockExecutor = async ({ inputs }) => {
  const baseUrl = normalizeApifoxBaseUrl(inputs.baseUrl)
  const locale = normalizeApifoxLocale(inputs.locale)
  const accessToken = readApifoxAccessToken()
  const url = buildApifoxUrl(baseUrl, 'api/v1/user-projects', { locale })

  let response: Response

  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Apifox-Api-Version': apifoxApiVersion,
      },
    })
  } catch (error) {
    throw mokelayError('BLOCK_APIFOX_REQUEST_FAILED', '请求 APIFox 项目列表失败。', 502, error)
  }

  if (!response.ok) {
    const statusText = response.statusText ? ` ${response.statusText}` : ''

    throw mokelayError('BLOCK_APIFOX_REQUEST_FAILED', `APIFox 项目列表请求失败：${response.status}${statusText}。`, 502)
  }

  const raw = await parseProjectsResponse(response)
  const projects = projectListFromResponse(raw).map((project) => normalizeProject(project))

  return {
    projects,
    count: projects.length,
    raw: inputs.includeRawResponse === true ? raw : null,
  }
}
