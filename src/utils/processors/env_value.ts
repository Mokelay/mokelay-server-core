import { getSingleParam, processorConfigError, type ProcessorExecutor } from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version": 1,
 *   "functionName": "env_value",
 *   "displayName": "环境变量值",
 *   "category": "runtime",
 *   "description": "读取指定环境变量，常用于把发布目录、开关等运行时配置注入模板。",
 *   "inputs": [
 *     {
 *       "key": "value",
 *       "type": "unknown",
 *       "required": false,
 *       "description": "当前值会被忽略。"
 *     }
 *   ],
 *   "params": [
 *     {
 *       "key": "envKey",
 *       "type": "string",
 *       "required": true,
 *       "description": "唯一参数，非空环境变量 key；执行时会 trim 后读取 process.env。"
 *     }
 *   ],
 *   "outputs": [
 *     {
 *       "key": "value",
 *       "type": "string|undefined",
 *       "description": "返回 process.env[envKey.trim()]。"
 *     }
 *   ],
 *   "errors": [
 *     {
 *       "code": "PROCESSOR_INVALID_CONFIG",
 *       "description": "param 必须是非空环境变量 key。"
 *     }
 *   ],
 *   "config": [
 *     {
 *       "key": "processor",
 *       "type": "string",
 *       "required": true,
 *       "value": "env_value",
 *       "description": "Processor 名称；可使用字符串简写或对象配置。"
 *     },
 *     {
 *       "key": "param",
 *       "type": "string",
 *       "required": true,
 *       "description": "环境变量 key。"
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
 *       "key": "usesEnvironment",
 *       "type": "boolean",
 *       "value": true,
 *       "description": "读取 process.env。"
 *     },
 *     {
 *       "key": "sideEffect",
 *       "type": "string",
 *       "value": "read-env",
 *       "description": "只读取环境变量，不写入外部系统。"
 *     }
 *   ],
 *   "examples": [
 *     {
 *       "title": "读取 R2 前缀",
 *       "input": null,
 *       "processor": {
 *         "processor": "env_value",
 *         "param": "MOKELAY_APIS_R2_PREFIX"
 *       },
 *       "output": "mokelay/apis"
 *     }
 *   ]
 * }
 */
export const envValueProcessor: ProcessorExecutor = ({ params }) => {
  const envKey = getSingleParam('env_value', params)

  if (typeof envKey !== 'string' || !envKey.trim()) {
    processorConfigError('env_value', 'param 必须是非空环境变量 key。')
  }

  return process.env[envKey.trim()]
}
