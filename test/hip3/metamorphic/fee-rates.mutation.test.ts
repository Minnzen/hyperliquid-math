import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { calculateHip3FeeRates } from '../../../src/hip3/index.js'

describe('HIP-3 fee rate directed mutation-kill vectors', () => {
  it('kills a deployerFeeScale equals one low-branch mutant', () => {
    const result = calculateHip3FeeRates({
      makerRate: '0.0001',
      takerRate: '0.0004',
      activeReferralDiscount: '0.04',
      isAlignedQuoteToken: false,
      deployerFeeScale: '1',
      growthMode: false,
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.hip3Scale).toBe('2')
    expect(result.value.data.deployerShare).toBe('0.5')
    expect(result.value.data.effectiveMakerRate).toBe('0.000192')
  })

  it('kills a negative-maker referral-discount mutant', () => {
    const result = calculateHip3FeeRates({
      makerRate: '-0.0001',
      takerRate: '0.0004',
      activeReferralDiscount: '1',
      isAlignedQuoteToken: false,
      deployerFeeScale: '3',
      growthMode: false,
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.effectiveMakerRate).toBe('-0.0001')
  })

  it('kills an aligned taker multiplier sign mutant', () => {
    const aligned = calculateHip3FeeRates({
      makerRate: '0',
      takerRate: '0.0004',
      activeReferralDiscount: '0',
      isAlignedQuoteToken: true,
      deployerFeeScale: '0.25',
      growthMode: false,
    })
    const unaligned = calculateHip3FeeRates({
      makerRate: '0',
      takerRate: '0.0004',
      activeReferralDiscount: '0',
      isAlignedQuoteToken: false,
      deployerFeeScale: '0.25',
      growthMode: false,
    })

    expect(aligned.value.status).toBe('ok')
    expect(unaligned.value.status).toBe('ok')
    if (aligned.value.status !== 'ok' || unaligned.value.status !== 'ok') return
    expect(
      new Decimal(aligned.value.data.effectiveTakerRate).lt(
        unaligned.value.data.effectiveTakerRate,
      ),
    ).toBe(true)
    expect(aligned.value.data.alignedTakerScale).toBe('0.84')
  })
})
