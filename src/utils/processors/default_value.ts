import { getSingleParam, isNullishProcessorValue, type ProcessorExecutor } from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version": 1,
 *   "functionName": "default_value",
 *   "displayName": "默认值",
 *   "category": "transform",
 *   "description": "当当前值为空时返回配置的默认值，适合兼容新增的可选请求字段。",
 *   "inputs": [
 *     {
 *       "key": "value",
 *       "type": "unknown",
 *       "required": true,
 *       "description": "当前值；undefined、null、空字符串会触发 fallback。"
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
 *       "key": "fallback",
 *       "type": "unknown",
 *       "required": true,
 *       "description": "唯一参数，当前值为空时返回的默认值。"
 *     }
 *   ],
 *   "outputs": [
 *     {
 *       "key": "value",
 *       "type": "unknown",
 *       "description": "当前值为空时返回 fallback，否则返回原值。"
 *     }
 *   ],
 *   "errors": [
 *     {
 *       "code": "PROCESSOR_INVALID_CONFIG",
 *       "description": "param 必须包含一个参数。"
 *     }
 *   ],
 *   "config": [
 *     {
 *       "key": "processor",
 *       "type": "string",
 *       "required": true,
 *       "value": "default_value",
 *       "description": "Processor 名称；可使用字符串简写或对象配置。"
 *     },
 *     {
 *       "key": "param",
 *       "type": "unknown",
 *       "required": true,
 *       "description": "默认值。"
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
 *       "title": "补默认状态",
 *       "input": "",
 *       "processor": {
 *         "processor": "default_value",
 *         "param": "draft"
 *       },
 *       "output": "draft"
 *     }
 *   ]
 * }
 */
export const defaultValueProcessor: ProcessorExecutor = ({ value, params }) => {
  return isNullishProcessorValue(value) ? getSingleParam('default_value', params) : value
}
