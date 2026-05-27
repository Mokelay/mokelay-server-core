import { assertApiJsonUuid, parseApiJson } from '../orchestration-schema.js'
import { getSingleParam, processorConfigError, type ProcessorExecutor } from './shared.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * api_json_when_published processor
 * 作用：API Builder 发布时，当 status 为 published 才校验当前值是合法 API JSON。
 * 参数：一个对象，必须包含 uuid 和 status；status 非 published 时不校验 API JSON。
 * 返回：校验通过或非 published 时返回原值；参数非法抛出 PROCESSOR_INVALID_CONFIG，API JSON 非法沿用 API_JSON_* 错误。
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
