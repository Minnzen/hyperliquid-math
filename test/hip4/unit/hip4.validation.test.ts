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

  it.each([
    Object.create({}),
    Object.assign(Object.create(null), { class: 'other' }),
    { class: 'other' },
  ])('rejects unsupported recurring input shapes and classes', (input) => {
    expectInvalid(evaluateRecurringOutcome(input as never))
  })

  it('rejects recurring class accessors and non-enumerable class fields', () => {
    const accessor = {}
    Object.defineProperty(accessor, 'class', {
      enumerable: true,
      get() {
        return 'priceBinary'
      },
    })
    const nonEnumerable = {}
    Object.defineProperty(nonEnumerable, 'class', {
      enumerable: false,
      value: 'priceBinary',
    })

    expectInvalid(evaluateRecurringOutcome(accessor as never))
    expectInvalid(evaluateRecurringOutcome(nonEnumerable as never))
  })

  it('rejects uninspectable recurring inputs without throwing', () => {
    const { proxy, revoke } = Proxy.revocable({ class: 'priceBinary' }, {})
    revoke()

    expectInvalid(evaluateRecurringOutcome(proxy as never))
  })

  const binary = {
    class: 'priceBinary',
    markPrice0: '1',
    t0: 0,
    markPrice1: '2',
    t1: 2,
    settlementTime: 1,
    targetPrice: '1.5',
  } as const

  it.each([
    { ...binary, extra: true },
    { ...binary, markPrice1: '0' },
    { ...binary, t1: 1.5 },
    { ...binary, settlementTime: 1.5 },
    { ...binary, targetPrice: '0' },
  ])('rejects every remaining binary normalization boundary for %j', (input) => {
    expectInvalid(evaluateRecurringOutcome(input as never))
  })

  const bucket = {
    class: 'priceBucket',
    markPrice0: '1',
    t0: 0,
    markPrice1: '2',
    t1: 2,
    settlementTime: 1,
    priceThresholds: ['1', '2'],
  } as const

  it.each([
    { ...bucket, extra: true },
    { ...bucket, markPrice0: '0' },
    { ...bucket, priceThresholds: ['0', '2'] },
    { ...bucket, priceThresholds: ['1', '0'] },
  ])('rejects every remaining bucket normalization boundary for %j', (input) => {
    expectInvalid(evaluateRecurringOutcome(input as never))
  })
})
