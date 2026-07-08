import { isNullishProcessorValue, processorValidationError, type ProcessorExecutor } from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version": 1,
 *   "functionName": "is_null",
 *   "displayName": "必须为空校验",
 *   "category": "validation",
 *   "description": "校验值必须为空，用于确保某个输入或输出没有被赋值。",
 *   "inputs": [
 *     {
 *       "key": "value",
 *       "type": "unknown",
 *       "required": true,
 *       "description": "待校验值；只有 undefined、null、空字符串会被视为空。"
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
 *       "type": "unknown",
 *       "description": "校验通过时返回原值。"
 *     }
 *   ],
 *   "errors": [
 *     {
 *       "code": "PROCESSOR_VALIDATION_FAILED",
 *       "description": "value 非 undefined、null、空字符串时抛出。"
 *     }
 *   ],
 *   "config": [
 *     {
 *       "key": "processor",
 *       "type": "string",
 *       "required": true,
 *       "value": "is_null",
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
 *       "input": "",
 *       "processor": {
 *         "processor": "is_null"
 *       },
 *       "output": ""
 *     }
 *   ]
 * }
 */
export const isNullProcessor: ProcessorExecutor = ({ value, label }) => {
  if (!isNullishProcessorValue(value)) {
    processorValidationError('is_null', label, '必须为空。')
  }

  return value
}
