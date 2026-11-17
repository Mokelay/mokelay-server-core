import { mokelayError, mokelayErrorCodes, type MokelayErrorCode } from '../mokelay-error.js'
import type { BlockExecutor } from '../orchestration-schema.js'

/**
 * @serverBlockDoc
 * {
 *   "version": 1, "functionName": "assert", "displayName": "断言条件", "category": "flow",
 *   "description": "检查一个布尔条件，失败时抛出配置的错误。",
 *   "inputs": [
 *     {"key":"condition","type":"boolean","required":true,"description":"由模板或 Processor 产生的布尔值。"},
 *     {"key":"code","type":"MokelayErrorCode","required":true,"description":"平台定义的错误码。"},
 *     {"key":"message","type":"string","required":true,"description":"断言失败时返回的信息。"},
 *     {"key":"statusCode","type":"number","required":false,"description":"错误状态码，默认 400。"}
 *   ],
 *   "outputs": [], "errors": [{"code":"API_JSON_INVALID_SCHEMA","description":"断言配置无效。"}], "config": [],
 *   "runtime": [{"key":"requiresDatasource","value":false}],
 *   "examples": [{"title":"要求存在记录","block":{"uuid":"require_record","functionName":"assert","inputs":{"condition":{"template":"{{blocks.lookup.outputs.data}}","processors":["not_null"]},"code":"REQUEST_INVALID_BODY","message":"记录不存在。"},"nextBlock":null}}]
 * }
 */
export const executeAssertBlock: BlockExecutor = async ({ inputs }) => {
  const { condition, code, message, statusCode = 400 } = inputs
  if (typeof condition !== 'boolean' || !mokelayErrorCodes.includes(code as MokelayErrorCode)
    || typeof message !== 'string' || !message.trim()
    || typeof statusCode !== 'number' || !Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
    throw mokelayError('API_JSON_INVALID_SCHEMA', 'assert 需要布尔条件、有效错误码、消息和错误状态码。', 400)
  }
  if (!condition) throw mokelayError(code as MokelayErrorCode, message, statusCode)
  return {}
}
