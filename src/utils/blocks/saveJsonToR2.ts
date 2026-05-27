import { type BlockExecutor } from '../orchestration-schema.js'
import { mokelayError } from '../mokelay-error.js'
import { saveJsonObjectToR2 } from '../r2-api-json.js'
import {
  isRecord,
  normalizeR2Directory,
  normalizeR2FileName,
  parseR2JsonData,
  stringifyR2JsonData,
} from './shared.js'

/**
 * saveJsonToR2 block
 * 作用：把 JSON 数据保存到 Cloudflare R2，也可通过 enabled=false 显式跳过保存。
 * inputs：enabled 可选布尔值；directory R2 目录；fileName R2 文件名；data 要保存的 JSON 对象或 JSON 字符串。
 * outputs：key、directory、fileName、bucket、size、etag、skipped。
 */
export const executeSaveJsonToR2Block: BlockExecutor = async ({ inputs }) => {
  if (inputs.enabled === false) {
    return {
      key: null,
      directory: null,
      fileName: null,
      bucket: null,
      size: 0,
      etag: null,
      skipped: true,
    }
  }

  const directory = normalizeR2Directory(inputs.directory)
  const fileName = normalizeR2FileName(inputs.fileName)

  if (!Object.prototype.hasOwnProperty.call(inputs, 'data') || inputs.data === undefined) {
    throw mokelayError('BLOCK_R2_JSON_INVALID', 'data 不能为空。', 400)
  }

  const body = stringifyR2JsonData(parseR2JsonData(inputs.data))
  const key = `${directory}/${fileName}`

  try {
    const result = await saveJsonObjectToR2({ key, body })

    if (!result) {
      throw mokelayError('BLOCK_R2_CONFIG_MISSING', 'Cloudflare R2 配置缺失。', 500)
    }

    return {
      key: result.key,
      directory,
      fileName,
      bucket: result.bucket,
      size: result.size,
      etag: result.etag ?? null,
      skipped: false,
    }
  } catch (error) {
    const data = typeof error === 'object' && error && 'data' in error ? error.data : undefined
    const code = isRecord(data) ? data.code : undefined

    if (code === 'BLOCK_R2_CONFIG_MISSING') {
      throw error
    }

    throw mokelayError('BLOCK_R2_SAVE_FAILED', '保存 JSON 到 Cloudflare R2 失败。', 500, error)
  }
}
