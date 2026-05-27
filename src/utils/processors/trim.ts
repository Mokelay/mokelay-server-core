import { type ProcessorExecutor } from './shared.js'

/**
 * trim processor
 * 作用：清理字符串输入首尾空白，常用于 request 参数和模板结果的标准化。
 * 参数：无。
 * 返回：如果 value 是 string，返回 value.trim()；其它类型原样返回。
 */
export const trimProcessor: ProcessorExecutor = ({ value }) => {
  return typeof value === 'string' ? value.trim() : value
}
