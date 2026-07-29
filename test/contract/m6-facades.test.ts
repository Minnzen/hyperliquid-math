import { describe, expect, it } from 'vitest'
import {
  calculateOutcomeDualPrice,
  calculateOutcomeSettlement,
  calculateUnifiedAccountRatio,
  evaluateRecurringOutcome,
} from '../../src/index.js'

const facades = [
  calculateOutcomeDualPrice,
  calculateOutcomeSettlement,
  evaluateRecurringOutcome,
  calculateUnifiedAccountRatio,
] as const

describe('M6 public facade safety', () => {
  it.each(facades)('never throws for a revoked root proxy', (facade) => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()

    expect(() => (facade as (input: never) => unknown)(proxy as never)).not.toThrow()
    expect(
      (facade as (input: never) => { value: { status: string } })(proxy as never).value.status,
    ).toBe('invalid-input')
  })

  it.each(facades)('keeps invalid traces incomplete and assumption-free', (facade) => {
    const result = (
      facade as (input: never) => {
        value: { status: string }
        trace: { completion: { status: string }; assumptions: readonly unknown[] }
      }
    )(null as never)

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion.status).toBe('incomplete')
    expect(result.trace.assumptions).toEqual([])
  })

  it('rejects hostile nested inputs without invoking accessors or throwing', () => {
    const reads = { count: 0 }
    const accessor = (value: unknown) =>
      Object.defineProperty({}, 'value', {
        enumerable: true,
        get() {
          reads.count += 1
          return value
        },
      })
    const { proxy: revokedThresholds, revoke: revokeThresholds } = Proxy.revocable([], {})
    const { proxy: revokedDex, revoke: revokeDex } = Proxy.revocable({}, {})
    const { proxy: revokedSpot, revoke: revokeSpot } = Proxy.revocable({}, {})
    revokeThresholds()
    revokeDex()
    revokeSpot()

    const calls = [
      () => calculateOutcomeDualPrice({ price: accessor('0.5') } as never),
      () =>
        calculateOutcomeSettlement({
          tokenSide: accessor('yes'),
          settleFraction: '0.5',
          size: '1',
          entryPrice: '0.5',
        } as never),
      () =>
        evaluateRecurringOutcome({
          class: 'priceBucket',
          markPrice0: '1',
          t0: 0,
          markPrice1: '2',
          t1: 1,
          settlementTime: 1,
          priceThresholds: revokedThresholds,
        } as never),
      () => calculateUnifiedAccountRatio({ dexes: [revokedDex], spotBalances: [] } as never),
      () => calculateUnifiedAccountRatio({ dexes: [], spotBalances: [revokedSpot] } as never),
    ]

    for (const call of calls) {
      expect(call).not.toThrow()
      const result = call()
      expect(result.value.status).toBe('invalid-input')
      expect(result.trace.completion.status).toBe('incomplete')
      expect(result.trace.assumptions).toEqual([])
    }
    expect(reads.count).toBe(0)
  })
})
