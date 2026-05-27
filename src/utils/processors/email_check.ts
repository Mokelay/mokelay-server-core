import { z } from 'zod'
import { processorValidationError, type ProcessorExecutor } from './shared.js'

/**
 * email_check processor
 * 作用：校验字符串是否为合法 email。
 * 参数：无。
 * 返回：校验通过时返回原值；非字符串或非法 email 会抛出 PROCESSOR_VALIDATION_FAILED。
 */
export const emailCheckProcessor: ProcessorExecutor = ({ value, label }) => {
  if (typeof value !== 'string' || !z.string().email().safeParse(value).success) {
    processorValidationError('email_check', label, '不是合法 email。')
  }

  return value
}
