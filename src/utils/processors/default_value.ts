import { getSingleParam, isNullishProcessorValue, type ProcessorExecutor } from './shared.js'

/**
 * default_value processor
 * 作用：当当前值为空时返回配置的默认值，适合兼容新增的可选请求字段。
 * 参数：一个 fallback 值，可来自静态配置或模板解析后的 param。
 * 返回：当前值为 undefined、null、空字符串时返回 fallback；否则返回原值。
 */
export const defaultValueProcessor: ProcessorExecutor = ({ value, params }) => {
  return isNullishProcessorValue(value) ? getSingleParam('default_value', params) : value
}
