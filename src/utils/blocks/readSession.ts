import { type BlockExecutor } from '../orchestration-schema.js'
import { readSessionValue } from '../session.js'
import { getSessionKey, isRecord } from './shared.js'

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "readSession",
 *   "displayName": "读取 Session",
 *   "category": "session",
 *   "description": "读取编排 session cookie 中指定 key 的值，未找到时返回 null。",
 *   "inputs": [
 *     { "key": "key", "type": "string", "required": true, "description": "session 字段名。" }
 *   ],
 *   "outputs": [
 *     { "key": "value", "type": "unknown|null", "description": "session 中保存的数据；key 不存在时为 null。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_SESSION_KEY_INVALID", "description": "key 不是非空字符串。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "cookie", "type": "string", "value": "mokelay_orchestration_session", "description": "从编排 session cookie 读取数据。" }
 *   ],
 *   "examples": [
 *     { "title": "读取用户 session", "block": { "uuid": "read_user_session", "functionName": "readSession", "inputs": { "key": "user" }, "outputs": ["value"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeReadSessionBlock: BlockExecutor = async ({ event, inputs }) => {
  const key = getSessionKey(inputs.key)

  try {
    return {
      value: readSessionValue(event, key),
    }
  } catch (error) {
    const data = typeof error === 'object' && error && 'data' in error ? error.data : undefined
    const code = isRecord(data) ? data.code : undefined

    if (code !== 'BLOCK_SESSION_KEY_NOT_FOUND') {
      throw error
    }

    return {
      value: null,
    }
  }
}
