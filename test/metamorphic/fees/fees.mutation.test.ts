import { describe, expect, it } from 'vitest'
import { calculateTradeFee, selectFeeTier } from '../../../src/fees/index.js'

describe('fee directed mutation-kill vectors', () => {
  it('kills a fee-sign inversion mutant', () => {
    const result = calculateTradeFee({ price: '100', size: '2', rate: '0.001' })
    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.feeAmount).toBe('0.2')
    expect(result.value.data.accountValueDelta).toBe('-0.2')
  })

  it('kills a greater-than-or-equal tier boundary mutant', () => {
    const result = selectFeeTier({
      weightedVolume: '5000000',
      baseRates: { makerRate: '0.00015', takerRate: '0.00045' },
      tiers: [
        {
          minimumWeightedVolume: '5000000',
          makerRate: '0.00012',
          takerRate: '0.0004',
        },
      ],
    })
    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.selection).toEqual({ kind: 'base' })
  })
})
