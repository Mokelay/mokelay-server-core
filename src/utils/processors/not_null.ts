import { type ProcessorExecutor } from './shared.js'

/**
 * not_null processor
 * 作用：把值转换成是否存在的布尔结果，常用于响应模板里输出登录态等状态。
 * 参数：无。
 * 返回：value 不是 undefined 且不是 null 时返回 true，否则返回 false；保持原有行为，空字符串会返回 true。
 */
export const notNullProcessor: ProcessorExecutor = ({ value }) => {
  return value !== undefined && value !== null
}
