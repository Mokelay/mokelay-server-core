import { describe, expect, it } from 'vitest'
import { mokelayError, toMokelayErrorResponse } from '../src/utils/mokelay-error.js'

describe('Mokelay error details', () => {
  it('preserves optional structured details in the compatible error body', () => {
    const error = mokelayError(
      'BLOCK_PAGE_REFERENCE_CYCLE',
      'cycle',
      409,
      undefined,
      { pageUuid: 'page-a', cycle: ['page-a', 'page-b', 'page-a'] },
    )

    expect(toMokelayErrorResponse(error)).toEqual({
      ok: false,
      error: {
        code: 'BLOCK_PAGE_REFERENCE_CYCLE',
        message: 'cycle',
        details: { pageUuid: 'page-a', cycle: ['page-a', 'page-b', 'page-a'] },
      },
    })
  })
})
