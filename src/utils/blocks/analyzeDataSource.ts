import {
  AiDataSourceConfigError,
  AiDataSourceModelOutputError,
  AiDataSourceProviderError,
  AiDataSourceUnrecognizedError,
  analyzeDataSource,
  isSupportedImageMimeType,
  maxImageBytes,
  maxTextBytes,
  type AnalyzeImageInput,
} from '../ai-data-source.js'
import { mokelayError } from '../mokelay-error.js'
import { type BlockExecutor } from '../orchestration-schema.js'
import { isRecord } from './shared.js'

type UploadedImage = AnalyzeImageInput & {
  fileName?: string
  size?: number
}

function normalizeOptionalText(value: unknown, name: string) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value !== 'string') {
    throw mokelayError('BLOCK_AI_INPUT_INVALID', `${name} 必须是字符串。`, 400)
  }

  const text = value.trim()

  if (!text) {
    return undefined
  }

  if (Buffer.byteLength(text, 'utf8') > maxTextBytes) {
    throw mokelayError('BLOCK_AI_INPUT_INVALID', `${name} 不能超过 100KB。`, 400)
  }

  return text
}

function normalizeImage(value: unknown): UploadedImage | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (!isRecord(value)) {
    throw mokelayError('BLOCK_AI_INPUT_INVALID', 'image 只能通过 multipart/form-data 上传图片文件。', 400)
  }

  const data = value.data
  const mimeType = typeof value.mimeType === 'string' ? value.mimeType : ''

  if (!Buffer.isBuffer(data) || data.byteLength === 0) {
    throw mokelayError('BLOCK_AI_INPUT_INVALID', '请上传 image 图片文件。', 400)
  }

  if (!isSupportedImageMimeType(mimeType)) {
    throw mokelayError('BLOCK_AI_INPUT_INVALID', '仅支持 JPEG、PNG 或 WebP 图片。', 400)
  }

  if (data.byteLength > maxImageBytes) {
    throw mokelayError('BLOCK_AI_INPUT_INVALID', '图片大小不能超过 10MB。', 400)
  }

  return {
    data,
    mimeType,
    fileName: typeof value.fileName === 'string' ? value.fileName : undefined,
    size: typeof value.size === 'number' ? value.size : data.byteLength,
  }
}

/**
 * analyzeDataSource block
 * 作用：使用 AI 识别 JSON 数据或 HTTP API 信息。
 * inputs：prompt 可选补充提示词；userInput 可选用户输入；image 可选 multipart 图片文件。
 * outputs：result。
 */
export const executeAnalyzeDataSourceBlock: BlockExecutor = async ({ inputs }) => {
  const prompt = normalizeOptionalText(inputs.prompt, 'prompt')
  const userInput = normalizeOptionalText(inputs.userInput, 'userInput')
  const image = normalizeImage(inputs.image)

  if (!userInput && !image) {
    throw mokelayError('BLOCK_AI_INPUT_INVALID', '请传入 userInput 文本内容，或上传 image 图片文件。', 400)
  }

  try {
    const result = await analyzeDataSource({
      prompt,
      userInput,
      image,
    })

    return { result }
  } catch (error) {
    if (error instanceof AiDataSourceUnrecognizedError) {
      throw mokelayError('BLOCK_AI_UNRECOGNIZED', error.message, 422, error)
    }

    if (error instanceof AiDataSourceConfigError) {
      throw mokelayError('BLOCK_AI_CONFIG_MISSING', error.message, 500, error)
    }

    if (error instanceof AiDataSourceProviderError) {
      throw mokelayError('BLOCK_AI_PROVIDER_FAILED', error.message, 502, error)
    }

    if (error instanceof AiDataSourceModelOutputError) {
      throw mokelayError('BLOCK_AI_OUTPUT_INVALID', error.message, 502, error)
    }

    throw error
  }
}
