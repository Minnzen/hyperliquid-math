import { describe, expect, it } from 'vitest'
import { quantizePrice, quantizeSize } from '../../../src/precision/index.js'

function okDecimal(result: ReturnType<typeof quantizePrice> | ReturnType<typeof quantizeSize>) {
  expect(result.value.status).toBe('ok')
  if (result.value.status !== 'ok') throw new Error('expected ok mutation-kill vector')
  return result.value.data.value
}

describe('precision directed mutation-kill vectors', () => {
  it('kills a six-significant-figure price mutant', () => {
    const actual = okDecimal(
      quantizePrice({ value: '1.23456', marketKind: 'perp', szDecimals: 0, rounding: 'down' }),
    )
    expect(actual).toBe('1.2345')
    expect(actual).not.toBe('1.23456')
  })

  it('kills a missing integer-exemption mutant', () => {
    const actual = okDecimal(
      quantizePrice({ value: '123456', marketKind: 'perp', szDecimals: 0, rounding: 'down' }),
    )
    expect(actual).toBe('123456')
    expect(actual).not.toBe('123450')
  })

  it('kills a spot-decimal-limit-applied-to-perps mutant', () => {
    const result = quantizePrice({
      value: '0.0000009',
      marketKind: 'perp',
      szDecimals: 0,
      rounding: 'down',
    })
    expect(result.value.status).toBe('invalid-input')
  })

  it('kills an away-from-zero size rounding mutant', () => {
    const actual = okDecimal(quantizeSize({ value: '1.2341', szDecimals: 3 }))
    expect(actual).toBe('1.234')
    expect(actual).not.toBe('1.235')
  })
})
