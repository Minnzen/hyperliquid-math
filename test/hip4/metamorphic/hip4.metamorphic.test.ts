import { describe, expect, it } from 'vitest'
import { Decimal40 } from '../../../src/core/decimal.js'
import {
  calculateOutcomeDualPrice,
  calculateOutcomeSettlement,
  evaluateRecurringOutcome,
} from '../../../src/hip4/index.js'

describe('HIP-4 directed mutation-kill vectors', () => {
  it('kills a same-price dual mutant with an asymmetric complement', () => {
    const result = calculateOutcomeDualPrice({ price: '0.17' })

    expect(result.value).toEqual({ status: 'ok', data: { dualPrice: '0.83' } })
  })

  it('keeps settlement value and gross PnL linear in size', () => {
    const small = calculateOutcomeSettlement({
      tokenSide: 'no',
      settleFraction: '0.25',
      size: '2',
      entryPrice: '0.4',
    })
    const large = calculateOutcomeSettlement({
      tokenSide: 'no',
      settleFraction: '0.25',
      size: '6',
      entryPrice: '0.4',
    })

    expect(small.value).toEqual({
      status: 'ok',
      data: {
        payoutFraction: '0.75',
        settlementValue: '1.5',
        entryNotional: '0.8',
        grossPnl: '0.7',
      },
    })
    expect(large.value).toEqual({
      status: 'ok',
      data: {
        payoutFraction: '0.75',
        settlementValue: '4.5',
        entryNotional: '2.4',
        grossPnl: '2.1',
      },
    })
  })

  it('keeps interpolation invariant when all timestamps shift equally', () => {
    const base = evaluateRecurringOutcome({
      class: 'priceBinary',
      markPrice0: '10',
      t0: 20,
      markPrice1: '18',
      t1: 60,
      settlementTime: 35,
      targetPrice: '12',
    })
    const shifted = evaluateRecurringOutcome({
      class: 'priceBinary',
      markPrice0: '10',
      t0: 1020,
      markPrice1: '18',
      t1: 1060,
      settlementTime: 1035,
      targetPrice: '12',
    })

    expect(base.value).toEqual({
      status: 'ok',
      data: {
        class: 'priceBinary',
        interpolatedMarkPrice: '13',
        settlesTo: 'yes',
        settleFraction: '1',
      },
    })
    expect(shifted.value).toEqual(base.value)
  })

  it('preserves classification under an equal affine price shift', () => {
    const base = evaluateRecurringOutcome({
      class: 'priceBinary',
      markPrice0: '10',
      t0: 0,
      markPrice1: '14',
      t1: 4,
      settlementTime: 1,
      targetPrice: '12',
    })
    const shifted = evaluateRecurringOutcome({
      class: 'priceBinary',
      markPrice0: '110',
      t0: 0,
      markPrice1: '114',
      t1: 4,
      settlementTime: 1,
      targetPrice: '112',
    })

    expect(base.value.status).toBe('ok')
    expect(shifted.value.status).toBe('ok')
    if (base.value.status !== 'ok' || shifted.value.status !== 'ok') return
    expect(base.value.data.settlesTo).toBe('no')
    expect(shifted.value.data.settlesTo).toBe(base.value.data.settlesTo)
    expect(
      new Decimal40(shifted.value.data.interpolatedMarkPrice)
        .minus(base.value.data.interpolatedMarkPrice)
        .toFixed(),
    ).toBe('100')
  })

  it('kills lower- and upper-threshold strictness mutants', () => {
    const atLower = evaluateRecurringOutcome({
      class: 'priceBucket',
      markPrice0: '10',
      t0: 0,
      markPrice1: '10',
      t1: 1,
      settlementTime: 1,
      priceThresholds: ['10', '20'],
    })
    const atUpper = evaluateRecurringOutcome({
      class: 'priceBucket',
      markPrice0: '20',
      t0: 0,
      markPrice1: '20',
      t1: 1,
      settlementTime: 1,
      priceThresholds: ['10', '20'],
    })

    expect(atLower.value).toMatchObject({
      status: 'ok',
      data: { settledBucket: 1, settleFractions: ['0', '1', '0'] },
    })
    expect(atUpper.value).toMatchObject({
      status: 'ok',
      data: { settledBucket: 2, settleFractions: ['0', '0', '1'] },
    })
  })
})
