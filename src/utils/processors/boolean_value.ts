import { isNullishProcessorValue, processorValidationError, type ProcessorExecutor } from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version": 1,
 *   "functionName": "boolean_value",
 *   "displayName": "布尔值标准化",
 *   "category": "transform",
 *   "description": "把查询参数中的 true、false、1、0 转为 boolean，并保留可选空值。",
 *   "inputs": [
 *     { "key": "value", "type": "boolean|number|string|null", "required": true, "description": "待标准化的值。" },
 *     { "key": "label", "type": "string", "required": false, "description": "错误消息中的字段标签。" }
 *   ],
 *   "params": [
 *     { "key": "param", "type": "never", "required": false, "defaultValue": [], "description": "不使用参数。" }
 *   ],
 *   "outputs": [
 *     { "key": "value", "type": "boolean|null|undefined", "description": "规范 boolean 或原可选空值。" }
 *   ],
 *   "errors": [
 *     { "code": "PROCESSOR_VALIDATION_FAILED", "description": "输入不是支持的布尔编码。" }
 *   ],
 *   "config": [
 *     { "key": "processor", "type": "string", "required": true, "value": "boolean_value", "description": "Processor 名称。" }
 *   ],
 *   "runtime": [
 *     { "key": "async", "type": "boolean", "value": false, "description": "同步执行。" },
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库。" },
 *     { "key": "sideEffect", "type": "string", "value": "none", "description": "无副作用。" }
 *   ],
 *   "examples": [
 *     { "title": "查询参数 1", "input": "1", "processor": { "processor": "boolean_value" }, "output": true }
 *   ]
 * }
 */
/** Converts common query-string boolean encodings while preserving optional empties. */
export const booleanValueProcessor: ProcessorExecutor = ({ value, label }) => {
  if (isNullishProcessorValue(value)) return value
  if (value === true || value === 1) return true
  if (value === false || value === 0) return false
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }
  processorValidationError('boolean_value', label, '必须是 true、false、1 或 0。')
}
