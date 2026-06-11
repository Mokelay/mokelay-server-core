import OpenAI from 'openai'
import { isError } from 'h3'
import { mokelayError } from '../mokelay-error.js'
import { type BlockExecutor } from '../orchestration-schema.js'
import { isRecord } from './shared.js'

export const maxOpenAIImageBytes = 10 * 1024 * 1024
export const maxOpenAIPromptBytes = 100 * 1024
export const supportedOpenAIImageMimeTypes = ['image/jpeg', 'image/png', 'image/webp'] as const

type SupportedImageMimeType = typeof supportedOpenAIImageMimeTypes[number]

type UploadedImage = {
  data: Buffer
  mimeType: SupportedImageMimeType
  fileName?: string
  size?: number
}

const jsonOutputInstruction = '只返回一个合法 JSON 对象，不要返回 Markdown、代码块或解释文字。'

function normalizePrompt(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError('BLOCK_AI_INPUT_INVALID', 'prompt 必须是非空字符串。', 400)
  }

  const prompt = value.trim()

  if (Buffer.byteLength(prompt, 'utf8') > maxOpenAIPromptBytes) {
    throw mokelayError('BLOCK_AI_INPUT_INVALID', 'prompt 不能超过 100KB。', 400)
  }

  return `${prompt}\n\n${jsonOutputInstruction}`
}

function normalizeUserInput(value: unknown) {
  if (value === undefined || value === '') {
    return undefined
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    const text = JSON.stringify(value)

    if (text === undefined) {
      throw new Error('JSON.stringify returned undefined.')
    }

    return text
  } catch (error) {
    throw mokelayError('BLOCK_AI_INPUT_INVALID', 'userInput 必须是可 JSON 序列化的数据。', 400, error)
  }
}

function isSupportedImageMimeType(mimeType: string): mimeType is SupportedImageMimeType {
  return supportedOpenAIImageMimeTypes.includes(mimeType as SupportedImageMimeType)
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

  if (data.byteLength > maxOpenAIImageBytes) {
    throw mokelayError('BLOCK_AI_INPUT_INVALID', '图片大小不能超过 10MB。', 400)
  }

  return {
    data,
    mimeType,
    fileName: typeof value.fileName === 'string' ? value.fileName : undefined,
    size: typeof value.size === 'number' ? value.size : data.byteLength,
  }
}

function imageBufferToDataUrl(image: UploadedImage) {
  return `data:${image.mimeType};base64,${image.data.toString('base64')}`
}

function isProviderConfigError(error: unknown) {
  if (!isRecord(error)) {
    return false
  }

  const status = typeof error.status === 'number' ? error.status : undefined
  const code = typeof error.code === 'string' ? error.code : undefined
  const type = typeof error.type === 'string' ? error.type : undefined
  const param = typeof error.param === 'string' ? error.param : undefined

  return status === 401
    || code === 'invalid_api_key'
    || code === 'authentication_error'
    || type === 'authentication_error'
    || code === 'model_not_found'
    || code === 'invalid_model'
    || param === 'model'
}

function providerConfigErrorMessage(error: unknown) {
  if (isRecord(error)) {
    const code = typeof error.code === 'string' ? error.code : undefined
    const param = typeof error.param === 'string' ? error.param : undefined

    if (code === 'model_not_found' || code === 'invalid_model' || param === 'model') {
      return 'AI 模型配置无效，请检查 OPENAI_MODEL。'
    }
  }

  return 'AI 服务认证配置无效，请检查 OPENAI_API_KEY。'
}

function hasRefusal(response: { output: Array<unknown> }) {
  return response.output.some((item) => {
    if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) {
      return false
    }

    return item.content.some((content) => isRecord(content) && content.type === 'refusal')
  })
}

function parseResult(response: {
  status?: string
  output: Array<unknown>
  output_text: string
}) {
  if (response.status !== undefined && response.status !== 'completed') {
    throw mokelayError('BLOCK_AI_OUTPUT_INVALID', `AI 返回状态无效：${response.status}。`, 502)
  }

  if (hasRefusal(response)) {
    throw mokelayError('BLOCK_AI_OUTPUT_INVALID', 'AI 拒绝了当前请求。', 502)
  }

  const outputText = response.output_text.trim()

  if (!outputText) {
    throw mokelayError('BLOCK_AI_OUTPUT_INVALID', 'AI 返回内容为空。', 502)
  }

  let result: unknown

  try {
    result = JSON.parse(outputText)
  } catch (error) {
    throw mokelayError('BLOCK_AI_OUTPUT_INVALID', 'AI 返回的内容不是合法 JSON。', 502, error)
  }

  if (!isRecord(result)) {
    throw mokelayError('BLOCK_AI_OUTPUT_INVALID', 'AI 返回的 JSON 顶层必须是对象。', 502)
  }

  return result
}

/**
 * openAI block
 * 作用：调用 OpenAI Responses API，并将返回的 JSON object 解析到 result。
 * inputs：prompt 必填；userInput 或 image 至少提供一个。
 * outputs：result。
 */
export const executeOpenAIBlock: BlockExecutor = async ({ inputs }) => {
  const prompt = normalizePrompt(inputs.prompt)
  const userInput = normalizeUserInput(inputs.userInput)
  const image = normalizeImage(inputs.image)

  if (userInput === undefined && !image) {
    throw mokelayError('BLOCK_AI_INPUT_INVALID', '请传入 userInput，或上传 image 图片文件。', 400)
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim()

  if (!apiKey) {
    throw mokelayError('BLOCK_AI_CONFIG_MISSING', '缺少 OPENAI_API_KEY 配置。', 500)
  }

  const content = [
    ...(userInput === undefined ? [] : [{ type: 'input_text' as const, text: userInput }]),
    ...(image
      ? [{
          type: 'input_image' as const,
          image_url: imageBufferToDataUrl(image),
          detail: 'high' as const,
        }]
      : []),
  ]

  try {
    const client = new OpenAI({ apiKey })
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini',
      input: [
        { role: 'developer', content: prompt },
        { role: 'user', content },
      ],
      max_output_tokens: 8192,
      store: false,
      text: {
        format: { type: 'json_object' },
      },
    })

    return { result: parseResult(response) }
  } catch (error) {
    if (isError(error)) {
      throw error
    }

    if (isProviderConfigError(error)) {
      throw mokelayError('BLOCK_AI_CONFIG_MISSING', providerConfigErrorMessage(error), 500, error)
    }

    throw mokelayError('BLOCK_AI_PROVIDER_FAILED', 'AI 服务调用失败。', 502, error)
  }
}
