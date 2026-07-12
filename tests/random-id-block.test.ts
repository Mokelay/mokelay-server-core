import { describe, expect, it } from 'vitest'
import { executeRandomIdBlock } from '../src/utils/blocks/randomId.js'
import { blockDefinitions } from '../src/utils/blocks/index.js'
import { toMokelayErrorResponse } from '../src/utils/mokelay-error.js'

async function runRandomIdBlock(inputs: Record<string, unknown>) {
  return await executeRandomIdBlock({
    event: {} as never,
    block: {} as never,
    inputs,
    executeSql: {} as never,
  })
}

describe('randomId block', () => {
  it('generates a prefixed random id for free schema names', async () => {
    const result = await runRandomIdBlock({
      prefix: 'e_',
      length: 5,
      alphabet: 'abcdefghijklmnopqrstuvwxyz0123456789',
    })

    expect(result.value).toEqual(expect.stringMatching(/^e_[a-z0-9]{5}$/))
  })

  it.each([
    { length: 0 },
    { length: 33 },
    { length: 1.5 },
    { alphabet: '' },
    { prefix: 123 },
  ])('rejects invalid config %j', async (inputs) => {
    try {
      await runRandomIdBlock(inputs)
      throw new Error('Expected randomId to reject.')
    } catch (error) {
      expect(toMokelayErrorResponse(error).error.code).toBe('BLOCK_RANDOM_ID_INVALID')
    }
  })

  it('registers as a non-database block with value output', () => {
    expect(blockDefinitions.randomId).toMatchObject({
      allowedOutputs: ['value'],
    })
  })
})
