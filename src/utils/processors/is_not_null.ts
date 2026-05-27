import { isNullishProcessorValue, processorValidationError, type ProcessorExecutor } from './shared.js'

/**
 * is_not_null processor
 * 作用：校验值必须存在，适合声明必填 request 参数或必有 block 输出。
 * 参数：无。
 * 返回：校验通过时返回原值；undefined、null、空字符串会抛出 PROCESSOR_VALIDATION_FAILED。
 */
export const isNotNullProcessor: ProcessorExecutor = ({ value, label }) => {
  if (isNullishProcessorValue(value)) {
    processorValidationError('is_not_null', label, '不能为空。')
  }

  return value
}
