import { verifyPassword } from '../password.js'
import { getSingleParam, processorValidationError, type ProcessorExecutor } from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version": 1,
 *   "functionName": "hash_check",
 *   "displayName": "校验密码 Hash",
 *   "category": "security",
 *   "description": "验证当前值代表的密码 hash 是否匹配明文密码参数。",
 *   "inputs": [
 *     {
 *       "key": "value",
 *       "type": "string",
 *       "required": true,
 *       "description": "已存储的密码 hash 字符串。"
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
 *       "key": "plainPassword",
 *       "type": "string",
 *       "required": true,
 *       "description": "唯一参数，用户提交的明文密码。"
 *     }
 *   ],
 *   "outputs": [
 *     {
 *       "key": "value",
 *       "type": "string",
 *       "description": "验证通过时返回原 hash。"
 *     }
 *   ],
 *   "errors": [
 *     {
 *       "code": "PROCESSOR_VALIDATION_FAILED",
 *       "description": "hash 或明文密码不是字符串，或 hash 校验不通过时抛出。"
 *     }
 *   ],
 *   "config": [
 *     {
 *       "key": "processor",
 *       "type": "string",
 *       "required": true,
 *       "value": "hash_check",
 *       "description": "Processor 名称；可使用字符串简写或对象配置。"
 *     },
 *     {
 *       "key": "param",
 *       "type": "string",
 *       "required": true,
 *       "description": "明文密码。"
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
 *       "title": "登录时校验密码",
 *       "input": "<password-hash>",
 *       "processor": {
 *         "processor": "hash_check",
 *         "param": "plain-password"
 *       },
 *       "output": "<password-hash>"
 *     }
 *   ]
 * }
 */
export const hashCheckProcessor: ProcessorExecutor = async ({ value, params, label }) => {
  const plainPassword = getSingleParam('hash_check', params)

  if (typeof value !== 'string' || typeof plainPassword !== 'string') {
    processorValidationError('hash_check', label, '必须使用字符串 hash 和明文密码。')
  }

  if (!(await verifyPassword(value, plainPassword))) {
    processorValidationError('hash_check', label, 'hash 校验不通过。')
  }

  return value
}
