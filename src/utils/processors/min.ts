import {
  getLength,
  getLengthLimit,
  processorValidationError,
  type ProcessorExecutor,
} from './shared.js'

/**
 * min processor
 * 作用：校验字符串或数组长度不能小于指定下限。
 * 参数：一个非负整数 limit。
 * 返回：校验通过时返回原值；长度不足抛出 PROCESSOR_VALIDATION_FAILED，参数非法抛出 PROCESSOR_INVALID_CONFIG。
 */
export const minProcessor: ProcessorExecutor = ({ value, params, label }) => {
  const limit = getLengthLimit('min', params)

  if (getLength(value, 'min', label) < limit) {
    processorValidationError('min', label, `长度不能小于 ${limit}。`)
  }

  return value
}
