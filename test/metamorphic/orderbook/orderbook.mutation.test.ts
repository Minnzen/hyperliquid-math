import { describe, expect, it } from 'vitest'
import { calculateBookMetrics, simulateBookFill } from '../../../src/orderbook/index.js'

describe('orderbook directed mutation-kill vectors', () => {
  it('kills a best-bid spread denominator mutant', () => {
    const result = calculateBookMetrics({
      levels: [[{ px: '100', sz: '1', n: 1 }], [{ px: '102', sz: '1', n: 1 }]],
    })
    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.spreadBps).toBe('198.019801980198019801980198019801980198')
    expect(result.value.data.spreadBps).not.toBe('200')
  })

  it('kills a buy-walks-bids mutant', () => {
    const result = simulateBookFill({
      levels: [[{ px: '99', sz: '1', n: 1 }], [{ px: '101', sz: '1', n: 1 }]],
      side: 'buy',
      amount: { kind: 'size', value: '1' },
      referencePrice: '100',
    })
    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.worstPrice).toBe('101')
    expect(result.value.data.worstPrice).not.toBe('99')
  })

  it('kills an upward final-notional size mutant', () => {
    const result = simulateBookFill({
      levels: [[], [{ px: '101', sz: '1', n: 1 }]],
      side: 'buy',
      amount: { kind: 'notional', value: '10', szDecimals: 2 },
      referencePrice: '100',
    })
    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.filledSize).toBe('0.09')
    expect(result.value.data.filledSize).not.toBe('0.1')
  })

  it('kills a side-agnostic sell-slippage mutant', () => {
    const result = simulateBookFill({
      levels: [[{ px: '99', sz: '1', n: 1 }], []],
      side: 'sell',
      amount: { kind: 'size', value: '1' },
      referencePrice: '100',
    })
    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.slippageBps).toBe('100')
    expect(result.value.data.slippageBps).not.toBe('-100')
  })
})
