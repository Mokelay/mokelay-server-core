import { type ProcessorExecutor } from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version": 1,
 *   "functionName": "not_null",
 *   "displayName": "存在性布尔值",
 *   "category": "predicate",
 *   "description": "把值转换成是否存在的布尔结果，常用于响应模板里输出登录态等状态。",
 *   "inputs": [
 *     {
 *       "key": "value",
 *       "type": "unknown",
 *       "required": true,
 *       "description": "待判断值；undefined 和 null 为 false，空字符串按当前实现返回 true。"
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
 *       "type": "boolean",
 *       "description": "value 不是 undefined 且不是 null 时返回 true，否则返回 false。"
 *     }
 *   ],
 *   "errors": [],
 *   "config": [
 *     {
 *       "key": "processor",
 *       "type": "string",
 *       "required": true,
 *       "value": "not_null",
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
 *       "input": "user-id",
 *       "processor": {
 *         "processor": "not_null"
 *       },
 *       "output": true
 *     }
 *   ]
 * }
 */
export const notNullProcessor: ProcessorExecutor = ({ value }) => {
  return value !== undefined && value !== null
}
