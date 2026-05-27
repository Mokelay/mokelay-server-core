import { hashPassword } from '../password.js'
import { processorValidationError, type ProcessorExecutor } from './shared.js'

/**
 * hash_make processor
 * 作用：把明文密码字符串转换为服务端密码 hash。
 * 参数：无。
 * 返回：密码 hash 字符串；当前值不是字符串会抛出 PROCESSOR_VALIDATION_FAILED。
 */
export const hashMakeProcessor: ProcessorExecutor = async ({ value, label }) => {
  if (typeof value !== 'string') {
    processorValidationError('hash_make', label, '必须是字符串。')
  }

  return await hashPassword(value)
}
