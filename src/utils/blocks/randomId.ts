import { randomInt } from 'node:crypto'
import { type BlockExecutor } from '../orchestration-schema.js'
import { mokelayError } from '../mokelay-error.js'
import { isRecord } from './shared.js'

const defaultAlphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
const defaultLength = 6
const maxLength = 32

function normalizeLength(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return defaultLength
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw mokelayError('BLOCK_RANDOM_ID_INVALID', 'length 必须是 1 到 32 的整数。', 400)
  }

  if (value > maxLength) {
    throw mokelayError('BLOCK_RANDOM_ID_INVALID', 'length 不能超过 32。', 400)
  }

  return value
}

function normalizeStringInput(value: unknown, name: string, defaultValue: string) {
  if (value === undefined || value === null) {
    return defaultValue
  }

  if (typeof value !== 'string') {
    throw mokelayError('BLOCK_RANDOM_ID_INVALID', `${name} 必须是字符串。`, 400)
  }

  return value
}

function normalizeAlphabet(value: unknown, lowerCase: boolean) {
  const rawAlphabet = normalizeStringInput(value, 'alphabet', defaultAlphabet)
  const alphabet = lowerCase ? rawAlphabet.toLowerCase() : rawAlphabet
  const chars = Array.from(alphabet).filter((char, index, source) => source.indexOf(char) === index)

  if (chars.length === 0) {
    throw mokelayError('BLOCK_RANDOM_ID_INVALID', 'alphabet 不能为空。', 400)
  }

  return chars
}

function normalizeInputs(inputs: Record<string, unknown>) {
  const lowerCase = typeof inputs.lowerCase === 'boolean' ? inputs.lowerCase : true
  const prefix = normalizeStringInput(inputs.prefix, 'prefix', '')

  return {
    prefix: lowerCase ? prefix.toLowerCase() : prefix,
    length: normalizeLength(inputs.length),
    alphabet: normalizeAlphabet(inputs.alphabet, lowerCase),
    lowerCase,
  }
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "randomId",
 *   "displayName": "生成随机 ID",
 *   "category": "utility",
 *   "description": "按前缀、长度和字符表生成短随机字符串，适合在 API 编排里生成临时 ID 或 schema 名。",
 *   "inputs": [
 *     { "key": "prefix", "type": "string", "required": false, "defaultValue": "", "description": "随机 ID 前缀。" },
 *     { "key": "length", "type": "number", "required": false, "defaultValue": 6, "description": "随机部分长度，最大 32。" },
 *     { "key": "alphabet", "type": "string", "required": false, "defaultValue": "abcdefghijklmnopqrstuvwxyz0123456789", "description": "随机字符表。" },
 *     { "key": "lowerCase", "type": "boolean", "required": false, "defaultValue": true, "description": "是否将前缀和字符表转为小写。" }
 *   ],
 *   "outputs": [
 *     { "key": "value", "type": "string", "description": "生成后的随机 ID。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_RANDOM_ID_INVALID", "description": "prefix、length 或 alphabet 配置非法。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" }
 *   ],
 *   "examples": [
 *     { "title": "生成企业免费 schema 名", "block": { "uuid": "generate_free_schema_name", "functionName": "randomId", "inputs": { "prefix": "e_", "length": 5, "alphabet": "abcdefghijklmnopqrstuvwxyz0123456789" }, "outputs": ["value"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeRandomIdBlock: BlockExecutor = async ({ inputs }) => {
  if (!isRecord(inputs)) {
    throw mokelayError('BLOCK_RANDOM_ID_INVALID', 'inputs 必须是对象。', 400)
  }

  const normalized = normalizeInputs(inputs)
  const randomPart = Array.from({ length: normalized.length }, () => normalized.alphabet[randomInt(normalized.alphabet.length)]!).join('')
  const value = `${normalized.prefix}${randomPart}`

  return {
    value: normalized.lowerCase ? value.toLowerCase() : value,
  }
}
