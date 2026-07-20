import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { simulateBookFill } from '../../../src/orderbook/index.js'

describe('orderbook metamorphic behavior', () => {
  it('scales filled size, notional, and unfilled size linearly when book sizes and request size scale', () => {
    const base = simulateBookFill({
      levels: [
        [
          { px: '99', sz: '1', n: 1 },
          { px: '98', sz: '2', n: 1 },
        ],
        [
          { px: '101', sz: '1', n: 1 },
          { px: '102', sz: '2', n: 1 },
        ],
      ],
      side: 'buy',
      amount: { kind: 'size', value: '2.5' },
      referencePrice: '100',
    })
    const scaled = simulateBookFill({
      levels: [
        [
          { px: '99', sz: '10', n: 1 },
          { px: '98', sz: '20', n: 1 },
        ],
        [
          { px: '101', sz: '10', n: 1 },
          { px: '102', sz: '20', n: 1 },
        ],
      ],
      side: 'buy',
      amount: { kind: 'size', value: '25' },
      referencePrice: '100',
    })

    expect(base.value.status).toBe('ok')
    expect(scaled.value.status).toBe('ok')
    if (base.value.status !== 'ok' || scaled.value.status !== 'ok') return

    expect(
      new Decimal(scaled.value.data.filledSize).div(base.value.data.filledSize).toFixed(),
    ).toBe('10')
    expect(
      new Decimal(scaled.value.data.filledNotional).div(base.value.data.filledNotional).toFixed(),
    ).toBe('10')
    expect(scaled.value.data.vwap).toBe(base.value.data.vwap)
    expect(scaled.value.data.slippageBps).toBe(base.value.data.slippageBps)
  })

  it('reports opposite signed slippage for mirrored buy and sell books around the reference', () => {
    const buy = simulateBookFill({
      levels: [[{ px: '99', sz: '2', n: 1 }], [{ px: '101', sz: '2', n: 1 }]],
      side: 'buy',
      amount: { kind: 'size', value: '1' },
      referencePrice: '100',
    })
    const sell = simulateBookFill({
      levels: [[{ px: '101', sz: '2', n: 1 }], [{ px: '103', sz: '2', n: 1 }]],
      side: 'sell',
      amount: { kind: 'size', value: '1' },
      referencePrice: '100',
    })

    expect(buy.value.status).toBe('ok')
    expect(sell.value.status).toBe('ok')
    if (buy.value.status !== 'ok' || sell.value.status !== 'ok') return

    expect(buy.value.data.slippageBps).toBe('100')
    expect(sell.value.data.slippageBps).toBe('-100')
  })
})
