import { getSingleParam, processorConfigError, processorValidationError, type ProcessorExecutor } from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version":1,"functionName":"integer_add","displayName":"整数加法","category":"transform",
 *   "description":"对安全整数求和，返回 number。", "inputs":[{"key":"value","type":"number|string","required":true}],
 *   "params":[{"key":"addend","type":"number","required":true,"description":"要加上的安全整数。"}],
 *   "outputs":[{"key":"value","type":"number"}],"errors":[{"code":"PROCESSOR_VALIDATION_FAILED","description":"输入或结果不是安全整数。"}],
 *   "config":[],"runtime":[],"examples":[{"title":"计算下一个整数","input":"7","processor":{"processor":"integer_add","param":1},"output":8}]
 * }
 */
export const integerAddProcessor: ProcessorExecutor = ({ value, params, label }) => {
  const addend = getSingleParam('integer_add', params)
  if (typeof addend !== 'number' || !Number.isSafeInteger(addend)) {
    processorConfigError('integer_add', '加数必须是安全整数。')
  }
  const number = typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || !Number.isSafeInteger(number + addend)) {
    processorValidationError('integer_add', label, '输入和结果都必须是安全整数。')
  }
  return number + addend
}
