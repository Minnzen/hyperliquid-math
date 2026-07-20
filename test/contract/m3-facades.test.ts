import { describe, expect, it } from 'vitest'
import {
  calculatePerpInitialMargin,
  calculatePerpLiquidationPrice,
  calculatePerpMaintenanceMargin,
  evaluatePerpAccountMargin,
  simulatePerpAccountScenario,
} from '../../src/index.js'

const facades = [
  ['calculatePerpInitialMargin', calculatePerpInitialMargin],
  ['calculatePerpMaintenanceMargin', calculatePerpMaintenanceMargin],
  ['evaluatePerpAccountMargin', evaluatePerpAccountMargin],
  ['calculatePerpLiquidationPrice', calculatePerpLiquidationPrice],
  ['simulatePerpAccountScenario', simulatePerpAccountScenario],
] as const

describe('M3 public facade safety', () => {
  it.each(facades)('%s rejects a revoked root proxy without throwing', (_name, facade) => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()

    expect(() => (facade as (input: never) => unknown)(proxy as never)).not.toThrow()
    const result = (facade as (input: never) => { value: { status: string } })(proxy as never)
    expect(result.value.status).toBe('invalid-input')
  })

  it('does not invoke nested asset or action accessors while validating scenarios', () => {
    let assetReads = 0
    let actionReads = 0
    const asset = Object.defineProperties(
      {},
      {
        network: { enumerable: true, value: 'testnet' },
        marketKind: { enumerable: true, value: 'perp' },
        dex: {
          enumerable: true,
          get() {
            assetReads += 1
            return 'BTC'
          },
        },
        index: { enumerable: true, value: 3 },
      },
    )
    const action = Object.defineProperties(
      {},
      {
        kind: {
          enumerable: true,
          get() {
            actionReads += 1
            return 'cross-account-value-delta'
          },
        },
        amount: { enumerable: true, value: '1' },
      },
    )

    expect(() =>
      simulatePerpAccountScenario({
        snapshot: {
          crossAccountValue: '1000',
          positions: [
            {
              kind: 'open',
              asset,
              signedSize: '1',
              entryPrice: '100',
              marginMode: { kind: 'cross' },
              leverage: '10',
            },
          ],
          markets: [
            {
              asset,
              markPrice: '100',
              maxLeverage: '20',
              marginTiers: [{ lowerBound: '0', maxLeverage: '20' }],
            },
          ],
        },
        actions: [action],
      } as never),
    ).not.toThrow()
    expect(assetReads).toBe(0)
    expect(actionReads).toBe(0)
  })

  it('keeps invalid M3 traces assumption-free', () => {
    const invalidResults = [
      calculatePerpInitialMargin(null as never),
      calculatePerpMaintenanceMargin(null as never),
      evaluatePerpAccountMargin(null as never),
      calculatePerpLiquidationPrice(null as never),
      simulatePerpAccountScenario(null as never),
    ]

    for (const result of invalidResults) {
      expect(result.value.status).toBe('invalid-input')
      expect(result.trace.completion.status).toBe('incomplete')
      expect(result.trace.assumptions).toEqual([])
    }
  })
})
