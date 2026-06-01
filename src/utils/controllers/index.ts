import { type ControllerExecutor } from './shared.js'
import { executeIfController } from './if_controller.js'
import { executeSwitchController } from './switch_controller.js'

export const controllerExecutors: Record<string, ControllerExecutor> = {
  if_controller: executeIfController,
  switch_controller: executeSwitchController,
}

export type { ControllerExecutor, ControllerExecutorInput } from './shared.js'
