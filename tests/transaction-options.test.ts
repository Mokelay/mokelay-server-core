import { describe, expect, it } from 'vitest'
import { normalizeTransactionRetries } from '../src/utils/db.js'

describe('transaction retry options', () => {
  it('uses a finite bounded retry count', () => {
    expect(normalizeTransactionRetries(undefined)).toBe(2)
    expect(normalizeTransactionRetries(Number.NaN)).toBe(2)
    expect(normalizeTransactionRetries(Number.POSITIVE_INFINITY)).toBe(2)
    expect(normalizeTransactionRetries(Number.NEGATIVE_INFINITY)).toBe(2)
    expect(normalizeTransactionRetries(-3)).toBe(0)
    expect(normalizeTransactionRetries(4.9)).toBe(4)
    expect(normalizeTransactionRetries(1_000_000)).toBe(10)
  })
})
