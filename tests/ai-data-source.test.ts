import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AiDataSourceConfigError,
  AiDataSourceProviderError,
  analyzeDataSource,
} from '../src/utils/ai-data-source.js'

const originalOpenAiApiKey = process.env.OPENAI_API_KEY
const originalOpenAiModel = process.env.OPENAI_MODEL

const openAiMocks = vi.hoisted(() => {
  const responsesCreate = vi.fn()
  const OpenAI = vi.fn(function () {
    return {
      responses: {
        create: responsesCreate,
      },
    }
  })

  return {
    OpenAI,
    responsesCreate,
  }
})

vi.mock('openai', () => ({
  default: openAiMocks.OpenAI,
}))

describe('analyzeDataSource', () => {
  beforeEach(() => {
    openAiMocks.OpenAI.mockClear()
    openAiMocks.responsesCreate.mockReset()
    process.env.OPENAI_API_KEY = 'test-api-key'
    delete process.env.OPENAI_MODEL
  })

  afterAll(() => {
    if (originalOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiApiKey
    }

    if (originalOpenAiModel === undefined) {
      delete process.env.OPENAI_MODEL
    } else {
      process.env.OPENAI_MODEL = originalOpenAiModel
    }
  })

  it('maps OpenAI authentication failures to config errors', async () => {
    openAiMocks.responsesCreate.mockRejectedValueOnce(Object.assign(
      new Error('Incorrect API key provided.'),
      {
        status: 401,
        code: 'invalid_api_key',
        type: 'invalid_request_error',
      },
    ))

    await expect(analyzeDataSource({
      userInput: 'url:http://api.mokelay.com/api method:post',
    })).rejects.toMatchObject({
      name: AiDataSourceConfigError.name,
      message: 'AI 服务认证配置无效，请检查 OPENAI_API_KEY。',
    })
  })

  it('maps invalid model failures to config errors', async () => {
    openAiMocks.responsesCreate.mockRejectedValueOnce(Object.assign(
      new Error('The model does not exist.'),
      {
        status: 404,
        code: 'model_not_found',
        param: 'model',
      },
    ))

    await expect(analyzeDataSource({
      userInput: 'url:http://api.mokelay.com/api method:post',
    })).rejects.toMatchObject({
      name: AiDataSourceConfigError.name,
      message: 'AI 模型配置无效，请检查 OPENAI_MODEL。',
    })
  })

  it('keeps non-config OpenAI failures as provider errors', async () => {
    openAiMocks.responsesCreate.mockRejectedValueOnce(Object.assign(
      new Error('Upstream service unavailable.'),
      {
        status: 500,
        code: 'server_error',
      },
    ))

    await expect(analyzeDataSource({
      userInput: 'url:http://api.mokelay.com/api method:post',
    })).rejects.toBeInstanceOf(AiDataSourceProviderError)
  })
})
