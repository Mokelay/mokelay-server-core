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

export const executeIfController: ControllerExecutor = ({ controller, inputs }) => {
  const { trueNodes, falseNodes, unsupportedNodes } = validateIfNodes(controller.nodes)

  if (unsupportedNodes.length > 0 || trueNodes.length !== 1 || falseNodes.length !== 1) {
    invalidControllerNodes(controller, 'if_controller 必须且只能配置一个 value=true node 和一个 value=false node。')
  }

  return isTrueBranchValue(inputs.value) ? trueNodes[0] : falseNodes[0]
}
