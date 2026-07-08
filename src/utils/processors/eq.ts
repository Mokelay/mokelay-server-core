import { isDeepStrictEqual } from 'node:util'
import {
  getSingleParam,
  processorValidationError,
  stringifyProcessorValue,
  type ProcessorExecutor,
} from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version": 1,
 *   "functionName": "eq",
 *   "displayName": "必须相等校验",
 *   "category": "validation",
 *   "description": "使用 Node 深度严格相等校验当前值必须等于期望值。",
 *   "inputs": [
 *     {
 *       "key": "value",
 *       "type": "unknown",
 *       "required": true,
 *       "description": "待校验值。"
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
 *       "type": "unknown",
 *       "description": "校验通过时返回原值。"
 *     }
 *   ],
 *   "errors": [
 *     {
 *       "code": "PROCESSOR_INVALID_CONFIG",
 *       "description": "param 必须包含一个参数。"
 *     },
 *     {
 *       "code": "PROCESSOR_VALIDATION_FAILED",
 *       "description": "value 和 expected 深度严格不相等时抛出。"
 *     }
 *   ],
 *   "config": [
 *     {
 *       "key": "processor",
 *       "type": "string",
 *       "required": true,
 *       "value": "eq",
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
 *       "title": "校验发布状态",
 *       "input": "published",
 *       "processor": {
 *         "processor": "eq",
 *         "param": "published"
 *       },
 *       "output": "published"
 *     }
 *   ]
 * }
 */
export const eqProcessor: ProcessorExecutor = ({ value, params, label }) => {
  const expected = getSingleParam('eq', params)

  if (!isDeepStrictEqual(value, expected)) {
    processorValidationError('eq', label, `必须等于 ${stringifyProcessorValue(expected)}。`)
  }

  return value
}
