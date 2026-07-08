import {
  invalidControllerInputs,
  invalidControllerNodes,
  primitiveValueType,
  type ControllerExecutor,
  type ControllerValueType,
} from './shared.js'

const supportedDataTypes = new Set<ControllerValueType>(['string', 'number', 'boolean'])

/**
 * @serverControllerDoc
 * {
 *   "version": 1,
 *   "functionName": "switch_controller",
 *   "displayName": "多分支控制器",
 *   "category": "flow",
 *   "description": "根据 inputs.value 和 nodes[].value 做严格相等匹配，命中后选择对应节点；未命中时选择可选 DEFAULT 节点。",
 *   "inputs": [
 *     { "key": "value", "type": "string|number|boolean", "required": true, "description": "用于匹配节点 value 的值，类型必须和 dataType 一致。" },
 *     { "key": "dataType", "type": "string", "required": true, "enum": ["string", "number", "boolean"], "description": "指定 value 和普通节点 value 的数据类型。" }
 *   ],
 *   "nodes": [
 *     { "key": "caseNodes", "type": "ControllerNode[]", "required": true, "description": "普通节点的 value 必须和 inputs.dataType 声明的类型一致，用于严格相等匹配。" },
 *     { "key": "defaultNode", "type": "ControllerNode", "required": false, "typeValue": "DEFAULT", "description": "可选默认节点，最多只能配置一个；未命中普通节点时执行。" }
 *   ],
 *   "errors": [
 *     { "code": "CONTROLLER_INVALID_INPUTS", "description": "inputs.dataType 不支持，或 inputs.value 类型和 dataType 不一致。" },
 *     { "code": "CONTROLLER_INVALID_NODES", "description": "DEFAULT 节点数量超过一个、普通节点 value 类型不匹配，或未命中且没有 DEFAULT 节点。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "sideEffect", "type": "string", "value": "none", "description": "只选择流程分支，不产生外部副作用。" }
 *   ],
 *   "examples": [
 *     { "title": "按状态分支", "controller": { "uuid": "status_controller", "functionName": "switch_controller", "type": "controller", "inputs": { "value": { "template": "{{request.body.status}}" }, "dataType": "string" }, "nodes": [ { "uuid": "published_node", "value": "published", "nextBlock": "publish_block" }, { "uuid": "draft_node", "value": "draft", "nextBlock": "save_block" }, { "uuid": "default_node", "type": "DEFAULT", "nextBlock": "save_block" } ] } }
 *   ]
 * }
 */
export const executeSwitchController: ControllerExecutor = ({ controller, inputs }) => {
  const dataType = inputs.dataType

  if (typeof dataType !== 'string' || !supportedDataTypes.has(dataType as ControllerValueType)) {
    invalidControllerInputs(controller, 'switch_controller inputs.dataType 必须是 string、number 或 boolean。')
  }

  const expectedType = dataType as ControllerValueType
  const actualType = primitiveValueType(inputs.value)

  if (actualType !== expectedType) {
    invalidControllerInputs(controller, `switch_controller inputs.value 必须是 ${expectedType} 类型。`)
  }

  const defaultNodes = controller.nodes.filter((node) => node.type === 'DEFAULT')

  if (defaultNodes.length > 1) {
    invalidControllerNodes(controller, 'switch_controller 只能配置一个 DEFAULT node。')
  }

  const normalNodes = controller.nodes.filter((node) => node.type !== 'DEFAULT')

  for (const node of normalNodes) {
    if (primitiveValueType(node.value) !== expectedType) {
      invalidControllerNodes(controller, `switch_controller 普通 node.value 必须是 ${expectedType} 类型。`)
    }
  }

  const matchedNode = normalNodes.find((node) => node.value === inputs.value)

  if (matchedNode) {
    return matchedNode
  }

  const defaultNode = defaultNodes[0]

  if (!defaultNode) {
    invalidControllerNodes(controller, 'switch_controller 未匹配到 node，且未配置 DEFAULT node。')
  }

  return defaultNode
}
