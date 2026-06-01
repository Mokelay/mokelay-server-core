import {
  invalidControllerInputs,
  invalidControllerNodes,
  primitiveValueType,
  type ControllerExecutor,
  type ControllerValueType,
} from './shared.js'

const supportedDataTypes = new Set<ControllerValueType>(['string', 'number', 'boolean'])

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
