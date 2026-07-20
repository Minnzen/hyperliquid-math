import { describe, expect, it } from 'vitest'
import {
  annualizeFundingRate,
  calculateFundingPayment,
  calculateFundingPremiumIndex,
  calculateFundingRate,
} from '../../../src/funding/index.js'

describe('calculateFundingPremiumIndex', () => {
  it('computes the standard premium index from impact and oracle prices', () => {
    expect(
      calculateFundingPremiumIndex({
        impactBidPrice: '102',
        impactAskPrice: '99',
        oraclePrice: '100',
      }),
    ).toMatchObject({
      value: {
        status: 'ok',
        data: {
          impactPriceDifference: '1',
          premiumIndex: '0.01',
        },
      },
      trace: {
        formulaId: 'hl.funding.premium-index.calculate',
        completion: { status: 'complete' },
        normalizedInputs: {
          impactBidPrice: '102',
          impactAskPrice: '99',
          oraclePrice: '100',
        },
      },
    })
  })

  it('uses both one-sided standard premium terms', () => {
    expect(
      calculateFundingPremiumIndex({
        impactBidPrice: '102',
        impactAskPrice: '98',
        oraclePrice: '100',
      }),
    ).toMatchObject({
      value: {
        status: 'ok',
        data: {
          impactPriceDifference: '0',
          premiumIndex: '0',
        },
      },
    })
  })

  it('caps the hourly rate symmetrically', () => {
    const result = calculateFundingRate({
      averagePremiumIndex: '-1',
      rules: {
        interestRate: '0.0001',
        clampLower: '-0.0005',
        clampUpper: '0.0005',
        baseIntervalHours: 8,
        hourlyCap: '0.04',
      },
    })

    expect(result).toMatchObject({
      value: {
        status: 'ok',
        data: { uncappedHourlyRate: '-0.1249375', hourlyRate: '-0.04', capped: true },
      },
    })
  })
})

describe('calculateFundingRate', () => {
  it('applies the interest clamp before dividing the base interval rate hourly', () => {
    expect(
      calculateFundingRate({
        averagePremiumIndex: '0.01',
        rules: {
          interestRate: '0.0005',
          clampLower: '-0.0005',
          clampUpper: '0.0005',
          baseIntervalHours: 8,
          hourlyCap: '0.04',
        },
      }),
    ).toMatchObject({
      value: {
        status: 'ok',
        data: {
          clampedDifference: '-0.0005',
          baseIntervalRate: '0.0095',
          uncappedHourlyRate: '0.0011875',
          hourlyRate: '0.0011875',
          capped: false,
        },
      },
      trace: {
        formulaId: 'hl.funding.rate.calculate',
        completion: { status: 'complete' },
        normalizedInputs: {
          averagePremiumIndex: '0.01',
          rules: {
            interestRate: '0.0005',
            clampLower: '-0.0005',
            clampUpper: '0.0005',
            baseIntervalHours: 8,
            hourlyCap: '0.04',
          },
        },
      },
    })
  })

  it('returns not-applicable for a flat position', () => {
    expect(
      calculateFundingPayment({
        signedPositionSize: '0',
        oraclePrice: '100',
        fundingRate: '0.01',
      }).value,
    ).toEqual({
      status: 'not-applicable',
      reason: { code: 'zero-position-size', path: '/signedPositionSize' },
    })
  })
})

describe('calculateFundingPayment', () => {
  it('returns a signed account delta for a short position funding receipt', () => {
    expect(
      calculateFundingPayment({
        signedPositionSize: '-3',
        oraclePrice: '100',
        fundingRate: '0.01',
      }),
    ).toMatchObject({
      value: {
        status: 'ok',
        data: {
          payment: '-3',
          accountValueDelta: '3',
        },
      },
      trace: {
        formulaId: 'hl.funding.payment.calculate',
        completion: { status: 'complete' },
        normalizedInputs: {
          signedPositionSize: '-3',
          oraclePrice: '100',
          fundingRate: '0.01',
        },
      },
    })
  })

  it('rejects compound rates whose growth base is not positive', () => {
    expect(
      annualizeFundingRate({
        periodicRate: '-1',
        periodsPerYear: 2,
        convention: 'compound',
      }).value.status,
    ).toBe('invalid-input')
  })
})

describe('annualizeFundingRate', () => {
  it('supports both simple and compound conventions', () => {
    expect(
      annualizeFundingRate({
        periodicRate: '0.05',
        periodsPerYear: 3,
        convention: 'simple',
      }),
    ).toMatchObject({
      value: {
        status: 'ok',
        data: { annualizedRate: '0.15' },
      },
    })

    expect(
      annualizeFundingRate({
        periodicRate: '0.05',
        periodsPerYear: 2,
        convention: 'compound',
      }),
    ).toMatchObject({
      value: {
        status: 'ok',
        data: { annualizedRate: '0.1025' },
      },
    })
  })
})
