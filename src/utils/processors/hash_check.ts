import { verifyPassword } from '../password.js'
import { getSingleParam, processorValidationError, type ProcessorExecutor } from './shared.js'

/**
 * hash_check processor
 * 作用：验证当前值代表的密码 hash 是否匹配明文密码参数。
 * 参数：一个 plainPassword 字符串。
 * 返回：验证通过时返回原 hash；hash 或明文密码类型错误、验证失败都会抛出 PROCESSOR_VALIDATION_FAILED。
 */
export const hashCheckProcessor: ProcessorExecutor = async ({ value, params, label }) => {
  const plainPassword = getSingleParam('hash_check', params)

  if (typeof value !== 'string' || typeof plainPassword !== 'string') {
    processorValidationError('hash_check', label, '必须使用字符串 hash 和明文密码。')
  }

  if (!(await verifyPassword(value, plainPassword))) {
    processorValidationError('hash_check', label, 'hash 校验不通过。')
  }

  return value
}
