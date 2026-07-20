import { describe, expect, it } from 'vitest'
import { describePlainValue } from '../../../src/core/plain-data.js'

describe('describePlainValue', () => {
  it.each([
    ['string', 'BTC', 'BTC'],
    ['null', null, 'null'],
    ['number', 12, '12'],
    ['boolean', false, 'false'],
    ['bigint', 12n, '12'],
    ['array', [], 'array'],
    ['undefined', undefined, 'undefined'],
    ['object', {}, 'object'],
  ])('describes %s values', (_label, input, expected) => {
    expect(describePlainValue(input)).toBe(expected)
  })
})
