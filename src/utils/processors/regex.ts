import {
  compileRegex,
  getSingleParam,
  processorValidationError,
  type ProcessorExecutor,
} from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version": 1,
 *   "functionName": "regex",
 *   "displayName": "正则校验",
 *   "category": "validation",
 *   "description": "校验字符串必须匹配指定正则。",
 *   "inputs": [
 *     {
 *       "key": "value",
 *       "type": "string",
 *       "required": true,
 *       "description": "待校验字符串。"
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
 *       "key": "pattern",
 *       "type": "string",
 *       "required": true,
 *       "description": "唯一参数，非空正则字符串，可写为 \"^[a-z]+$\" 或 \"/^[a-z]+$/i\"。"
 *     }
 *   ],
 *   "outputs": [
 *     {
 *       "key": "value",
 *       "type": "string",
 *       "description": "校验通过时返回原值。"
 *     }
 *   ],
 *   "errors": [
 *     {
 *       "code": "PROCESSOR_INVALID_CONFIG",
 *       "description": "param 不是非空正则字符串，或正则表达式无法编译时抛出。"
 *     },
 *     {
 *       "code": "PROCESSOR_VALIDATION_FAILED",
 *       "description": "value 不是字符串或不匹配正则时抛出。"
 *     }
 *   ],
 *   "config": [
 *     {
 *       "key": "processor",
 *       "type": "string",
 *       "required": true,
 *       "value": "regex",
 *       "description": "Processor 名称；可使用字符串简写或对象配置。"
 *     },
 *     {
 *       "key": "param",
 *       "type": "string",
 *       "required": true,
 *       "description": "正则字符串。"
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
 *       "title": "校验标识符",
 *       "input": "app_123",
 *       "processor": {
 *         "processor": "regex",
 *         "param": "^[A-Za-z0-9_]+$"
 *       },
 *       "output": "app_123"
 *     }
 *   ]
 * }
 */
export const regexProcessor: ProcessorExecutor = ({ value, params, label }) => {
  const regex = compileRegex('regex', getSingleParam('regex', params))

  if (typeof value !== 'string' || !regex.test(value)) {
    processorValidationError('regex', label, `不符合正则 ${regex.toString()}。`)
  }

  return value
}
