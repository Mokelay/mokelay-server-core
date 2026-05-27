import { isDeepStrictEqual } from 'node:util'
import {
  getSingleParam,
  processorValidationError,
  stringifyProcessorValue,
  type ProcessorExecutor,
} from './shared.js'

/**
 * eq processor
 * 作用：使用 Node 深度严格相等校验当前值必须等于期望值。
 * 参数：一个 expected 参数，可来自静态配置或模板解析后的 param。
 * 返回：校验通过时返回原值；不相等会抛出 PROCESSOR_VALIDATION_FAILED。
 */
export const eqProcessor: ProcessorExecutor = ({ value, params, label }) => {
  const expected = getSingleParam('eq', params)

  if (!isDeepStrictEqual(value, expected)) {
    processorValidationError('eq', label, `必须等于 ${stringifyProcessorValue(expected)}。`)
  }

  return value
}
