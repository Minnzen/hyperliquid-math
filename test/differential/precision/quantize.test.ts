import { describe, expect, it } from 'vitest'
import { quantizePrice, quantizeSize } from '../../../src/precision/index.js'

describe('precision differential oracle vectors', () => {
  it.each([
    { value: '12345.67891', szDecimals: 2, expected: '12345', precisionChanged: true },
    { value: '0.000123456', szDecimals: 1, expected: '0.00012', precisionChanged: true },
    { value: '100000', szDecimals: 2, expected: '100000' },
    { value: '1.23456789', szDecimals: 4, expected: '1.23', precisionChanged: true },
  ])(
    'matches pinned positive/down price formatting vectors: %j',
    ({ value, szDecimals, expected, precisionChanged }) => {
      const result = quantizePrice({ value, marketKind: 'perp', szDecimals, rounding: 'down' })

      expect(result.value).toEqual({
        status: 'ok',
        data: { value: expected, precisionChanged: precisionChanged ?? false },
      })
    },
  )

  it.each([
    { value: '1.23456789', szDecimals: 3, expected: '1.234', precisionChanged: true },
    { value: '0.000000019', szDecimals: 8, expected: '0.00000001', precisionChanged: true },
    { value: '100.0000', szDecimals: 4, expected: '100', precisionChanged: false },
    { value: '999.999999999', szDecimals: 6, expected: '999.999999', precisionChanged: true },
  ])(
    'matches pinned positive size formatting vectors: %j',
    ({ value, szDecimals, expected, precisionChanged }) => {
      const result = quantizeSize({ value, szDecimals })

      expect(result.value).toEqual({
        status: 'ok',
        data: { value: expected, precisionChanged },
      })
    },
  )
})
