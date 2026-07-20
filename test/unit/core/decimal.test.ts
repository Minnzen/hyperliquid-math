import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { Decimal40, normalizeDecimalString } from '../../../src/core/decimal.js'

describe('Decimal kernel', () => {
  it('uses an isolated 40 digit HALF_EVEN clone', () => {
    expect(Decimal40.precision).toBe(40)
    expect(Decimal40.rounding).toBe(Decimal.ROUND_HALF_EVEN)
    expect(Decimal.precision).toBe(20)
    expect(Decimal.rounding).toBe(Decimal.ROUND_HALF_UP)
  })

  it.each([
    ['001.2300', '1.23'],
    ['-0.000', '0'],
    ['1000', '1000'],
    ['0.00000000000000000001', '0.00000000000000000001'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeDecimalString(input)).toMatchObject({ ok: true, value: expected })
  })

  it.each(['1e3', '+1', ' 1', '1 ', '.5', '1.', 'Infinity', 'NaN', ''])('rejects %j', (input) => {
    expect(normalizeDecimalString(input)).toEqual({
      ok: false,
      issue: {
        code: 'invalid-decimal-string',
        path: '/value',
        actual: input,
        expected: 'plain decimal string without exponent, sign +, or whitespace',
      },
    })
  })
})
