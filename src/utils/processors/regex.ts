import {
  compileRegex,
  getSingleParam,
  processorValidationError,
  type ProcessorExecutor,
} from './shared.js'

/**
 * regex processor
 * 作用：校验字符串必须匹配指定正则。
 * 参数：一个正则字符串，可写为 "^[a-z]+$" 或 "/^[a-z]+$/i"。
 * 返回：校验通过时返回原值；不匹配抛出 PROCESSOR_VALIDATION_FAILED，正则配置非法抛出 PROCESSOR_INVALID_CONFIG。
 */
export const regexProcessor: ProcessorExecutor = ({ value, params, label }) => {
  const regex = compileRegex('regex', getSingleParam('regex', params))

  if (typeof value !== 'string' || !regex.test(value)) {
    processorValidationError('regex', label, `不符合正则 ${regex.toString()}。`)
  }

  return value
}
