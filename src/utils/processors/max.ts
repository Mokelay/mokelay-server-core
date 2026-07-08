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
 *   "functionName": "max",
 *   "displayName": "最大长度校验",
 *   "category": "validation",
 *   "description": "校验字符串或数组长度不能大于指定上限。",
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
 *       "description": "唯一参数，非负安全整数，表示允许的最大长度。"
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
 *       "description": "value 不是字符串/数组，或长度大于 limit 时抛出。"
 *     }
 *   ],
 *   "config": [
 *     {
 *       "key": "processor",
 *       "type": "string",
 *       "required": true,
 *       "value": "max",
 *       "description": "Processor 名称；可使用字符串简写或对象配置。"
 *     },
 *     {
 *       "key": "param",
 *       "type": "number",
 *       "required": true,
 *       "description": "最大长度。"
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
 *       "title": "校验最大长度",
 *       "input": "mokelay",
 *       "processor": {
 *         "processor": "max",
 *         "param": 20
 *       },
 *       "output": "mokelay"
 *     }
 *   ]
 * }
 */
export const maxProcessor: ProcessorExecutor = ({ value, params, label }) => {
  const limit = getLengthLimit('max', params)

  if (getLength(value, 'max', label) > limit) {
    processorValidationError('max', label, `长度不能大于 ${limit}。`)
  }

  return value
}
