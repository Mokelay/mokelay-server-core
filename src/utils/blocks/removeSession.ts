import { type BlockExecutor } from '../orchestration-schema.js'
import { removeSessionValue } from '../session.js'
import { getSessionKey } from './shared.js'

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "removeSession",
 *   "displayName": "删除 Session",
 *   "category": "session",
 *   "description": "从编排 session cookie 中删除指定 key。",
 *   "inputs": [
 *     { "key": "key", "type": "string", "required": true, "description": "session 字段名。" }
 *   ],
 *   "outputs": [],
 *   "errors": [
 *     { "code": "BLOCK_SESSION_KEY_INVALID", "description": "key 不是非空字符串。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "sideEffect", "type": "string", "value": "set-cookie", "description": "会更新 mokelay_orchestration_session cookie。" }
 *   ],
 *   "examples": [
 *     { "title": "清除用户 session", "block": { "uuid": "clear_user_session", "functionName": "removeSession", "inputs": { "key": "user" }, "outputs": [], "nextBlock": null } }
 *   ]
 * }
 */
export const executeRemoveSessionBlock: BlockExecutor = async ({ event, inputs }) => {
  const key = getSessionKey(inputs.key)

  removeSessionValue(event, key)

  return {}
}
