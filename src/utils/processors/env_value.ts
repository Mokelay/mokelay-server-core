import { getSingleParam, processorConfigError, type ProcessorExecutor } from './shared.js'

/**
 * env_value processor
 * 作用：读取指定环境变量，常用于把发布目录、开关等运行时配置注入模板。
 * 参数：一个非空 envKey 字符串。
 * 返回：process.env[envKey.trim()]；参数非法会抛出 PROCESSOR_INVALID_CONFIG。
 */
export const envValueProcessor: ProcessorExecutor = ({ params }) => {
  const envKey = getSingleParam('env_value', params)

  if (typeof envKey !== 'string' || !envKey.trim()) {
    processorConfigError('env_value', 'param 必须是非空环境变量 key。')
  }

  return process.env[envKey.trim()]
}
