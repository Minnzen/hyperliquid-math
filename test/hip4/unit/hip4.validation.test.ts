import { describe, expect, it } from 'vitest'
import {
  calculateOutcomeDualPrice,
  calculateOutcomeSettlement,
  evaluateRecurringOutcome,
} from '../../../src/hip4/index.js'

function expectInvalid(result: { value: { status: string } }) {
  expect(result.value.status).toBe('invalid-input')
}

describe('HIP-4 validation boundaries', () => {
  it('enforces the exact dual-price input shape', () => {
    expectInvalid(calculateOutcomeDualPrice({ price: '0.5', extra: true } as never))
    expectInvalid(calculateOutcomeDualPrice(Object.create(null) as never))
  })

  it.each([
    {
      tokenSide: 'yes',
      settleFraction: '-0.1',
      size: '1',
      entryPrice: '0.5',
    },
    {
      tokenSide: 'yes',
      settleFraction: '1.1',
      size: '1',
      entryPrice: '0.5',
    },
    {
      tokenSide: 'yes',
      settleFraction: '0.5',
      size: '-1',
      entryPrice: '0.5',
    },
    {
      tokenSide: 'yes',
      settleFraction: '0.5',
      size: '1',
      entryPrice: '1.1',
    },
  ])('rejects invalid settlement bounds for %j', (input) => {
    expectInvalid(calculateOutcomeSettlement(input as never))
  })

  it.each([
    {
      class: 'priceBinary',
      markPrice0: '0',
      t0: 0,
      markPrice1: '2',
      t1: 2,
      settlementTime: 1,
      targetPrice: '1',
    },
    {
      class: 'priceBinary',
      markPrice0: '1',
      t0: 0,
      markPrice1: '2',
      t1: 2,
      settlementTime: 3,
      targetPrice: '1',
    },
    {
      class: 'priceBinary',
      markPrice0: '1',
      t0: 0.5,
      markPrice1: '2',
      t1: 2,
      settlementTime: 1,
      targetPrice: '1',
    },
    {
      class: 'priceBucket',
      markPrice0: '1',
      t0: 0,
      markPrice1: '2',
      t1: 2,
      settlementTime: 1,
      priceThresholds: ['1', '1'],
    },
    {
      class: 'priceBucket',
      markPrice0: '1',
      t0: 0,
      markPrice1: '2',
      t1: 2,
      settlementTime: 1,
      priceThresholds: ['1', '2', '3'],
    },
  ])('rejects invalid recurring boundaries for %j', (input) => {
    expectInvalid(evaluateRecurringOutcome(input as never))
  })

  it('rejects a sparse bucket threshold tuple', () => {
    const priceThresholds = new Array(2)
    priceThresholds[1] = '2'

    expectInvalid(
      evaluateRecurringOutcome({
        class: 'priceBucket',
        markPrice0: '1',
        t0: 0,
        markPrice1: '2',
        t1: 2,
        settlementTime: 1,
        priceThresholds,
      } as never),
    )
  })
})
