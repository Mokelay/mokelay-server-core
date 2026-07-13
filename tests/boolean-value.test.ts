import { describe, expect, it } from 'vitest'
import { booleanValueProcessor } from '../src/utils/processors/boolean_value.js'

describe('boolean_value processor', () => {
  it.each([
    ['true', true], ['1', true], [1, true], [true, true],
    ['false', false], ['0', false], [0, false], [false, false],
  ])('normalizes %j to %j', (value, expected) => {
    expect(booleanValueProcessor({ value, label: 'query.subPage', params: [] })).toBe(expected)
  })

  it('preserves optional empty values and rejects other strings', () => {
    expect(booleanValueProcessor({ value: undefined, label: 'query.subPage', params: [] })).toBeUndefined()
    expect(() => booleanValueProcessor({ value: 'yes', label: 'query.subPage', params: [] })).toThrowError()
  })
})
