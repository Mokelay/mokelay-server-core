import { type BlockExecutor } from '../orchestration-schema.js'
import { removeSessionValue } from '../session.js'
import { getSessionKey } from './shared.js'

/**
 * removeSession block
 * 作用：从编排 session cookie 中删除指定 key。
 * inputs：key 非空字符串。
 * outputs：无业务输出。
 */
export const executeRemoveSessionBlock: BlockExecutor = async ({ event, inputs }) => {
  const key = getSessionKey(inputs.key)

  removeSessionValue(event, key)

  return {}
}
