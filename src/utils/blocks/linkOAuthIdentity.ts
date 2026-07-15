import { type BlockExecutor } from '../orchestration-schema.js'
import { mokelayError } from '../mokelay-error.js'
import {
  linkOAuthIdentity,
  normalizeOAuthProvider,
  type OAuthProfile,
} from './oauthShared.js'

function requiredString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError('BLOCK_OAUTH_INPUT_INVALID', `${name} 必须是非空字符串。`, 400)
  }

  return value.trim()
}

function profileInput(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw mokelayError('BLOCK_OAUTH_INPUT_INVALID', 'profile 必须是对象。', 400)
  }

  return value as Record<string, unknown>
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "linkOAuthIdentity",
 *   "displayName": "绑定 OAuth 身份",
 *   "category": "auth",
 *   "description": "把已验证的 OAuth 身份幂等绑定到 Fragment 创建的 employee，并返回可写入 Session 的用户。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "Mokelay 用户库数据源。" },
 *     { "key": "provider", "type": "google|github", "required": true, "description": "OAuth provider。" },
 *     { "key": "employeeId", "type": "string", "required": true, "description": "待绑定员工 ID。" },
 *     { "key": "providerUserId", "type": "string", "required": true, "description": "Provider 用户唯一标识。" },
 *     { "key": "providerEmail", "type": "string", "required": true, "description": "Provider 已验证邮箱。" },
 *     { "key": "emailVerified", "type": "boolean", "required": true, "description": "Provider 邮箱验证状态，必须为 true。" },
 *     { "key": "profile", "type": "Record<string, unknown>", "required": true, "description": "Provider 原始 profile。" }
 *   ],
 *   "outputs": [
 *     { "key": "user", "type": "EmployeeSession", "description": "身份所属用户。" },
 *     { "key": "linkedIdentity", "type": "boolean", "description": "本次是否新建了绑定；重复执行时为 false。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_OAUTH_INPUT_INVALID", "description": "输入字段无效。" },
 *     { "code": "BLOCK_OAUTH_EMAIL_UNVERIFIED", "description": "Provider 邮箱未验证。" },
 *     { "code": "BLOCK_OAUTH_ACCOUNT_CONFLICT", "description": "身份已属于其他账号，或 employee 与邮箱不匹配。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "读取 employee 并写入 employee_auth_identities。" }
 *   ],
 *   "examples": []
 * }
 */
export const executeLinkOAuthIdentityBlock: BlockExecutor = async ({ inputs, executeSql, databaseType }) => {
  const provider = normalizeOAuthProvider(inputs.provider)
  const employeeId = requiredString(inputs.employeeId, 'employeeId')
  const providerUserId = requiredString(inputs.providerUserId, 'providerUserId')
  const providerEmail = requiredString(inputs.providerEmail, 'providerEmail').toLowerCase()
  const emailVerified = inputs.emailVerified

  if (emailVerified !== true) {
    throw mokelayError('BLOCK_OAUTH_EMAIL_UNVERIFIED', 'OAuth 邮箱未验证。', 400)
  }

  const rawProfile = profileInput(inputs.profile)
  const profile: OAuthProfile = {
    provider,
    providerUserId,
    email: providerEmail,
    emailVerified,
    name: typeof rawProfile.name === 'string' && rawProfile.name.trim()
      ? rawProfile.name.trim()
      : providerEmail.split('@')[0] || 'OAuth User',
    raw: rawProfile,
  }

  return await linkOAuthIdentity(executeSql, employeeId, profile, databaseType)
}
