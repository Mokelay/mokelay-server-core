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
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "saveJsonToR2",
 *   "displayName": "保存 JSON 到 R2",
 *   "category": "storage",
 *   "description": "把 JSON 数据保存到 Cloudflare R2，也可通过 enabled=false 显式跳过保存。",
 *   "inputs": [
 *     { "key": "enabled", "type": "boolean", "required": false, "defaultValue": true, "description": "为 false 时跳过保存并返回 skipped=true。" },
 *     { "key": "directory", "type": "string", "required": true, "description": "R2 目录，不能包含非法路径片段。" },
 *     { "key": "fileName", "type": "string", "required": true, "description": "R2 文件名。" },
 *     { "key": "data", "type": "object|string", "required": true, "description": "要保存的 JSON 对象，或可解析的 JSON 字符串。" }
 *   ],
 *   "outputs": [
 *     { "key": "key", "type": "string|null", "description": "R2 object key；跳过时为 null。" },
 *     { "key": "directory", "type": "string|null", "description": "保存目录；跳过时为 null。" },
 *     { "key": "fileName", "type": "string|null", "description": "保存文件名；跳过时为 null。" },
 *     { "key": "bucket", "type": "string|null", "description": "R2 bucket；跳过时为 null。" },
 *     { "key": "size", "type": "number", "description": "写入字节数；跳过时为 0。" },
 *     { "key": "etag", "type": "string|null", "description": "R2 返回的 ETag。" },
 *     { "key": "skipped", "type": "boolean", "description": "是否因为 enabled=false 跳过保存。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_R2_DIRECTORY_INVALID", "description": "directory 不是合法 R2 目录。" },
 *     { "code": "BLOCK_R2_FILE_NAME_INVALID", "description": "fileName 不是合法 R2 文件名。" },
 *     { "code": "BLOCK_R2_JSON_INVALID", "description": "data 缺失、不是合法 JSON 字符串或不可序列化。" },
 *     { "code": "BLOCK_R2_CONFIG_MISSING", "description": "Cloudflare R2 配置缺失。" },
 *     { "code": "BLOCK_R2_SAVE_FAILED", "description": "保存到 R2 失败。" }
 *   ],
 *   "config": [
 *     { "key": "CLOUDFLARE_R2_ACCOUNT_ID", "type": "string", "required": false, "description": "R2 账号 ID；也可用 CLOUDFLARE_R2_ENDPOINT 替代 endpoint。" },
 *     { "key": "CLOUDFLARE_R2_ENDPOINT", "type": "string", "required": false, "description": "自定义 R2 endpoint。" },
 *     { "key": "CLOUDFLARE_R2_ACCESS_KEY_ID", "type": "string", "required": true, "description": "R2 access key id。" },
 *     { "key": "CLOUDFLARE_R2_SECRET_ACCESS_KEY", "type": "string", "required": true, "description": "R2 secret access key。" },
 *     { "key": "MOKELAY_APIS_R2_BUCKET", "type": "string", "required": true, "description": "保存 JSON 的 R2 bucket。" }
 *   ],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "sideEffect", "type": "string", "value": "r2-put-object", "description": "会向 Cloudflare R2 写入对象。" }
 *   ],
 *   "examples": [
 *     { "title": "发布 API JSON", "block": { "uuid": "save_api_json", "functionName": "saveJsonToR2", "inputs": { "directory": "mokelay-apis", "fileName": "demo.json", "data": { "template": "{{request.body.apiJson}}" } }, "outputs": ["key", "directory", "fileName", "bucket", "size", "etag", "skipped"], "nextBlock": null } }
 *   ]
 * }
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
