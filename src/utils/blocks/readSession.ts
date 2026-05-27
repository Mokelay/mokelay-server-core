import { type BlockExecutor } from '../orchestration-schema.js'
import { readSessionValue } from '../session.js'
import { getSessionKey, isRecord } from './shared.js'

/**
 * readSession block
 * 作用：读取编排 session cookie 中指定 key 的值，未找到时返回 null。
 * inputs：key 非空字符串。
 * outputs：value，值为 session 中保存的数据；key 不存在时为 null。
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
