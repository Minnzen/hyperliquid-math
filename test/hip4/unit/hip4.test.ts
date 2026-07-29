import { describe, expect, it } from 'vitest'
import {
  calculateOutcomeDualPrice,
  calculateOutcomeSettlement,
  evaluateRecurringOutcome,
} from '../../../src/hip4/index.js'

describe('calculateOutcomeDualPrice', () => {
  it.each([
    ['0', '1'],
    ['1', '0'],
    ['0.37', '0.63'],
    ['0.123456789012345678901234567890123456789', '0.876543210987654321098765432109876543211'],
  ])('derives the documented dual of %s', (price, dualPrice) => {
    const result = calculateOutcomeDualPrice({ price })

    expect(result.value).toEqual({ status: 'ok', data: { dualPrice } })
    expect(result.trace).toMatchObject({
      formulaId: 'hl.hip4.dual-price.calculate',
      formulaVersion: 1,
      authority: 'local-exact',
      maturity: 'experimental',
      completion: { status: 'complete' },
      normalizedInputs: { price },
      sourceRefs: expect.arrayContaining([
        'HLM.SPEC.HIP4.DUAL_PRICE.V1',
        'HL.DOC.HIP4.2026-07-30',
        'DECIMALJS.10.6.0',
      ]),
    })
  })

  it.each(['-0.1', '1.1', '1e-1', '+0.1', ''])('rejects out-of-contract price %j', (price) => {
    expect(calculateOutcomeDualPrice({ price }).value.status).toBe('invalid-input')
  })
})

describe('calculateOutcomeSettlement', () => {
  it('projects the Yes payout from a caller-supplied settle fraction', () => {
    const result = calculateOutcomeSettlement({
      tokenSide: 'yes',
      settleFraction: '0.8',
      size: '10',
      entryPrice: '0.37',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        payoutFraction: '0.8',
        settlementValue: '8',
        entryNotional: '3.7',
        grossPnl: '4.3',
      },
    })
  })

  it('projects the complementary No payout without mapping a numeric asset side', () => {
    const result = calculateOutcomeSettlement({
      tokenSide: 'no',
      settleFraction: '0.8',
      size: '10',
      entryPrice: '0.63',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        payoutFraction: '0.2',
        settlementValue: '2',
        entryNotional: '6.3',
        grossPnl: '-4.3',
      },
    })
    expect(result.trace).toMatchObject({
      formulaId: 'hl.hip4.settlement.calculate',
      formulaVersion: 1,
      authority: 'local-exact',
      maturity: 'experimental',
      sourceRefs: expect.arrayContaining([
        'HLM.SPEC.HIP4.SETTLEMENT.V1',
        'HL.DOC.HIP4.2026-07-30',
        'DECIMALJS.10.6.0',
      ]),
    })
  })

  it('returns not-applicable for zero size', () => {
    const result = calculateOutcomeSettlement({
      tokenSide: 'yes',
      settleFraction: '1',
      size: '0',
      entryPrice: '0.37',
    })

    expect(result.value).toEqual({
      status: 'not-applicable',
      reason: { code: 'zero-outcome-size', path: '/size' },
    })
  })

  it('rejects numeric identifier sides instead of implicitly mapping them', () => {
    const result = calculateOutcomeSettlement({
      tokenSide: 0,
      settleFraction: '1',
      size: '1',
      entryPrice: '0.2',
    } as never)

    expect(result.value.status).toBe('invalid-input')
  })
})

describe('evaluateRecurringOutcome', () => {
  it('settles binary YES at exact equality', () => {
    const result = evaluateRecurringOutcome({
      class: 'priceBinary',
      markPrice0: '100',
      t0: 1000,
      markPrice1: '110',
      t1: 2000,
      settlementTime: 1500,
      targetPrice: '105',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        class: 'priceBinary',
        interpolatedMarkPrice: '105',
        settlesTo: 'yes',
        settleFraction: '1',
      },
    })
  })

  it('rounds a non-terminating interpolation to Decimal40 precision', () => {
    const result = evaluateRecurringOutcome({
      class: 'priceBinary',
      markPrice0: '1',
      t0: 0,
      markPrice1: '2',
      t1: 3,
      settlementTime: 1,
      targetPrice: '1.4',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        class: 'priceBinary',
        interpolatedMarkPrice: '1.333333333333333333333333333333333333333',
        settlesTo: 'no',
        settleFraction: '0',
      },
    })
  })

  it.each([
    ['104.9', 0, ['1', '0', '0']],
    ['105', 1, ['0', '1', '0']],
    ['107', 1, ['0', '1', '0']],
    ['110', 2, ['0', '0', '1']],
    ['110.1', 2, ['0', '0', '1']],
  ] as const)(
    'assigns interpolated price %s to bucket %i with upward equality boundaries',
    (markPrice, settledBucket, settleFractions) => {
      const result = evaluateRecurringOutcome({
        class: 'priceBucket',
        markPrice0: markPrice,
        t0: 0,
        markPrice1: markPrice,
        t1: 10,
        settlementTime: 5,
        priceThresholds: ['105', '110'],
      })

      expect(result.value).toEqual({
        status: 'ok',
        data: {
          class: 'priceBucket',
          interpolatedMarkPrice: markPrice,
          settledBucket,
          settleFractions,
        },
      })
      expect(result.trace).toMatchObject({
        formulaId: 'hl.hip4.recurring-outcome.evaluate',
        formulaVersion: 1,
        authority: 'local-exact',
        maturity: 'experimental',
        sourceRefs: expect.arrayContaining([
          'HLM.SPEC.HIP4.RECURRING_OUTCOME.V1',
          'HL.DOC.CONTRACT_SPECIFICATIONS.2026-07-30',
          'DECIMALJS.10.6.0',
        ]),
      })
    },
  )

  it.each([
    {
      class: 'priceBinary',
      markPrice0: '100',
      t0: 1,
      markPrice1: '110',
      t1: 1,
      settlementTime: 1,
      targetPrice: '105',
    },
    {
      class: 'priceBucket',
      markPrice0: '100',
      t0: 0,
      markPrice1: '110',
      t1: 10,
      settlementTime: 5,
      priceThresholds: ['110', '105'],
    },
    {
      class: 'priceBucket',
      markPrice0: '100',
      t0: 0,
      markPrice1: '110',
      t1: 10,
      settlementTime: 5,
      priceThresholds: ['105'],
    },
  ])('rejects invalid recurring input %j', (input) => {
    expect(evaluateRecurringOutcome(input as never).value.status).toBe('invalid-input')
  })
})
