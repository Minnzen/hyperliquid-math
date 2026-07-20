import { describe, expect, it } from 'vitest'
import { calculateBookMetrics, simulateBookFill } from '../../../src/orderbook/index.js'

const book = {
  levels: [
    [
      { px: '100.0', sz: '2.5', n: 2 },
      { px: '99.5', sz: '3', n: 1 },
    ],
    [
      { px: '101.0', sz: '1.25', n: 3 },
      { px: '102.0', sz: '4', n: 1 },
    ],
  ],
} as const

describe('calculateBookMetrics', () => {
  it('returns exact best prices, mid, spread, spread bps, and bounded trace', () => {
    expect(calculateBookMetrics(book)).toEqual({
      value: {
        status: 'ok',
        data: {
          bestBid: '100',
          bestAsk: '101',
          mid: '100.5',
          spread: '1',
          spreadBps: '99.50248756218905472636815920398009950249',
        },
      },
      trace: {
        formulaId: 'hl.orderbook.metrics',
        formulaVersion: 1,
        authority: 'local-exact',
        maturity: 'stable',
        completion: { status: 'complete' },
        normalizedInputs: {
          bidCount: 2,
          askCount: 2,
          bestBid: '100',
          bestAsk: '101',
        },
        intermediates: [
          { stepId: 'mid', inputs: { bestBid: '100', bestAsk: '101' }, output: '100.5' },
          { stepId: 'spread', inputs: { bestBid: '100', bestAsk: '101' }, output: '1' },
          {
            stepId: 'spread-bps',
            inputs: { spread: '1', mid: '100.5' },
            output: '99.50248756218905472636815920398009950249',
          },
        ],
        rounding: [
          {
            path: '/value/data/mid',
            input: '(100+101)/2',
            output: '100.5',
            mode: 'half-even',
            reasonCode: 'decimal40-division',
          },
          {
            path: '/value/data/spreadBps',
            input: '1/100.5*10000',
            output: '99.50248756218905472636815920398009950249',
            mode: 'half-even',
            reasonCode: 'decimal40-division',
          },
        ],
        assumptions: [
          { kind: 'frozen-input', path: '/levels', value: 'caller-provided-l2-snapshot' },
        ],
        sourceRefs: [
          'HLM.SPEC.ORDERBOOK.METRICS.V1',
          'HL.DOC.INFO.L2BOOK.2026-07-19',
          'HL.DOC.WS.L2BOOK.2026-07-19',
          'DECIMALJS.10.6.0',
        ],
      },
    })
  })

  it('returns indeterminate for a structurally valid one-sided book', () => {
    const result = calculateBookMetrics({ levels: [[{ px: '100', sz: '1', n: 1 }], []] })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: { code: 'two-sided-book-required', path: '/levels' },
      missing: ['/levels/1'],
    })
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'two-sided-book-required', path: '/levels' },
    })
  })

  it.each([
    [{ levels: [[{ px: '100', sz: '1', n: 1 }], [{ px: '100', sz: '1', n: 1 }]] }, '/levels'],
    [
      {
        levels: [
          [
            { px: '99', sz: '1', n: 1 },
            { px: '100', sz: '1', n: 1 },
          ],
          [],
        ],
      },
      '/levels/0/1/px',
    ],
    [
      {
        levels: [
          [],
          [
            { px: '100', sz: '1', n: 1 },
            { px: '100', sz: '2', n: 1 },
          ],
        ],
      },
      '/levels/1/1/px',
    ],
    [
      { levels: [[{ px: '100', sz: '0', n: 1 }], [{ px: '101', sz: '1', n: 1 }]] },
      '/levels/0/0/sz',
    ],
  ])('rejects invalid book input at %s', (input, path) => {
    const result = calculateBookMetrics(
      input as unknown as Parameters<typeof calculateBookMetrics>[0],
    )

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues[0]?.path).toBe(path)
  })
})

describe('simulateBookFill', () => {
  it('walks asks for a buy size fill and reports vwap and adverse slippage', () => {
    const result = simulateBookFill({
      ...book,
      side: 'buy',
      amount: { kind: 'size', value: '3' },
      referencePrice: '100',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        completion: 'full',
        fills: [
          { px: '101', sz: '1.25', notional: '126.25' },
          { px: '102', sz: '1.75', notional: '178.5' },
        ],
        filledSize: '3',
        filledNotional: '304.75',
        unfilledAmount: '0',
        vwap: '101.5833333333333333333333333333333333333',
        worstPrice: '102',
        slippageBps: '158.33333333333333333333333333333333333',
      },
    })
    expect(result.trace.formulaId).toBe('hl.orderbook.fill.simulate')
    expect(result.trace.rounding).toContainEqual({
      path: '/value/data/vwap',
      input: '304.75/3',
      output: '101.5833333333333333333333333333333333333',
      mode: 'half-even',
      reasonCode: 'decimal40-division',
    })
    expect(JSON.stringify(result.trace)).not.toContain('101.0')
  })

  it('rounds a final notional partial size down and leaves the remainder unfilled', () => {
    const result = simulateBookFill({
      ...book,
      side: 'buy',
      amount: { kind: 'notional', value: '200', szDecimals: 2 },
      referencePrice: '100',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        completion: 'partial',
        fills: [
          { px: '101', sz: '1.25', notional: '126.25' },
          { px: '102', sz: '0.72', notional: '73.44' },
        ],
        filledSize: '1.97',
        filledNotional: '199.69',
        unfilledAmount: '0.31',
        vwap: '101.3654822335025380710659898477157360406',
        worstPrice: '102',
        slippageBps: '136.54822335025380710659898477157360406',
      },
    })
    expect(result.trace.rounding).toContainEqual({
      path: '/value/data/fills/1/sz',
      input: '73.75/102',
      output: '0.72',
      mode: 'down',
      reasonCode: 'notional-partial-size-quantization',
    })
  })

  it('returns none without synthetic vwap fields when no depth is available', () => {
    const result = simulateBookFill({
      levels: [[], []],
      side: 'sell',
      amount: { kind: 'size', value: '1' },
      referencePrice: '100',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        completion: 'none',
        fills: [],
        filledSize: '0',
        filledNotional: '0',
        unfilledAmount: '1',
      },
    })
  })

  it('returns not-applicable for a zero amount', () => {
    const result = simulateBookFill({
      ...book,
      side: 'sell',
      amount: { kind: 'size', value: '0' },
      referencePrice: '100',
    })

    expect(result.value).toEqual({
      status: 'not-applicable',
      reason: { code: 'zero-fill-amount', path: '/amount/value' },
    })
    expect(result.trace.completion).toEqual({ status: 'complete' })
  })

  it('rejects unbounded notional size precision', () => {
    const result = simulateBookFill({
      ...book,
      side: 'buy',
      amount: { kind: 'notional', value: '10', szDecimals: 9 },
      referencePrice: '100',
    })

    expect(result.value).toEqual({
      status: 'invalid-input',
      issues: [
        {
          code: 'invalid-size-decimals',
          path: '/amount/szDecimals',
          actual: '9',
          expected: 'safe integer between 0 and 8',
        },
      ],
    })
  })
})
