import { processorValidationError, type ProcessorExecutor } from './shared.js'

/**
 * number_check processor
 * 作用：校验值是有限数字，或可以转换成有限数字的非空字符串。
 * 参数：无。
 * 返回：校验通过时返回原值；非法数字会抛出 PROCESSOR_VALIDATION_FAILED。
 */
export const numberCheckProcessor: ProcessorExecutor = ({ value, label }) => {
  if (
    typeof value !== 'number' && typeof value !== 'string'
    || typeof value === 'number' && !Number.isFinite(value)
    || typeof value === 'string' && (!value.trim() || !Number.isFinite(Number(value)))
  ) {
    processorValidationError('number_check', label, '不是合法数字。')
  }

  return value
}
