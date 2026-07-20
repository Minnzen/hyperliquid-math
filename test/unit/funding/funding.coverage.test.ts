import { describe, expect, it } from 'vitest'
import {
  annualizeFundingRate,
  calculateFundingPayment,
  calculateFundingPremiumIndex,
  calculateFundingRate,
} from '../../../src/funding/index.js'
import { invalidReason } from '../../../src/funding/validation.js'
import type { MathResult } from '../../../src/model/index.js'

function expectInvalid(result: MathResult<unknown>, code: string, path: string) {
  expect(result.value).toMatchObject({
    status: 'invalid-input',
    issues: [{ code, path }],
  })
  expect(result.trace.completion).toEqual({
    status: 'incomplete',
    reason: { code, path },
  })
  expect(result.trace.normalizedInputs).toEqual({})
}

const fundingRules = {
  interestRate: '0.0005',
  clampLower: '-0.0005',
  clampUpper: '0.0005',
  baseIntervalHours: 8,
  hourlyCap: '0.04',
}

describe('calculateFundingPremiumIndex validation coverage', () => {
  it('rejects a non-plain root input without throwing', () => {
    expectInvalid(calculateFundingPremiumIndex(null as never), 'invalid-input-shape', '')
  })

  it('rejects non-positive impact bid prices', () => {
    expectInvalid(
      calculateFundingPremiumIndex({
        impactBidPrice: '0',
        impactAskPrice: '99',
        oraclePrice: '100',
      }),
      'non-positive-decimal',
      '/impactBidPrice',
    )
  })

  it('rejects non-positive impact ask prices', () => {
    expectInvalid(
      calculateFundingPremiumIndex({
        impactBidPrice: '101',
        impactAskPrice: '-1',
        oraclePrice: '100',
      }),
      'non-positive-decimal',
      '/impactAskPrice',
    )
  })

  it('rejects non-positive oracle prices', () => {
    expectInvalid(
      calculateFundingPremiumIndex({
        impactBidPrice: '101',
        impactAskPrice: '99',
        oraclePrice: '0',
      }),
      'non-positive-decimal',
      '/oraclePrice',
    )
  })

  it('computes a bid-only positive premium when the ask is above oracle', () => {
    expect(
      calculateFundingPremiumIndex({
        impactBidPrice: '105',
        impactAskPrice: '101',
        oraclePrice: '100',
      }).value,
    ).toMatchObject({
      status: 'ok',
      data: {
        bidPremium: '5',
        askDiscount: '0',
        impactPriceDifference: '5',
        premiumIndex: '0.05',
      },
    })
  })

  it('computes an ask-only negative premium when the bid is below oracle', () => {
    expect(
      calculateFundingPremiumIndex({
        impactBidPrice: '99',
        impactAskPrice: '95',
        oraclePrice: '100',
      }).value,
    ).toMatchObject({
      status: 'ok',
      data: {
        bidPremium: '0',
        askDiscount: '5',
        impactPriceDifference: '-5',
        premiumIndex: '-0.05',
      },
    })
  })
})

describe('calculateFundingRate validation coverage', () => {
  it('rejects a non-plain root input without throwing', () => {
    expectInvalid(calculateFundingRate(null as never), 'invalid-input-shape', '')
  })

  it('rejects malformed average premium strings', () => {
    expectInvalid(
      calculateFundingRate({ averagePremiumIndex: '1e-3', rules: fundingRules }),
      'invalid-decimal-string',
      '/averagePremiumIndex',
    )
  })

  it('rejects a non-plain rules object', () => {
    expectInvalid(
      calculateFundingRate({ averagePremiumIndex: '0', rules: [] as never }),
      'invalid-input-shape',
      '/rules',
    )
  })

  it('rejects malformed interest rate strings', () => {
    expectInvalid(
      calculateFundingRate({
        averagePremiumIndex: '0',
        rules: { ...fundingRules, interestRate: 'NaN' },
      }),
      'invalid-decimal-string',
      '/rules/interestRate',
    )
  })

  it('rejects malformed lower clamp strings', () => {
    expectInvalid(
      calculateFundingRate({
        averagePremiumIndex: '0',
        rules: { ...fundingRules, clampLower: 'Infinity' },
      }),
      'invalid-decimal-string',
      '/rules/clampLower',
    )
  })

  it('rejects malformed upper clamp strings', () => {
    expectInvalid(
      calculateFundingRate({
        averagePremiumIndex: '0',
        rules: { ...fundingRules, clampUpper: 'Infinity' },
      }),
      'invalid-decimal-string',
      '/rules/clampUpper',
    )
  })

  it('rejects positive lower clamps', () => {
    expectInvalid(
      calculateFundingRate({
        averagePremiumIndex: '0',
        rules: { ...fundingRules, clampLower: '0.0001' },
      }),
      'invalid-funding-rate-rules',
      '/rules/clampLower',
    )
  })

  it('rejects negative upper clamps', () => {
    expectInvalid(
      calculateFundingRate({
        averagePremiumIndex: '0',
        rules: { ...fundingRules, clampUpper: '-0.0001' },
      }),
      'invalid-funding-rate-rules',
      '/rules/clampUpper',
    )
  })

  it('rejects non-integer base interval hours', () => {
    expectInvalid(
      calculateFundingRate({
        averagePremiumIndex: '0',
        rules: { ...fundingRules, baseIntervalHours: 1.5 },
      }),
      'invalid-base-interval-hours',
      '/rules/baseIntervalHours',
    )
  })

  it('rejects non-number base interval hours', () => {
    expectInvalid(
      calculateFundingRate({
        averagePremiumIndex: '0',
        rules: { ...fundingRules, baseIntervalHours: '8' as never },
      }),
      'invalid-base-interval-hours',
      '/rules/baseIntervalHours',
    )
  })

  it('rejects non-safe base interval hours', () => {
    expectInvalid(
      calculateFundingRate({
        averagePremiumIndex: '0',
        rules: { ...fundingRules, baseIntervalHours: Number.MAX_SAFE_INTEGER + 1 },
      }),
      'invalid-base-interval-hours',
      '/rules/baseIntervalHours',
    )
  })

  it('rejects non-positive base interval hours', () => {
    expectInvalid(
      calculateFundingRate({
        averagePremiumIndex: '0',
        rules: { ...fundingRules, baseIntervalHours: 0 },
      }),
      'invalid-base-interval-hours',
      '/rules/baseIntervalHours',
    )
  })

  it('rejects base interval hours above one day', () => {
    expectInvalid(
      calculateFundingRate({
        averagePremiumIndex: '0',
        rules: { ...fundingRules, baseIntervalHours: 25 },
      }),
      'invalid-base-interval-hours',
      '/rules/baseIntervalHours',
    )
  })

  it('rejects negative hourly caps', () => {
    expectInvalid(
      calculateFundingRate({
        averagePremiumIndex: '0',
        rules: { ...fundingRules, hourlyCap: '-0.01' },
      }),
      'negative-decimal',
      '/rules/hourlyCap',
    )
  })

  it('caps positive hourly rates at the configured cap', () => {
    expect(
      calculateFundingRate({
        averagePremiumIndex: '1',
        rules: fundingRules,
      }).value,
    ).toMatchObject({
      status: 'ok',
      data: {
        uncappedHourlyRate: '0.1249375',
        hourlyRate: '0.04',
        capped: true,
      },
    })
  })
})

describe('calculateFundingPayment validation coverage', () => {
  it('rejects a non-plain root input without throwing', () => {
    expectInvalid(calculateFundingPayment(null as never), 'invalid-input-shape', '')
  })

  it('rejects malformed signed position sizes', () => {
    expectInvalid(
      calculateFundingPayment({
        signedPositionSize: '1e-3',
        oraclePrice: '100',
        fundingRate: '0.01',
      }),
      'invalid-decimal-string',
      '/signedPositionSize',
    )
  })

  it('rejects non-positive oracle prices', () => {
    expectInvalid(
      calculateFundingPayment({
        signedPositionSize: '1',
        oraclePrice: '-100',
        fundingRate: '0.01',
      }),
      'non-positive-decimal',
      '/oraclePrice',
    )
  })

  it('rejects malformed funding rates', () => {
    expectInvalid(
      calculateFundingPayment({
        signedPositionSize: '1',
        oraclePrice: '100',
        fundingRate: '1e-2',
      }),
      'invalid-decimal-string',
      '/fundingRate',
    )
  })
})

describe('annualizeFundingRate validation coverage', () => {
  it('rejects a non-plain root input without throwing', () => {
    expectInvalid(annualizeFundingRate(null as never), 'invalid-input-shape', '')
  })

  it('rejects malformed periodic rates', () => {
    expectInvalid(
      annualizeFundingRate({
        periodicRate: '1e-3',
        periodsPerYear: 8760,
        convention: 'simple',
      }),
      'invalid-decimal-string',
      '/periodicRate',
    )
  })

  it('rejects non-positive period counts', () => {
    expectInvalid(
      annualizeFundingRate({
        periodicRate: '0.01',
        periodsPerYear: 0,
        convention: 'simple',
      }),
      'invalid-periods-per-year',
      '/periodsPerYear',
    )
  })

  it('rejects non-number period counts', () => {
    expectInvalid(
      annualizeFundingRate({
        periodicRate: '0.01',
        periodsPerYear: '8760' as never,
        convention: 'simple',
      }),
      'invalid-periods-per-year',
      '/periodsPerYear',
    )
  })

  it('rejects non-safe period counts', () => {
    expectInvalid(
      annualizeFundingRate({
        periodicRate: '0.01',
        periodsPerYear: Number.MAX_SAFE_INTEGER + 1,
        convention: 'simple',
      }),
      'invalid-periods-per-year',
      '/periodsPerYear',
    )
  })

  it('rejects non-integer period counts', () => {
    expectInvalid(
      annualizeFundingRate({
        periodicRate: '0.01',
        periodsPerYear: 1.5,
        convention: 'simple',
      }),
      'invalid-periods-per-year',
      '/periodsPerYear',
    )
  })

  it('rejects period counts above the analytical cap', () => {
    expectInvalid(
      annualizeFundingRate({
        periodicRate: '0.01',
        periodsPerYear: 100001,
        convention: 'simple',
      }),
      'invalid-periods-per-year',
      '/periodsPerYear',
    )
  })

  it('rejects unsupported annualization conventions', () => {
    expectInvalid(
      annualizeFundingRate({
        periodicRate: '0.01',
        periodsPerYear: 8760,
        convention: 'geometric',
      } as never),
      'invalid-annualization-convention',
      '/convention',
    )
  })

  it('returns a normalized incomplete trace for invalid compound growth bases', () => {
    const result = annualizeFundingRate({
      periodicRate: '-1',
      periodsPerYear: 2,
      convention: 'compound',
    })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-compound-growth-base', path: '/periodicRate' }],
    })
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'invalid-compound-growth-base', path: '/periodicRate' },
    })
    expect(result.trace.normalizedInputs).toEqual({
      periodicRate: '-1',
      periodsPerYear: 2,
      convention: 'compound',
    })
  })
})

describe('funding validation helpers', () => {
  it('uses an empty reason path when an issue has no path', () => {
    expect(invalidReason({ code: 'missing-path' })).toEqual({ code: 'missing-path', path: '' })
  })
})
