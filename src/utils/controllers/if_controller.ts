import { type ControllerNode } from '../orchestration-schema.js'
import {
  invalidControllerNodes,
  type ControllerExecutor,
} from './shared.js'

function isTrueBranchValue(value: unknown) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value > 0
  }

  if (typeof value === 'string') {
    return value.length > 0
  }

  return false
}

function validateIfNodes(nodes: ControllerNode[]) {
  const trueNodes = nodes.filter((node) => node.value === true)
  const falseNodes = nodes.filter((node) => node.value === false)
  const unsupportedNodes = nodes.filter((node) => node.type === 'DEFAULT' || typeof node.value !== 'boolean')

  return {
    trueNodes,
    falseNodes,
    unsupportedNodes,
  }
}

/**
 * @serverControllerDoc
 * {
 *   "version": 1,
 *   "functionName": "if_controller",
 *   "displayName": "条件控制器",
 *   "category": "flow",
 *   "description": "根据 inputs.value 的真假结果选择 true 或 false 分支节点继续执行。",
 *   "inputs": [
 *     { "key": "value", "type": "boolean|number|string|unknown", "required": true, "description": "分支判断值；boolean 按原值判断，number 大于 0 为 true，非空字符串为 true，其他值为 false。" }
 *   ],
 *   "nodes": [
 *     { "key": "trueNode", "type": "ControllerNode", "required": true, "value": true, "description": "必须且只能配置一个 value=true 的节点。" },
 *     { "key": "falseNode", "type": "ControllerNode", "required": true, "value": false, "description": "必须且只能配置一个 value=false 的节点。" }
 *   ],
 *   "errors": [
 *     { "code": "CONTROLLER_INVALID_NODES", "description": "nodes 未配置为且仅配置为一个 true 节点和一个 false 节点。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "sideEffect", "type": "string", "value": "none", "description": "只选择流程分支，不产生外部副作用。" }
 *   ],
 *   "examples": [
 *     { "title": "按发布状态分支", "controller": { "uuid": "publish_controller", "functionName": "if_controller", "type": "controller", "inputs": { "value": { "template": "{{request.body.published}}" } }, "nodes": [ { "uuid": "published_node", "value": true, "nextBlock": "publish_block" }, { "uuid": "draft_node", "value": false, "nextBlock": "save_block" } ] } }
 *   ]
 * }
 */
export const executeIfController: ControllerExecutor = ({ controller, inputs }) => {
  const { trueNodes, falseNodes, unsupportedNodes } = validateIfNodes(controller.nodes)

  if (unsupportedNodes.length > 0 || trueNodes.length !== 1 || falseNodes.length !== 1) {
    invalidControllerNodes(controller, 'if_controller 必须且只能配置一个 value=true node 和一个 value=false node。')
  }

  return isTrueBranchValue(inputs.value) ? trueNodes[0] : falseNodes[0]
}
