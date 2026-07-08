import {
  getLength,
  getLengthLimit,
  processorValidationError,
  type ProcessorExecutor,
} from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version": 1,
 *   "functionName": "min",
 *   "displayName": "最小长度校验",
 *   "category": "validation",
 *   "description": "校验字符串或数组长度不能小于指定下限。",
 *   "inputs": [
 *     {
 *       "key": "value",
 *       "type": "string|unknown[]",
 *       "required": true,
 *       "description": "待校验字符串或数组。"
 *     },
 *     {
 *       "key": "label",
 *       "type": "string",
 *       "required": false,
 *       "description": "校验失败时拼接到错误信息中的字段标签。"
 *     }
 *   ],
 *   "params": [
 *     {
 *       "key": "limit",
 *       "type": "number",
 *       "required": true,
 *       "description": "唯一参数，非负安全整数，表示允许的最小长度。"
 *     }
 *   ],
 *   "outputs": [
 *     {
 *       "key": "value",
 *       "type": "string|unknown[]",
 *       "description": "校验通过时返回原值。"
 *     }
 *   ],
 *   "errors": [
 *     {
 *       "code": "PROCESSOR_INVALID_CONFIG",
 *       "description": "param 必须包含一个非负整数。"
 *     },
 *     {
 *       "code": "PROCESSOR_VALIDATION_FAILED",
 *       "description": "value 不是字符串/数组，或长度小于 limit 时抛出。"
 *     }
 *   ],
 *   "config": [
 *     {
 *       "key": "processor",
 *       "type": "string",
 *       "required": true,
 *       "value": "min",
 *       "description": "Processor 名称；可使用字符串简写或对象配置。"
 *     },
 *     {
 *       "key": "param",
 *       "type": "number",
 *       "required": true,
 *       "description": "最小长度。"
 *     }
 *   ],
 *   "runtime": [
 *     {
 *       "key": "async",
 *       "type": "boolean",
 *       "value": false,
 *       "description": "同步执行。"
 *     },
 *     {
 *       "key": "requiresDatasource",
 *       "type": "boolean",
 *       "value": false,
 *       "description": "不需要数据库连接。"
 *     },
 *     {
 *       "key": "sideEffect",
 *       "type": "string",
 *       "value": "none",
 *       "description": "不写入外部系统。"
 *     }
 *   ],
 *   "examples": [
 *     {
 *       "title": "校验最小长度",
 *       "input": "mokelay",
 *       "processor": {
 *         "processor": "min",
 *         "param": 3
 *       },
 *       "output": "mokelay"
 *     }
 *   ]
 * }
 */
export const minProcessor: ProcessorExecutor = ({ value, params, label }) => {
  const limit = getLengthLimit('min', params)

  if (getLength(value, 'min', label) < limit) {
    processorValidationError('min', label, `长度不能小于 ${limit}。`)
  }

  return value
}
