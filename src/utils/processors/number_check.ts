import { processorValidationError, type ProcessorExecutor } from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version": 1,
 *   "functionName": "number_check",
 *   "displayName": "数字校验",
 *   "category": "validation",
 *   "description": "校验值是有限数字，或可以转换成有限数字的非空字符串。",
 *   "inputs": [
 *     {
 *       "key": "value",
 *       "type": "number|string",
 *       "required": true,
 *       "description": "待校验数字或数字字符串。"
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
 *       "key": "param",
 *       "type": "never",
 *       "required": false,
 *       "defaultValue": [],
 *       "description": "不读取 param；应省略 param，或配置后也不会被执行器使用。"
 *     }
 *   ],
 *   "outputs": [
 *     {
 *       "key": "value",
 *       "type": "number|string",
 *       "description": "校验通过时返回原值，不做类型转换。"
 *     }
 *   ],
 *   "errors": [
 *     {
 *       "code": "PROCESSOR_VALIDATION_FAILED",
 *       "description": "value 不是有限数字，也不是可转换为有限数字的非空字符串时抛出。"
 *     }
 *   ],
 *   "config": [
 *     {
 *       "key": "processor",
 *       "type": "string",
 *       "required": true,
 *       "value": "number_check",
 *       "description": "Processor 名称；可使用字符串简写或对象配置。"
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
 *       "title": "基础用法",
 *       "input": "42",
 *       "processor": {
 *         "processor": "number_check"
 *       },
 *       "output": "42"
 *     }
 *   ]
 * }
 */
export const numberCheckProcessor: ProcessorExecutor = ({ value, label }) => {
  if (
    typeof value !== 'number' && typeof value !== 'string'
    || typeof value === 'number' && !Number.isFinite(value)
    || typeof value === 'string' && (!value.trim() || !Number.isFinite(Number(value)))
  ) {
    processorValidationError('number_check', label, '不是合法数字。')
  }

  return value
}
