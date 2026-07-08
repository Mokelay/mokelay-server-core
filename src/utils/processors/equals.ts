import { isDeepStrictEqual } from 'node:util'
import { getSingleParam, type ProcessorExecutor } from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version": 1,
 *   "functionName": "equals",
 *   "displayName": "相等判断",
 *   "category": "predicate",
 *   "description": "比较当前值是否与期望值深度严格相等，适合把比较结果传给后续 inputs。",
 *   "inputs": [
 *     {
 *       "key": "value",
 *       "type": "unknown",
 *       "required": true,
 *       "description": "待比较值。"
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
 *       "key": "expected",
 *       "type": "unknown",
 *       "required": true,
 *       "description": "唯一参数，期望值；可来自静态配置或模板解析后的 param。"
 *     }
 *   ],
 *   "outputs": [
 *     {
 *       "key": "value",
 *       "type": "boolean",
 *       "description": "相等返回 true，不相等返回 false。"
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
 *       "value": "equals",
 *       "description": "Processor 名称；可使用字符串简写或对象配置。"
 *     },
 *     {
 *       "key": "param",
 *       "type": "unknown",
 *       "required": true,
 *       "description": "期望值。"
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
 *       "title": "判断发布状态",
 *       "input": "published",
 *       "processor": {
 *         "processor": "equals",
 *         "param": "published"
 *       },
 *       "output": true
 *     }
 *   ]
 * }
 */
export const equalsProcessor: ProcessorExecutor = ({ value, params }) => {
  return isDeepStrictEqual(value, getSingleParam('equals', params))
}
