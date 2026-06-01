import { type Controller, type ControllerNode } from '../orchestration-schema.js'
import { mokelayError } from '../mokelay-error.js'

export type ControllerExecutorInput = {
  controller: Controller
  inputs: Record<string, unknown>
}

export type ControllerExecutor = (input: ControllerExecutorInput) => ControllerNode

export type ControllerValueType = 'string' | 'number' | 'boolean'

export function primitiveValueType(value: unknown): ControllerValueType | undefined {
  switch (typeof value) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
  }

  return undefined
}

export function invalidControllerInputs(controller: Controller, message: string): never {
  throw mokelayError(
    'CONTROLLER_INVALID_INPUTS',
    `Controller ${controller.uuid} inputs 配置无效：${message}`,
    400,
  )
}

export function invalidControllerNodes(controller: Controller, message: string): never {
  throw mokelayError(
    'CONTROLLER_INVALID_NODES',
    `Controller ${controller.uuid} nodes 配置无效：${message}`,
    400,
  )
}
