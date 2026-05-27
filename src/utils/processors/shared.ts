import { mokelayError } from '../mokelay-error.js'
import { type BlockExecutionContext } from '../orchestration-schema.js'

export type ProcessorExecutorInput = {
  value: unknown
  params: unknown[]
  label: string
  context?: BlockExecutionContext
}

export type ProcessorExecutor = (input: ProcessorExecutorInput) => unknown | Promise<unknown>

export function processorConfigError(processor: string, message: string): never {
  throw mokelayError('PROCESSOR_INVALID_CONFIG', `Processor ${processor} 配置无效：${message}`, 400)
}

export function processorValidationError(processor: string, label: string, message: string): never {
  throw mokelayError('PROCESSOR_VALIDATION_FAILED', `Processor ${processor} 校验失败：${label} ${message}`, 400)
}

export function stringifyProcessorValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (value === undefined) {
    return 'undefined'
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function isNullishProcessorValue(value: unknown) {
  return value === undefined || value === null || value === ''
}

export function getLength(value: unknown, processor: string, label: string): number {
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length
  }

  processorValidationError(processor, label, '必须是字符串或数组。')
}

export function getLengthLimit(processor: string, params: unknown[]): number {
  const limit = params[0]

  if (params.length !== 1 || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0) {
    processorConfigError(processor, 'param 必须包含一个非负整数。')
  }

  return limit
}

export function getSingleParam(processor: string, params: unknown[]) {
  if (params.length !== 1) {
    processorConfigError(processor, 'param 必须包含一个参数。')
  }

  return params[0]
}

export function compileRegex(processor: string, param: unknown): RegExp {
  if (typeof param !== 'string' || !param) {
    processorConfigError(processor, 'param 必须是非空正则字符串。')
  }

  try {
    if (param.startsWith('/')) {
      const lastSlashIndex = param.lastIndexOf('/')

      if (lastSlashIndex > 0) {
        return new RegExp(param.slice(1, lastSlashIndex), param.slice(lastSlashIndex + 1))
      }
    }

    return new RegExp(param)
  } catch (error) {
    throw mokelayError('PROCESSOR_INVALID_CONFIG', `Processor ${processor} 配置无效：正则表达式无效。`, 400, error)
  }
}
