import { type BlockExecutor } from '../orchestration-schema.js'
import { mokelayError } from '../mokelay-error.js'
import { setSessionValue } from '../session.js'
import { getSessionKey } from './shared.js'

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "addSession",
 *   "displayName": "写入 Session",
 *   "category": "session",
 *   "description": "把指定 key/value 写入编排 session cookie。",
 *   "inputs": [
 *     { "key": "key", "type": "string", "required": true, "description": "session 字段名。" },
 *     { "key": "value", "type": "unknown", "required": true, "description": "要保存的 JSON 可序列化值，必须显式提供。" }
 *   ],
 *   "outputs": [],
 *   "errors": [
 *     { "code": "BLOCK_SESSION_KEY_INVALID", "description": "key 不是非空字符串。" },
 *     { "code": "BLOCK_SESSION_VALUE_MISSING", "description": "value 未显式提供。" }
 *   ],
 *   "config": [
 *     { "key": "COOKIE_DOMAIN", "type": "string", "required": false, "description": "生产环境可配置跨子域 cookie domain。" }
 *   ],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "sideEffect", "type": "string", "value": "set-cookie", "description": "会写入 mokelay_orchestration_session HTTP-only cookie。" }
 *   ],
 *   "examples": [
 *     { "title": "写入用户 session", "block": { "uuid": "set_user_session", "functionName": "addSession", "inputs": { "key": "user", "value": { "template": "{{blocks['read_user'].outputs.data}}" } }, "outputs": [], "nextBlock": null } }
 *   ]
 * }
 */
export const executeAddSessionBlock: BlockExecutor = async ({ event, inputs }) => {
  const key = getSessionKey(inputs.key)

  if (!Object.prototype.hasOwnProperty.call(inputs, 'value')) {
    throw mokelayError('BLOCK_SESSION_VALUE_MISSING', 'value 不能为空。', 400)
  }

  setSessionValue(event, key, inputs.value)

  return {}
}
