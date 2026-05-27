import {
  getLength,
  getLengthLimit,
  processorValidationError,
  type ProcessorExecutor,
} from './shared.js'

/**
 * max processor
 * 作用：校验字符串或数组长度不能大于指定上限。
 * 参数：一个非负整数 limit。
 * 返回：校验通过时返回原值；长度超限抛出 PROCESSOR_VALIDATION_FAILED，参数非法抛出 PROCESSOR_INVALID_CONFIG。
 */
export const maxProcessor: ProcessorExecutor = ({ value, params, label }) => {
  const limit = getLengthLimit('max', params)

  if (getLength(value, 'max', label) > limit) {
    processorValidationError('max', label, `长度不能大于 ${limit}。`)
  }

  return value
}
