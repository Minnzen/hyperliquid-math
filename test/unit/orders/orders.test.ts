import { describe, expect, it } from 'vitest'
import {
  buildPerpScaleLadder,
  calculatePerpMaxOrderSize,
  calculatePerpSlippagePrice,
  calculatePerpTwapSchedule,
  classifyPerpTrigger,
  derivePerpTriggerPrice,
  evaluatePerpReduceOnly,
  validatePerpOrder,
} from '../../../src/orders/index.js'

const unavailableRule = {
  kind: 'not-supported',
  reason: { code: 'rule-not-in-snapshot', path: '/orderValueLimit' },
} as const

describe('validatePerpOrder', () => {
  it('returns objective satisfied checks for a valid order', () => {
    const result = validatePerpOrder({
      price: '100.12',
      size: '0.5',
      szDecimals: 2,
      minimumNotional: { kind: 'available', value: '10' },
      priceBand: { kind: 'available', value: { lowerBound: '90', upperBound: '110' } },
    })

    expect(result).toMatchObject({
      value: {
        status: 'ok',
        data: {
          notional: '50.06',
          checks: [
            { status: 'satisfied', ruleId: 'hl.orders.perp.price-precision' },
            { status: 'satisfied', ruleId: 'hl.orders.perp.size-precision' },
            { status: 'satisfied', ruleId: 'hl.orders.perp.minimum-notional' },
            { status: 'satisfied', ruleId: 'hl.orders.perp.price-band' },
          ],
        },
      },
      trace: { formulaId: 'hl.orders.perp.validate', authority: 'local-exact' },
    })
  })

  it('returns ok with violated precision checks instead of silently rounding', () => {
    const result = validatePerpOrder({
      price: '100.123',
      size: '0.123',
      szDecimals: 2,
      minimumNotional: { kind: 'available', value: '10' },
      priceBand: { kind: 'not-applicable', reason: { code: 'no-band-for-market' } },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.notional).toBe('12.315129')
    expect(result.value.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'violated',
          ruleId: 'hl.orders.perp.price-precision',
          violation: expect.objectContaining({
            ruleId: 'hl.orders.perp.price-precision',
            actual: '100.123',
            limit: '100.12',
          }),
        }),
        expect.objectContaining({
          status: 'violated',
          ruleId: 'hl.orders.perp.size-precision',
          violation: expect.objectContaining({
            ruleId: 'hl.orders.perp.size-precision',
            actual: '0.123',
            limit: '0.12',
          }),
        }),
        {
          status: 'not-applicable',
          ruleId: 'hl.orders.perp.price-band',
          reason: { code: 'no-band-for-market' },
        },
      ]),
    )
  })

  it('preserves an unavailable rule as not-evaluated', () => {
    const result = validatePerpOrder({
      price: '100',
      size: '1',
      szDecimals: 2,
      minimumNotional: {
        kind: 'not-supported',
        reason: { code: 'minimum-notional-missing', path: '/minimumNotional' },
      },
      priceBand: {
        kind: 'not-supported',
        reason: { code: 'price-band-missing', path: '/priceBand' },
      },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.checks).toEqual(
      expect.arrayContaining([
        {
          status: 'not-evaluated',
          ruleId: 'hl.orders.perp.minimum-notional',
          reason: { code: 'minimum-notional-missing', path: '/minimumNotional' },
          missing: ['/minimumNotional'],
        },
        {
          status: 'not-evaluated',
          ruleId: 'hl.orders.perp.price-band',
          reason: { code: 'price-band-missing', path: '/priceBand' },
          missing: ['/priceBand'],
        },
      ]),
    )
  })

  it('reports minimum-notional and price-band violations independently', () => {
    const result = validatePerpOrder({
      price: '120',
      size: '0.01',
      szDecimals: 2,
      minimumNotional: { kind: 'available', value: '10' },
      priceBand: { kind: 'available', value: { lowerBound: '90', upperBound: '110' } },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'violated',
          ruleId: 'hl.orders.perp.minimum-notional',
          violation: expect.objectContaining({ code: 'below-minimum-notional' }),
        }),
        expect.objectContaining({
          status: 'violated',
          ruleId: 'hl.orders.perp.price-band',
          violation: expect.objectContaining({ code: 'outside-price-band' }),
        }),
      ]),
    )
  })

  it('accepts and preserves fully validated rule reasons, including the root JSON pointer', () => {
    const missingRuleReason = {
      code: 'rules-snapshot-missing',
      path: '',
      details: { snapshotVersion: 1 },
      sourceRefs: ['HL.TEST.RULES'],
    } as const
    const notApplicableReason = {
      code: 'band-not-applicable',
      details: { orderKind: 'market' },
      sourceRefs: ['HL.TEST.ORDER_KIND'],
    } as const
    const result = validatePerpOrder({
      price: '100',
      size: '1',
      szDecimals: 2,
      minimumNotional: { kind: 'not-supported', reason: missingRuleReason },
      priceBand: { kind: 'not-applicable', reason: notApplicableReason },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.checks).toEqual(
      expect.arrayContaining([
        {
          status: 'not-evaluated',
          ruleId: 'hl.orders.perp.minimum-notional',
          reason: missingRuleReason,
          missing: [''],
        },
        {
          status: 'not-applicable',
          ruleId: 'hl.orders.perp.price-band',
          reason: notApplicableReason,
        },
      ]),
    )
  })
})

describe('calculatePerpMaxOrderSize', () => {
  it('combines reducible, collateral, and published order-value bounds', () => {
    const result = calculatePerpMaxOrderSize({
      availableCollateral: '100',
      leverage: '5',
      referencePrice: '100',
      currentSignedSize: '2',
      side: 'sell',
      reduceOnly: false,
      szDecimals: 2,
      orderValueLimit: { kind: 'available', value: '600' },
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        openingCapacitySize: '5',
        reducibleSize: '2',
        collateralBoundSize: '7',
        orderValueBoundSize: '6',
        localUpperBoundSize: '6',
        checks: [{ status: 'satisfied', ruleId: 'hl.orders.perp.order-value-limit-available' }],
      },
    })
  })

  it('caps reduce-only at the current reducible quantity', () => {
    const result = calculatePerpMaxOrderSize({
      availableCollateral: '100',
      leverage: '5',
      referencePrice: '100',
      currentSignedSize: '-2.345',
      side: 'buy',
      reduceOnly: true,
      szDecimals: 2,
      orderValueLimit: unavailableRule,
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.reducibleSize).toBe('2.345')
    expect(result.value.data.localUpperBoundSize).toBe('2.34')
    expect(result.value.data.orderValueBoundSize).toBeNull()
    expect(result.value.data.checks).toEqual([
      expect.objectContaining({
        status: 'not-evaluated',
        ruleId: 'hl.orders.perp.order-value-limit-available',
      }),
    ])
  })
})

describe('evaluatePerpReduceOnly', () => {
  it.each([
    ['1', 'reduce'],
    ['2', 'close'],
    ['3', 'would-flip'],
  ] as const)('classifies a long sell of %s as %s', (requestedSize, expected) => {
    const result = evaluatePerpReduceOnly({
      currentSignedSize: '2',
      side: 'sell',
      requestedSize,
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.requestedEffect).toBe(expected)
    expect(result.value.data.reducibleSize).toBe('2')
    if (expected === 'reduce' || expected === 'close') {
      expect(result.value.data.acceptedTransitionSize).toBe(requestedSize)
      expect(result.value.data.check).toEqual({
        status: 'satisfied',
        ruleId: 'hl.orders.perp.reduce-only',
      })
    } else {
      expect(result.value.data.acceptedTransitionSize).toBeNull()
      expect(result.value.data.check.status).toBe('violated')
    }
  })

  it('rejects a wrong-side order without predicting a server transition', () => {
    const result = evaluatePerpReduceOnly({
      currentSignedSize: '-2',
      side: 'sell',
      requestedSize: '1',
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        requestedEffect: 'would-increase',
        reducibleSize: '0',
        acceptedTransitionSize: null,
        check: { status: 'violated' },
      },
    })
  })
})

describe('calculatePerpSlippagePrice', () => {
  it('rounds a buy cap down and a sell floor up', () => {
    const buy = calculatePerpSlippagePrice({
      side: 'buy',
      referencePrice: '100.123',
      slippageBps: '100',
      szDecimals: 2,
    })
    const sell = calculatePerpSlippagePrice({
      side: 'sell',
      referencePrice: '100.123',
      slippageBps: '100',
      szDecimals: 2,
    })

    expect(buy.value).toEqual({
      status: 'ok',
      data: { rawPrice: '101.12423', protectionPrice: '101.12', rounding: 'down' },
    })
    expect(sell.value).toEqual({
      status: 'ok',
      data: { rawPrice: '99.12177', protectionPrice: '99.122', rounding: 'up' },
    })
  })

  it('rejects a positive buy boundary that protocol quantization collapses to zero', () => {
    const result = calculatePerpSlippagePrice({
      side: 'buy',
      referencePrice: '0.1',
      slippageBps: '0',
      szDecimals: 6,
    })

    expect(result.value).toEqual({
      status: 'invalid-input',
      issues: [expect.objectContaining({ code: 'rounded-to-zero', path: '/referencePrice' })],
    })
  })

  it('rejects a sell slippage boundary at or below zero', () => {
    const result = calculatePerpSlippagePrice({
      side: 'sell',
      referencePrice: '100',
      slippageBps: '10000',
      szDecimals: 2,
    })

    expect(result.value).toEqual({
      status: 'invalid-input',
      issues: [expect.objectContaining({ code: 'non-positive-sell-boundary' })],
    })
  })

  it('uses the tightest valid integer or significant-figure boundary without crossing reference', () => {
    const buy = calculatePerpSlippagePrice({
      side: 'buy',
      referencePrice: '103333',
      slippageBps: '10',
      szDecimals: 2,
    })
    const sell = calculatePerpSlippagePrice({
      side: 'sell',
      referencePrice: '999999',
      slippageBps: '0.001',
      szDecimals: 2,
    })
    const tinySell = calculatePerpSlippagePrice({
      side: 'sell',
      referencePrice: '0.000001',
      slippageBps: '0.001',
      szDecimals: 6,
    })

    expect(buy.value).toMatchObject({
      status: 'ok',
      data: { rawPrice: '103436.333', protectionPrice: '103436' },
    })
    expect(sell.value).toMatchObject({
      status: 'ok',
      data: { rawPrice: '999998.9000001', protectionPrice: '999999' },
    })
    expect(tinySell.value).toEqual({
      status: 'invalid-input',
      issues: [
        expect.objectContaining({
          code: 'no-valid-protection-price',
          path: '/referencePrice',
          actual: '1',
        }),
      ],
    })
  })
})

describe('classifyPerpTrigger', () => {
  it.each([
    ['long', 'sell', '110', 'take-profit'],
    ['long', 'sell', '90', 'stop-loss'],
    ['short', 'buy', '90', 'take-profit'],
    ['short', 'buy', '110', 'stop-loss'],
  ] as const)(
    'classifies %s %s trigger %s as %s',
    (positionSide, orderSide, triggerPrice, expected) => {
      const result = classifyPerpTrigger({
        positionSide,
        orderSide,
        markPrice: '100',
        triggerPrice,
      })

      expect(result.value.status).toBe('ok')
      if (result.value.status !== 'ok') return
      expect(result.value.data.classification).toBe(expected)
      expect(result.value.data.checks).toEqual([
        { status: 'satisfied', ruleId: 'hl.orders.perp.trigger-closing-side' },
        { status: 'satisfied', ruleId: 'hl.orders.perp.trigger-direction' },
      ])
    },
  )

  it('reports equal mark and wrong closing side as objective violations', () => {
    const result = classifyPerpTrigger({
      positionSide: 'long',
      orderSide: 'buy',
      markPrice: '100',
      triggerPrice: '100',
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.classification).toBe('at-mark')
    expect(result.value.data.checks.map((check) => check.status)).toEqual(['violated', 'violated'])
  })
})

describe('derivePerpTriggerPrice', () => {
  it('solves a long target PnL after explicit cumulative costs', () => {
    const result = derivePerpTriggerPrice({
      position: { kind: 'open', signedSize: '2', entryPrice: '100' },
      target: { kind: 'pnl', amount: '16' },
      cumulativeCost: '4',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        targetNetPnl: '16',
        cumulativeCost: '4',
        targetGrossPnl: '20',
        initialMarginBasis: null,
        triggerPrice: '110',
      },
    })
  })

  it('uses an explicit initial-margin basis for target ROE', () => {
    const result = derivePerpTriggerPrice({
      position: { kind: 'open', signedSize: '2', entryPrice: '100' },
      target: { kind: 'roe', ratio: '0.5', leverage: '10' },
      cumulativeCost: '0',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        targetNetPnl: '10',
        cumulativeCost: '0',
        targetGrossPnl: '10',
        initialMarginBasis: '20',
        triggerPrice: '105',
      },
    })
  })

  it('preserves the short sign when solving a profitable target', () => {
    const result = derivePerpTriggerPrice({
      position: { kind: 'open', signedSize: '-2', entryPrice: '100' },
      target: { kind: 'pnl', amount: '20' },
      cumulativeCost: '0',
    })

    expect(result.value).toMatchObject({ status: 'ok', data: { triggerPrice: '90' } })
  })

  it('returns indeterminate when assumptions imply no positive trigger', () => {
    const result = derivePerpTriggerPrice({
      position: { kind: 'open', signedSize: '2', entryPrice: '100' },
      target: { kind: 'pnl', amount: '-300' },
      cumulativeCost: '0',
    })

    expect(result.value).toMatchObject({
      status: 'indeterminate',
      reason: { code: 'no-positive-trigger-price-under-assumptions' },
    })
  })

  it('preserves normalized ROE assumptions in an indeterminate trace', () => {
    const result = derivePerpTriggerPrice({
      position: { kind: 'open', signedSize: '2', entryPrice: '100' },
      target: { kind: 'roe', ratio: '-100', leverage: '10' },
      cumulativeCost: '0',
    })

    expect(result.value.status).toBe('indeterminate')
    expect(result.trace.normalizedInputs).toMatchObject({
      target: { kind: 'roe', ratio: '-100', leverage: '10' },
    })
  })
})

describe('buildPerpScaleLadder', () => {
  it('allocates a linear ladder without exceeding total size', () => {
    const result = buildPerpScaleLadder({
      side: 'buy',
      lowerPrice: '90',
      upperPrice: '110',
      totalSize: '1',
      legCount: 3,
      distribution: 'linear',
      szDecimals: 2,
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        totalAllocatedSize: '1',
        legs: [
          { index: 0, rawPrice: '90', price: '90', size: '0.33' },
          { index: 1, rawPrice: '100', price: '100', size: '0.33' },
          { index: 2, rawPrice: '110', price: '110', size: '0.34' },
        ],
      },
    })
  })

  it('constructs exact geometric levels when the ratio has exact roots', () => {
    const result = buildPerpScaleLadder({
      side: 'sell',
      lowerPrice: '100',
      upperPrice: '400',
      totalSize: '3',
      legCount: 3,
      distribution: 'geometric',
      szDecimals: 2,
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.legs.map((leg) => leg.price)).toEqual(['100', '200', '400'])
    expect(result.value.data.legs.map((leg) => leg.size)).toEqual(['1', '1', '1'])
  })

  it('rejects a positive buy level that protocol quantization collapses to zero', () => {
    const result = buildPerpScaleLadder({
      side: 'buy',
      lowerPrice: '0.1',
      upperPrice: '2.1',
      totalSize: '3',
      legCount: 3,
      distribution: 'linear',
      szDecimals: 6,
    })

    expect(result.value).toEqual({
      status: 'invalid-input',
      issues: [expect.objectContaining({ code: 'rounded-to-zero', path: '/lowerPrice' })],
    })
  })

  it('rejects precision-collapsed price levels', () => {
    const result = buildPerpScaleLadder({
      side: 'buy',
      lowerPrice: '1.00001',
      upperPrice: '1.00002',
      totalSize: '1',
      legCount: 3,
      distribution: 'linear',
      szDecimals: 2,
    })

    expect(result.value.status).toBe('invalid-input')
  })

  it('rejects a ladder whose per-leg size rounds to zero', () => {
    const result = buildPerpScaleLadder({
      side: 'buy',
      lowerPrice: '90',
      upperPrice: '110',
      totalSize: '0.01',
      legCount: 3,
      distribution: 'linear',
      szDecimals: 2,
    })

    expect(result.value).toEqual({
      status: 'invalid-input',
      issues: [expect.objectContaining({ code: 'zero-scale-leg-size', path: '/totalSize' })],
    })
  })

  it('keeps a high-price ladder distinct by using valid integer levels', () => {
    const result = buildPerpScaleLadder({
      side: 'buy',
      lowerPrice: '100000',
      upperPrice: '100010',
      totalSize: '4',
      legCount: 4,
      distribution: 'linear',
      szDecimals: 2,
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        legs: [{ price: '100000' }, { price: '100003' }, { price: '100006' }, { price: '100010' }],
      },
    })
  })
})

describe('calculatePerpTwapSchedule', () => {
  it('builds official 30-second targets and the three-times catch-up bound', () => {
    const result = calculatePerpTwapSchedule({ totalSize: '12', durationMs: 120_000 })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        intervalMs: 30_000,
        childCount: 4,
        normalChildSize: '3',
        maxCatchUpChildSize: '9',
        maxSlippageBps: '300',
        targets: [
          { index: 0, elapsedMs: 30_000, cumulativeTargetSize: '3' },
          { index: 1, elapsedMs: 60_000, cumulativeTargetSize: '6' },
          { index: 2, elapsedMs: 90_000, cumulativeTargetSize: '9' },
          { index: 3, elapsedMs: 120_000, cumulativeTargetSize: '12' },
        ],
      },
    })
  })

  it('rejects a duration that is not a 30-second multiple', () => {
    const result = calculatePerpTwapSchedule({ totalSize: '12', durationMs: 45_000 })
    expect(result.value.status).toBe('invalid-input')
  })
})
