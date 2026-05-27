import { isNullishProcessorValue, processorValidationError, type ProcessorExecutor } from './shared.js'

/**
 * is_null processor
 * 作用：校验值必须为空，用于确保某个输入或输出没有被赋值。
 * 参数：无。
 * 返回：校验通过时返回原值；非 undefined、null、空字符串会抛出 PROCESSOR_VALIDATION_FAILED。
 */
export const isNullProcessor: ProcessorExecutor = ({ value, label }) => {
  if (!isNullishProcessorValue(value)) {
    processorValidationError('is_null', label, '必须为空。')
  }

  return value
}
