import { describe, expect, it } from 'vitest'
import {
  buildPerpScaleLadder,
  calculatePerpMaxOrderSize,
  calculatePerpSlippagePrice,
  calculatePerpTwapExecutionTarget,
  classifyPerpTrigger,
  derivePerpTriggerPrice,
  evaluatePerpReduceOnly,
  validatePerpOrder,
} from '../../../src/orders/index.js'

type PublicOrderFunction =
  | typeof validatePerpOrder
  | typeof calculatePerpMaxOrderSize
  | typeof evaluatePerpReduceOnly
  | typeof calculatePerpSlippagePrice
  | typeof classifyPerpTrigger
  | typeof derivePerpTriggerPrice
  | typeof buildPerpScaleLadder
  | typeof calculatePerpTwapExecutionTarget

function expectInvalid(
  fn: PublicOrderFunction,
  input: unknown,
  expected: { code: string; path: string },
): void {
  const result = fn(input as never)
  expect(result.value.status).toBe('invalid-input')
  if (result.value.status !== 'invalid-input') return
  expect(result.value.issues).toEqual([
    expect.objectContaining({ code: expected.code, path: expected.path }),
  ])
}

const validOrder = {
  price: '100',
  size: '1',
  szDecimals: 2,
  minimumNotional: { kind: 'available', value: '10' },
  priceBand: { kind: 'available', value: { lowerBound: '90', upperBound: '110' } },
} as const

const validMaxSize = {
  availableCollateral: '100',
  leverage: '5',
  referencePrice: '100',
  currentSignedSize: '0',
  side: 'buy',
  reduceOnly: false,
  szDecimals: 2,
  orderValueLimit: { kind: 'available', value: '1000' },
} as const

const validReduceOnly = {
  currentSignedSize: '1',
  side: 'sell',
  requestedSize: '0.5',
} as const

const validSlippage = {
  side: 'buy',
  referencePrice: '100',
  slippageBps: '10',
  szDecimals: 2,
} as const

const validTrigger = {
  positionSide: 'long',
  orderSide: 'sell',
  markPrice: '100',
  triggerPrice: '110',
} as const

const validDerive = {
  position: { kind: 'open', signedSize: '1', entryPrice: '100' },
  target: { kind: 'pnl', amount: '10' },
  cumulativeCost: '0',
} as const

const validScale = {
  side: 'buy',
  lowerPrice: '90',
  upperPrice: '110',
  totalSize: '1',
  legCount: 3,
  distribution: 'linear',
  szDecimals: 2,
} as const

const validTwap = {
  totalSize: '1',
  durationMs: 30_000,
  elapsedMs: 15_000,
} as const

describe('orders validation defensive coverage', () => {
  it.each([
    ['non-object order root', validatePerpOrder, null, 'invalid-input-shape', ''],
    [
      'order root with an extra field',
      validatePerpOrder,
      { ...validOrder, extra: true },
      'invalid-input-shape',
      '',
    ],
    [
      'non-positive order price',
      validatePerpOrder,
      { ...validOrder, price: '0' },
      'non-positive-decimal',
      '/price',
    ],
    [
      'non-positive order size',
      validatePerpOrder,
      { ...validOrder, size: '0' },
      'non-positive-decimal',
      '/size',
    ],
    [
      'out-of-range order szDecimals',
      validatePerpOrder,
      { ...validOrder, szDecimals: 7 },
      'invalid-sz-decimals',
      '/szDecimals',
    ],
    [
      'available rule with unavailable kind',
      validatePerpOrder,
      { ...validOrder, minimumNotional: { kind: 'not-supported', value: '10' } },
      'invalid-rule-kind',
      '/minimumNotional/kind',
    ],
    [
      'available minimum-notional rule with invalid decimal',
      validatePerpOrder,
      { ...validOrder, minimumNotional: { kind: 'available', value: '0' } },
      'non-positive-decimal',
      '/minimumNotional/value',
    ],
    [
      'unavailable rule with unsupported kind',
      validatePerpOrder,
      { ...validOrder, minimumNotional: { kind: 'pending', reason: { code: 'pending-rule' } } },
      'invalid-rule-kind',
      '/minimumNotional/kind',
    ],
    [
      'unavailable rule with invalid reason details',
      validatePerpOrder,
      {
        ...validOrder,
        minimumNotional: {
          kind: 'not-supported',
          reason: { code: 'bad-details', details: [] },
        },
      },
      'invalid-input-shape',
      '/minimumNotional/reason/details',
    ],
    [
      'unavailable rule with fractional numeric reason details',
      validatePerpOrder,
      {
        ...validOrder,
        minimumNotional: {
          kind: 'not-supported',
          reason: { code: 'bad-details', details: { amount: 1.23 } },
        },
      },
      'invalid-input-shape',
      '/minimumNotional/reason/details/amount',
    ],
    [
      'unavailable rule with unsafe numeric reason details',
      validatePerpOrder,
      {
        ...validOrder,
        minimumNotional: {
          kind: 'not-supported',
          reason: {
            code: 'bad-details',
            details: { count: Number.MAX_SAFE_INTEGER + 1 },
          },
        },
      },
      'invalid-input-shape',
      '/minimumNotional/reason/details/count',
    ],
    [
      'not-applicable rule with invalid reason',
      validatePerpOrder,
      {
        ...validOrder,
        minimumNotional: {
          kind: 'not-applicable',
          reason: { code: 'bad-not-applicable', sourceRefs: [1] },
        },
      },
      'invalid-input-shape',
      '/minimumNotional/reason/sourceRefs/0',
    ],
    [
      'unavailable rule with invalid sourceRefs',
      validatePerpOrder,
      {
        ...validOrder,
        minimumNotional: {
          kind: 'not-supported',
          reason: { code: 'bad-source-refs', sourceRefs: ['HL.TEST', 1] },
        },
      },
      'invalid-input-shape',
      '/minimumNotional/reason/sourceRefs/1',
    ],
    [
      'price band with missing field',
      validatePerpOrder,
      { ...validOrder, priceBand: { kind: 'available', value: { lowerBound: '90' } } },
      'invalid-input-shape',
      '/priceBand/value',
    ],
    [
      'price band with invalid lower bound',
      validatePerpOrder,
      {
        ...validOrder,
        priceBand: { kind: 'available', value: { lowerBound: '0', upperBound: '110' } },
      },
      'non-positive-decimal',
      '/priceBand/value/lowerBound',
    ],
    [
      'price band with invalid upper bound',
      validatePerpOrder,
      {
        ...validOrder,
        priceBand: { kind: 'available', value: { lowerBound: '90', upperBound: '0' } },
      },
      'non-positive-decimal',
      '/priceBand/value/upperBound',
    ],
    [
      'inverted price band',
      validatePerpOrder,
      {
        ...validOrder,
        priceBand: { kind: 'available', value: { lowerBound: '111', upperBound: '110' } },
      },
      'invalid-price-band',
      '/priceBand/value',
    ],
    [
      'invalid max-size available collateral',
      calculatePerpMaxOrderSize,
      { ...validMaxSize, availableCollateral: '-1' },
      'negative-decimal',
      '/availableCollateral',
    ],
    [
      'invalid max-size leverage',
      calculatePerpMaxOrderSize,
      { ...validMaxSize, leverage: '0' },
      'non-positive-decimal',
      '/leverage',
    ],
    [
      'invalid max-size reference price',
      calculatePerpMaxOrderSize,
      { ...validMaxSize, referencePrice: '0' },
      'non-positive-decimal',
      '/referencePrice',
    ],
    [
      'invalid max-size signed size',
      calculatePerpMaxOrderSize,
      { ...validMaxSize, currentSignedSize: 'abc' },
      'invalid-decimal-string',
      '/currentSignedSize',
    ],
    [
      'invalid max-size side',
      calculatePerpMaxOrderSize,
      { ...validMaxSize, side: 'hold' },
      'invalid-order-side',
      '/side',
    ],
    [
      'invalid max-size reduceOnly',
      calculatePerpMaxOrderSize,
      { ...validMaxSize, reduceOnly: 'false' },
      'invalid-reduce-only',
      '/reduceOnly',
    ],
    [
      'invalid max-size szDecimals',
      calculatePerpMaxOrderSize,
      { ...validMaxSize, szDecimals: -1 },
      'invalid-sz-decimals',
      '/szDecimals',
    ],
    [
      'invalid max-size order-value rule',
      calculatePerpMaxOrderSize,
      { ...validMaxSize, orderValueLimit: { kind: 'available', value: '0' } },
      'non-positive-decimal',
      '/orderValueLimit/value',
    ],
    [
      'invalid reduce-only signed size',
      evaluatePerpReduceOnly,
      { ...validReduceOnly, currentSignedSize: 'NaN' },
      'invalid-decimal-string',
      '/currentSignedSize',
    ],
    [
      'invalid reduce-only side',
      evaluatePerpReduceOnly,
      { ...validReduceOnly, side: 'hold' },
      'invalid-order-side',
      '/side',
    ],
    [
      'invalid reduce-only requested size',
      evaluatePerpReduceOnly,
      { ...validReduceOnly, requestedSize: '0' },
      'non-positive-decimal',
      '/requestedSize',
    ],
    [
      'invalid slippage side',
      calculatePerpSlippagePrice,
      { ...validSlippage, side: 'hold' },
      'invalid-order-side',
      '/side',
    ],
    [
      'invalid slippage reference price',
      calculatePerpSlippagePrice,
      { ...validSlippage, referencePrice: '0' },
      'non-positive-decimal',
      '/referencePrice',
    ],
    [
      'invalid slippage bps',
      calculatePerpSlippagePrice,
      { ...validSlippage, slippageBps: '-1' },
      'negative-decimal',
      '/slippageBps',
    ],
    [
      'invalid slippage szDecimals',
      calculatePerpSlippagePrice,
      { ...validSlippage, szDecimals: 1.5 },
      'invalid-sz-decimals',
      '/szDecimals',
    ],
    [
      'invalid trigger position side',
      classifyPerpTrigger,
      { ...validTrigger, positionSide: 'flat' },
      'invalid-position-side',
      '/positionSide',
    ],
    [
      'invalid trigger order side',
      classifyPerpTrigger,
      { ...validTrigger, orderSide: 'hold' },
      'invalid-order-side',
      '/orderSide',
    ],
    [
      'invalid trigger mark price',
      classifyPerpTrigger,
      { ...validTrigger, markPrice: '0' },
      'non-positive-decimal',
      '/markPrice',
    ],
    [
      'invalid trigger trigger price',
      classifyPerpTrigger,
      { ...validTrigger, triggerPrice: '0' },
      'non-positive-decimal',
      '/triggerPrice',
    ],
    [
      'invalid derive position shape',
      derivePerpTriggerPrice,
      { ...validDerive, position: { kind: 'open', signedSize: '1' } },
      'invalid-input-shape',
      '/position',
    ],
    [
      'invalid derive position kind',
      derivePerpTriggerPrice,
      { ...validDerive, position: { kind: 'flat', signedSize: '1', entryPrice: '100' } },
      'invalid-position-kind',
      '/position/kind',
    ],
    [
      'invalid derive signed size decimal',
      derivePerpTriggerPrice,
      { ...validDerive, position: { kind: 'open', signedSize: 'abc', entryPrice: '100' } },
      'invalid-decimal-string',
      '/position/signedSize',
    ],
    [
      'invalid derive zero signed size',
      derivePerpTriggerPrice,
      { ...validDerive, position: { kind: 'open', signedSize: '0', entryPrice: '100' } },
      'invalid-position-size',
      '/position/signedSize',
    ],
    [
      'invalid derive entry price',
      derivePerpTriggerPrice,
      { ...validDerive, position: { kind: 'open', signedSize: '1', entryPrice: '0' } },
      'non-positive-decimal',
      '/position/entryPrice',
    ],
    [
      'invalid derive target shape',
      derivePerpTriggerPrice,
      { ...validDerive, target: { kind: 'pnl' } },
      'invalid-input-shape',
      '/target',
    ],
    [
      'invalid derive pnl target kind',
      derivePerpTriggerPrice,
      { ...validDerive, target: { kind: 'roe', amount: '1' } },
      'invalid-target-kind',
      '/target/kind',
    ],
    [
      'invalid derive pnl target amount',
      derivePerpTriggerPrice,
      { ...validDerive, target: { kind: 'pnl', amount: [] } },
      'invalid-decimal-string',
      '/target/amount',
    ],
    [
      'invalid derive roe target kind',
      derivePerpTriggerPrice,
      { ...validDerive, target: { kind: 'pnl', ratio: '1', leverage: '10' } },
      'invalid-target-kind',
      '/target/kind',
    ],
    [
      'invalid derive roe ratio',
      derivePerpTriggerPrice,
      { ...validDerive, target: { kind: 'roe', ratio: [], leverage: '10' } },
      'invalid-decimal-string',
      '/target/ratio',
    ],
    [
      'invalid derive roe leverage',
      derivePerpTriggerPrice,
      { ...validDerive, target: { kind: 'roe', ratio: '1', leverage: '0' } },
      'non-positive-decimal',
      '/target/leverage',
    ],
    [
      'invalid derive cumulative cost',
      derivePerpTriggerPrice,
      { ...validDerive, cumulativeCost: '-1' },
      'negative-decimal',
      '/cumulativeCost',
    ],
    [
      'invalid scale side',
      buildPerpScaleLadder,
      { ...validScale, side: 'hold' },
      'invalid-order-side',
      '/side',
    ],
    [
      'invalid scale lower price',
      buildPerpScaleLadder,
      { ...validScale, lowerPrice: '0' },
      'non-positive-decimal',
      '/lowerPrice',
    ],
    [
      'invalid scale upper price',
      buildPerpScaleLadder,
      { ...validScale, upperPrice: '0' },
      'non-positive-decimal',
      '/upperPrice',
    ],
    [
      'invalid scale price range',
      buildPerpScaleLadder,
      { ...validScale, lowerPrice: '110', upperPrice: '100' },
      'invalid-price-range',
      '',
    ],
    [
      'invalid scale total size',
      buildPerpScaleLadder,
      { ...validScale, totalSize: '0' },
      'non-positive-decimal',
      '/totalSize',
    ],
    [
      'invalid scale leg count',
      buildPerpScaleLadder,
      { ...validScale, legCount: 101 },
      'invalid-leg-count',
      '/legCount',
    ],
    [
      'invalid scale distribution',
      buildPerpScaleLadder,
      { ...validScale, distribution: 'weighted' },
      'invalid-distribution',
      '/distribution',
    ],
    [
      'invalid scale szDecimals',
      buildPerpScaleLadder,
      { ...validScale, szDecimals: 8 },
      'invalid-sz-decimals',
      '/szDecimals',
    ],
    [
      'invalid scale total size precision',
      buildPerpScaleLadder,
      { ...validScale, totalSize: '1.001', szDecimals: 2 },
      'invalid-total-size-precision',
      '/totalSize',
    ],
    [
      'invalid twap total size',
      calculatePerpTwapExecutionTarget,
      { ...validTwap, totalSize: '0' },
      'non-positive-decimal',
      '/totalSize',
    ],
    [
      'invalid twap duration type',
      calculatePerpTwapExecutionTarget,
      { ...validTwap, durationMs: 30_000.5 },
      'invalid-duration-ms',
      '/durationMs',
    ],
    [
      'invalid twap elapsed type',
      calculatePerpTwapExecutionTarget,
      { ...validTwap, elapsedMs: 15_000.5 },
      'invalid-elapsed-ms',
      '/elapsedMs',
    ],
    [
      'twap elapsed exceeds duration',
      calculatePerpTwapExecutionTarget,
      { ...validTwap, elapsedMs: 30_001 },
      'invalid-elapsed-ms',
      '/elapsedMs',
    ],
  ] as const)('returns invalid-input for %s', (_, fn, input, code, path) => {
    expectInvalid(fn, input, { code, path })
  })

  it('accepts a not-supported rule reason without a path and omits missing', () => {
    const result = validatePerpOrder({
      ...validOrder,
      minimumNotional: { kind: 'not-supported', reason: { code: 'not-in-fixture' } },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.checks).toContainEqual({
      status: 'not-evaluated',
      ruleId: 'hl.orders.perp.minimum-notional',
      reason: { code: 'not-in-fixture' },
    })
  })

  it('preserves safe-integer metadata in rule reason details', () => {
    const result = validatePerpOrder({
      ...validOrder,
      minimumNotional: {
        kind: 'not-supported',
        reason: { code: 'not-in-fixture', details: { count: Number.MAX_SAFE_INTEGER } },
      },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.checks).toContainEqual({
      status: 'not-evaluated',
      ruleId: 'hl.orders.perp.minimum-notional',
      reason: {
        code: 'not-in-fixture',
        details: { count: Number.MAX_SAFE_INTEGER },
      },
    })
  })
})
