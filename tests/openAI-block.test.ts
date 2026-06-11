import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeOpenAIBlock,
  maxOpenAIImageBytes,
  maxOpenAIPromptBytes,
} from '../src/utils/blocks/openAI.js'

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

  return { OpenAI, responsesCreate }
})

vi.mock('openai', () => ({
  default: openAiMocks.OpenAI,
}))

function execute(inputs: Record<string, unknown>) {
  return executeOpenAIBlock({
    event: undefined as never,
    block: undefined as never,
    inputs,
    executeSql: undefined as never,
  })
}

function completedResponse(outputText: string) {
  return {
    status: 'completed',
    output_text: outputText,
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: outputText }],
      },
    ],
  }
}

describe('executeOpenAIBlock', () => {
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

  it('sends developer instructions and text input, then parses a JSON object', async () => {
    openAiMocks.responsesCreate.mockResolvedValueOnce(completedResponse('{"ok":true}'))

    await expect(execute({
      prompt: 'Return the result.',
      userInput: 'hello',
    })).resolves.toEqual({ result: { ok: true } })

    expect(openAiMocks.OpenAI).toHaveBeenCalledWith({ apiKey: 'test-api-key' })
    expect(openAiMocks.responsesCreate).toHaveBeenCalledWith({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'developer',
          content: expect.stringContaining('Return the result.\n\n只返回一个合法 JSON 对象'),
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }],
        },
      ],
      max_output_tokens: 8192,
      store: false,
      text: { format: { type: 'json_object' } },
    })
  })

  it('serializes non-string user input and honors OPENAI_MODEL', async () => {
    process.env.OPENAI_MODEL = 'custom-model'
    openAiMocks.responsesCreate.mockResolvedValueOnce(completedResponse('{"translations":["Hi"]}'))

    await execute({
      prompt: 'Translate.',
      userInput: ['Hello'],
    })

    expect(openAiMocks.responsesCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'custom-model',
      input: expect.arrayContaining([
        {
          role: 'user',
          content: [{ type: 'input_text', text: '["Hello"]' }],
        },
      ]),
    }))
  })

  it('supports image-only and combined text-image input', async () => {
    openAiMocks.responsesCreate
      .mockResolvedValueOnce(completedResponse('{"type":"JSON"}'))
      .mockResolvedValueOnce(completedResponse('{"type":"API"}'))

    const image = {
      data: Buffer.from('image'),
      mimeType: 'image/png',
      fileName: 'source.png',
      size: 5,
    }

    await execute({ prompt: 'Analyze.', image })
    await execute({ prompt: 'Analyze.', userInput: 'Use the screenshot.', image })

    expect(openAiMocks.responsesCreate.mock.calls[0]?.[0]).toMatchObject({
      input: [
        { role: 'developer' },
        {
          role: 'user',
          content: [{
            type: 'input_image',
            image_url: 'data:image/png;base64,aW1hZ2U=',
            detail: 'high',
          }],
        },
      ],
    })
    expect(openAiMocks.responsesCreate.mock.calls[1]?.[0]).toMatchObject({
      input: [
        { role: 'developer' },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Use the screenshot.' },
            { type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=', detail: 'high' },
          ],
        },
      ],
    })
  })

  it('validates required inputs, prompt size, and image constraints', async () => {
    const cases = [
      { inputs: { userInput: 'hello' }, message: 'prompt 必须是非空字符串' },
      { inputs: { prompt: 'x', userInput: undefined }, message: '请传入 userInput' },
      { inputs: { prompt: 'x'.repeat(maxOpenAIPromptBytes + 1), userInput: 'hello' }, message: '100KB' },
      {
        inputs: { prompt: 'x', image: { data: Buffer.from('x'), mimeType: 'image/gif' } },
        message: '仅支持 JPEG',
      },
      {
        inputs: {
          prompt: 'x',
          image: { data: Buffer.alloc(maxOpenAIImageBytes + 1), mimeType: 'image/png' },
        },
        message: '10MB',
      },
    ]

    for (const item of cases) {
      await expect(execute(item.inputs)).rejects.toMatchObject({
        data: { code: 'BLOCK_AI_INPUT_INVALID' },
        message: expect.stringContaining(item.message),
      })
    }

    expect(openAiMocks.responsesCreate).not.toHaveBeenCalled()
  })

  it('requires OPENAI_API_KEY', async () => {
    delete process.env.OPENAI_API_KEY

    await expect(execute({ prompt: 'x', userInput: 'hello' })).rejects.toMatchObject({
      data: { code: 'BLOCK_AI_CONFIG_MISSING' },
      statusCode: 500,
    })
  })

  it('rejects empty, invalid, non-object, refused, and incomplete outputs', async () => {
    const responses = [
      completedResponse(''),
      completedResponse('not-json'),
      completedResponse('[1,2]'),
      {
        status: 'completed',
        output_text: '',
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] }],
      },
      { status: 'incomplete', output_text: '{"partial":', output: [] },
    ]

    for (const response of responses) {
      openAiMocks.responsesCreate.mockResolvedValueOnce(response)

      await expect(execute({ prompt: 'x', userInput: 'hello' })).rejects.toMatchObject({
        data: { code: 'BLOCK_AI_OUTPUT_INVALID' },
        statusCode: 502,
      })
    }
  })

  it('maps authentication and model errors to configuration errors', async () => {
    const cases = [
      {
        error: Object.assign(new Error('Invalid key.'), { status: 401, code: 'invalid_api_key' }),
        message: 'OPENAI_API_KEY',
      },
      {
        error: Object.assign(new Error('Missing model.'), { status: 404, code: 'model_not_found', param: 'model' }),
        message: 'OPENAI_MODEL',
      },
    ]

    for (const item of cases) {
      openAiMocks.responsesCreate.mockRejectedValueOnce(item.error)

      await expect(execute({ prompt: 'x', userInput: 'hello' })).rejects.toMatchObject({
        data: { code: 'BLOCK_AI_CONFIG_MISSING' },
        message: expect.stringContaining(item.message),
      })
    }
  })

  it('maps other OpenAI failures to provider errors', async () => {
    openAiMocks.responsesCreate.mockRejectedValueOnce(Object.assign(new Error('Unavailable.'), {
      status: 500,
      code: 'server_error',
    }))

    await expect(execute({ prompt: 'x', userInput: 'hello' })).rejects.toMatchObject({
      data: { code: 'BLOCK_AI_PROVIDER_FAILED' },
      statusCode: 502,
    })
  })
})
