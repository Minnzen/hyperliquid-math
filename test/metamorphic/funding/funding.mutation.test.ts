import { describe, expect, it } from 'vitest'
import {
  calculateFundingPayment,
  calculateFundingPremiumIndex,
  calculateFundingRate,
} from '../../../src/funding/index.js'

describe('funding directed mutation-kill vectors', () => {
  it('kills a missing ask-side premium term mutant', () => {
    const result = calculateFundingPremiumIndex({
      impactBidPrice: '100',
      impactAskPrice: '98',
      oraclePrice: '100',
    })
    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.impactPriceDifference).toBe('-2')
    expect(result.value.data.premiumIndex).toBe('-0.02')
  })

  it('kills a divide-before-clamp funding-rate mutant', () => {
    const result = calculateFundingRate({
      averagePremiumIndex: '0.01',
      rules: {
        interestRate: '0.0001',
        clampLower: '-0.0005',
        clampUpper: '0.0005',
        baseIntervalHours: 8,
        hourlyCap: '0.04',
      },
    })
    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.hourlyRate).toBe('0.0011875')
    expect(result.value.data.hourlyRate).not.toBe('0.00124375')
  })

  it('kills positive, negative, and inclusive cap-comparison mutants', () => {
    const rules = {
      interestRate: '0',
      clampLower: '0',
      clampUpper: '0',
      baseIntervalHours: 1,
      hourlyCap: '0.04',
    }
    const positive = calculateFundingRate({ averagePremiumIndex: '0.05', rules })
    const negative = calculateFundingRate({ averagePremiumIndex: '-0.05', rules })
    const exact = calculateFundingRate({ averagePremiumIndex: '0.04', rules })

    expect(positive.value).toMatchObject({
      status: 'ok',
      data: { hourlyRate: '0.04', capped: true },
    })
    expect(negative.value).toMatchObject({
      status: 'ok',
      data: { hourlyRate: '-0.04', capped: true },
    })
    expect(exact.value).toMatchObject({
      status: 'ok',
      data: { hourlyRate: '0.04', capped: false },
    })
  })

  it('kills a long-funding-credit sign mutant', () => {
    const result = calculateFundingPayment({
      signedPositionSize: '10',
      oraclePrice: '10000',
      fundingRate: '0.0011875',
    })
    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.payment).toBe('118.75')
    expect(result.value.data.accountValueDelta).toBe('-118.75')
  })
})
