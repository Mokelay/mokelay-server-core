import { getSingleParam, processorConfigError, processorValidationError, type ProcessorExecutor } from './shared.js'

/**
 * @serverProcessorDoc
 * {
 *   "version":1,"functionName":"decimal_fixed","displayName":"定点小数格式化","category":"transform",
 *   "description":"按指定位数补零并去掉前导零，保留十进制精度。", "inputs":[{"key":"value","type":"string|number","required":true}],
 *   "params":[{"key":"scale","type":"number","required":true,"description":"小数位数，取 0 到 100 的整数。"}],
 *   "outputs":[{"key":"value","type":"string"}],"errors":[{"code":"PROCESSOR_VALIDATION_FAILED","description":"格式错误或需要舍入。"}],
 *   "config":[],"runtime":[],"examples":[{"title":"补齐小数位","input":"002.1","processor":{"processor":"decimal_fixed","param":2},"output":"2.10"}]
 * }
 */
export const decimalFixedProcessor: ProcessorExecutor = ({ value, params, label }) => {
  const scale = getSingleParam('decimal_fixed', params)
  if (typeof scale !== 'number' || !Number.isInteger(scale) || scale < 0 || scale > 100) {
    processorConfigError('decimal_fixed', '小数位数必须是 0 到 100 的整数。')
  }
  const match = (typeof value === 'string' || typeof value === 'number') && /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(value))
  if (!match) processorValidationError('decimal_fixed', label, '需要十进制数。')
  const fraction = (match[3] ?? '').replace(/0+$/, '')
  if (fraction.length > scale) processorValidationError('decimal_fixed', label, '超过指定小数位数。')
  const whole = match[2].replace(/^0+(?=\d)/, '')
  const sign = match[1] === '-' && (whole !== '0' || fraction) ? '-' : ''
  return sign + whole + (scale ? '.' + fraction.padEnd(scale, '0') : '')
}
