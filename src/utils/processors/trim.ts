import { type ProcessorExecutor } from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version": 1,
 *   "functionName": "trim",
 *   "displayName": "去除首尾空白",
 *   "category": "transform",
 *   "description": "清理字符串输入首尾空白，常用于 request 参数和模板结果标准化；非字符串原样返回。",
 *   "inputs": [
 *     {
 *       "key": "value",
 *       "type": "unknown",
 *       "required": true,
 *       "description": "需要标准化的任意值；只有 string 会被 trim。"
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
 *       "description": "字符串返回 trim 后结果，其他类型原样返回。"
 *     }
 *   ],
 *   "errors": [],
 *   "config": [
 *     {
 *       "key": "processor",
 *       "type": "string",
 *       "required": true,
 *       "value": "trim",
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
 *       "input": "  Mokelay  ",
 *       "processor": {
 *         "processor": "trim"
 *       },
 *       "output": "Mokelay"
 *     }
 *   ]
 * }
 */
export const trimProcessor: ProcessorExecutor = ({ value }) => {
  return typeof value === 'string' ? value.trim() : value
}
