import { type BlockExecutor } from '../orchestration-schema.js'
import { mokelayError } from '../mokelay-error.js'
import { isRecord } from './shared.js'

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "executeFragment",
 *   "displayName": "执行 Fragment",
 *   "category": "orchestration",
 *   "description": "在隔离的 params/blocks 上下文中执行已发布的 Fragment，并返回固定 result 输出。",
 *   "inputs": [
 *     { "key": "fragmentUuid", "type": "string", "required": true, "description": "目标 Fragment 的字面量 UUID，不支持模板。" },
 *     { "key": "params", "type": "Record<string, unknown>", "required": true, "description": "目标 Fragment 声明的参数。" }
 *   ],
 *   "outputs": [
 *     { "key": "result", "type": "Record<string, unknown>", "description": "Fragment response/responses 解析后的结果对象。" }
 *   ],
 *   "errors": [
 *     { "code": "FRAGMENT_TARGET_INVALID", "description": "目标不是 Fragment。" },
 *     { "code": "FRAGMENT_PARAMETER_MISSING", "description": "缺少必填 Fragment 参数。" },
 *     { "code": "FRAGMENT_PARAMETER_UNDECLARED", "description": "传入了 Fragment 未声明的参数。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "Block 自身不绑定数据源；Fragment 内各 Block 按原规则选择数据源。" }
 *   ],
 *   "examples": [
 *     { "title": "执行用户初始化 Fragment", "block": { "uuid": "provision_user", "functionName": "executeFragment", "inputs": { "fragmentUuid": "provision_new_user", "params": { "email": { "template": "{{request.body.email}}" } } }, "outputs": ["result"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeFragmentBlock: BlockExecutor = async ({ inputs, invokeFragment }) => {
  const fragmentUuid = typeof inputs.fragmentUuid === 'string' ? inputs.fragmentUuid : ''

  if (!fragmentUuid) {
    throw mokelayError('FRAGMENT_TARGET_INVALID', 'fragmentUuid 必须是非空字面量 UUID。', 400)
  }

  if (!isRecord(inputs.params)) {
    throw mokelayError('FRAGMENT_TARGET_INVALID', 'Fragment params 必须是对象。', 400)
  }

  return {
    result: await invokeFragment({
      fragmentUuid,
      params: inputs.params,
    }),
  }
}
