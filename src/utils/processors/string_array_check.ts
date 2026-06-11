import { processorValidationError, type ProcessorExecutor } from './shared.js'

/**
 * string_array_check processor
 * 作用：校验值是只包含字符串的数组。
 * 参数：无。
 * 返回：校验通过时返回原数组。
 */
export const stringArrayCheckProcessor: ProcessorExecutor = ({ value, label }) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    processorValidationError('string_array_check', label, '必须是字符串数组。')
  }

  return value
}
