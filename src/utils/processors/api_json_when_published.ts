import { assertApiJsonUuid, parseApiJson } from '../orchestration-schema.js'
import { getSingleParam, processorConfigError, type ProcessorExecutor } from './shared.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @serverProcessorDoc
 * {
 *   "version": 1,
 *   "functionName": "api_json_when_published",
 *   "displayName": "发布时校验 API JSON",
 *   "category": "validation",
 *   "description": "API Builder 发布时，当 status 为 published 才校验当前值是合法 API JSON；非 published 原样通过。",
 *   "inputs": [
 *     {
 *       "key": "value",
 *       "type": "unknown",
 *       "required": true,
 *       "description": "待校验的 API JSON；只有 param.status 为 published 时才执行 parseApiJson。"
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
 *       "key": "publishContext",
 *       "type": "{ uuid: string, status: string }",
 *       "required": true,
 *       "description": "唯一参数对象，必须包含 API uuid 和 status。"
 *     }
 *   ],
 *   "outputs": [
 *     {
 *       "key": "value",
 *       "type": "unknown",
 *       "description": "校验通过或非 published 时返回原值。"
 *     }
 *   ],
 *   "errors": [
 *     {
 *       "code": "PROCESSOR_INVALID_CONFIG",
 *       "description": "param 不是对象，或缺少 uuid/status 时抛出。"
 *     },
 *     {
 *       "code": "API_JSON_*",
 *       "description": "status 为 published 且 API JSON 非法时沿用 parseApiJson 抛出的 API_JSON 相关错误。"
 *     }
 *   ],
 *   "config": [
 *     {
 *       "key": "processor",
 *       "type": "string",
 *       "required": true,
 *       "value": "api_json_when_published",
 *       "description": "Processor 名称；可使用字符串简写或对象配置。"
 *     },
 *     {
 *       "key": "param",
 *       "type": "{ uuid: string, status: string }",
 *       "required": true,
 *       "description": "包含 uuid 和 status 的对象。"
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
 *       "title": "发布时校验",
 *       "input": {
 *         "uuid": "save_demo",
 *         "blocks": [
 *           {
 *             "uuid": "starter",
 *             "nextBlock": null
 *           }
 *         ]
 *       },
 *       "processor": {
 *         "processor": "api_json_when_published",
 *         "param": {
 *           "uuid": "save_demo",
 *           "status": "published"
 *         }
 *       },
 *       "output": {
 *         "uuid": "save_demo",
 *         "blocks": [
 *           {
 *             "uuid": "starter",
 *             "nextBlock": null
 *           }
 *         ]
 *       }
 *     }
 *   ]
 * }
 */
export const apiJsonWhenPublishedProcessor: ProcessorExecutor = ({ value, params }) => {
  const param = getSingleParam('api_json_when_published', params)

  if (!isRecord(param)) {
    processorConfigError('api_json_when_published', 'param 必须包含 uuid 和 status。')
  }

  if (param.status !== 'published') {
    return value
  }

  const apiJsonUuid = assertApiJsonUuid(typeof param.uuid === 'string' ? param.uuid : undefined)

  parseApiJson(apiJsonUuid, value)

  return value
}
