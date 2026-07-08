import { z } from 'zod'
import { processorValidationError, type ProcessorExecutor } from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version": 1,
 *   "functionName": "email_check",
 *   "displayName": "Email 校验",
 *   "category": "validation",
 *   "description": "校验字符串是否为合法 email。",
 *   "inputs": [
 *     {
 *       "key": "value",
 *       "type": "string",
 *       "required": true,
 *       "description": "待校验 email 字符串。"
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
 *       "type": "string",
 *       "description": "校验通过时返回原 email 字符串。"
 *     }
 *   ],
 *   "errors": [
 *     {
 *       "code": "PROCESSOR_VALIDATION_FAILED",
 *       "description": "value 不是字符串或不是合法 email 时抛出。"
 *     }
 *   ],
 *   "config": [
 *     {
 *       "key": "processor",
 *       "type": "string",
 *       "required": true,
 *       "value": "email_check",
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
 *       "input": "user@example.com",
 *       "processor": {
 *         "processor": "email_check"
 *       },
 *       "output": "user@example.com"
 *     }
 *   ]
 * }
 */
export const emailCheckProcessor: ProcessorExecutor = ({ value, label }) => {
  if (typeof value !== 'string' || !z.string().email().safeParse(value).success) {
    processorValidationError('email_check', label, '不是合法 email。')
  }

  return value
}
