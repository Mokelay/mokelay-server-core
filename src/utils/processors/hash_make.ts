import { hashPassword } from '../password.js'
import { processorValidationError, type ProcessorExecutor } from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version": 1,
 *   "functionName": "hash_make",
 *   "displayName": "生成密码 Hash",
 *   "category": "security",
 *   "description": "把明文密码字符串转换为服务端密码 hash。",
 *   "inputs": [
 *     {
 *       "key": "value",
 *       "type": "string",
 *       "required": true,
 *       "description": "明文密码字符串。"
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
 *       "description": "返回密码 hash 字符串。"
 *     }
 *   ],
 *   "errors": [
 *     {
 *       "code": "PROCESSOR_VALIDATION_FAILED",
 *       "description": "value 不是字符串时抛出。"
 *     }
 *   ],
 *   "config": [
 *     {
 *       "key": "processor",
 *       "type": "string",
 *       "required": true,
 *       "value": "hash_make",
 *       "description": "Processor 名称；可使用字符串简写或对象配置。"
 *     }
 *   ],
 *   "runtime": [
 *     {
 *       "key": "async",
 *       "type": "boolean",
 *       "value": true,
 *       "description": "异步执行。"
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
 *       "title": "注册时生成密码 hash",
 *       "input": "plain-password",
 *       "processor": {
 *         "processor": "hash_make"
 *       },
 *       "output": "<password-hash>"
 *     }
 *   ]
 * }
 */
export const hashMakeProcessor: ProcessorExecutor = async ({ value, label }) => {
  if (typeof value !== 'string') {
    processorValidationError('hash_make', label, '必须是字符串。')
  }

  return await hashPassword(value)
}
