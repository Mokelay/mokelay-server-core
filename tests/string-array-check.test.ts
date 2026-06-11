import { describe, expect, it } from 'vitest'
import { stringArrayCheckProcessor } from '../src/utils/processors/string_array_check.js'

describe('string_array_check processor', () => {
  it('returns string arrays unchanged', () => {
    const value = ['Hello', '', 'World']

    expect(stringArrayCheckProcessor({
      value,
      params: [],
      label: 'request.body.texts',
    })).toBe(value)
  })

  it('rejects non-arrays and arrays containing non-string values', () => {
    for (const value of ['Hello', [1], ['Hello', null]]) {
      expect(() => stringArrayCheckProcessor({
        value,
        params: [],
        label: 'request.body.texts',
      })).toThrow('request.body.texts 必须是字符串数组')
    }
  })
})
