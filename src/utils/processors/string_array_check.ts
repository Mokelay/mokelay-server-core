import { processorValidationError, type ProcessorExecutor } from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version": 1,
 *   "functionName": "string_array_check",
 *   "displayName": "字符串数组校验",
 *   "category": "validation",
 *   "description": "校验值是只包含字符串的数组。",
 *   "inputs": [
 *     {
 *       "key": "value",
 *       "type": "string[]",
 *       "required": true,
 *       "description": "待校验字符串数组。"
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
 *       "type": "string[]",
 *       "description": "校验通过时返回原数组。"
 *     }
 *   ],
 *   "errors": [
 *     {
 *       "code": "PROCESSOR_VALIDATION_FAILED",
 *       "description": "value 不是数组，或数组中存在非字符串元素时抛出。"
 *     }
 *   ],
 *   "config": [
 *     {
 *       "key": "processor",
 *       "type": "string",
 *       "required": true,
 *       "value": "string_array_check",
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
 *       "input": [
 *         "a",
 *         "b"
 *       ],
 *       "processor": {
 *         "processor": "string_array_check"
 *       },
 *       "output": [
 *         "a",
 *         "b"
 *       ]
 *     }
 *   ]
 * }
 */
export const stringArrayCheckProcessor: ProcessorExecutor = ({ value, label }) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    processorValidationError('string_array_check', label, '必须是字符串数组。')
  }

  return value
}
