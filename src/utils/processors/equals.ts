import { isDeepStrictEqual } from 'node:util'
import { getSingleParam, type ProcessorExecutor } from './shared.js'

/**
 * equals processor
 * 作用：比较当前值是否与期望值深度严格相等，适合把比较结果传给后续 inputs。
 * 参数：一个 expected 参数，可来自静态配置或模板解析后的 param。
 * 返回：相等返回 true，不相等返回 false。
 */
export const equalsProcessor: ProcessorExecutor = ({ value, params }) => {
  return isDeepStrictEqual(value, getSingleParam('equals', params))
}
