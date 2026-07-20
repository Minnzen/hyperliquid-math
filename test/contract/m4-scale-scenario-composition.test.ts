import { describe, expect, it } from 'vitest'
import { buildPerpScaleLadder } from '../../src/orders/index.js'
import { simulatePerpAccountScenario } from '../../src/scenarios/index.js'

const asset = {
  network: 'testnet',
  marketKind: 'perp',
  dex: null,
  index: 3,
} as const

describe('M4 Scale and scenario composition', () => {
  it('projects ladder legs as explicit sequential fills without duplicating scenario math', () => {
    const ladder = buildPerpScaleLadder({
      side: 'buy',
      lowerPrice: '90',
      upperPrice: '110',
      totalSize: '3',
      legCount: 3,
      distribution: 'linear',
      szDecimals: 2,
    })

    expect(ladder.value.status).toBe('ok')
    if (ladder.value.status !== 'ok') return

    const scenario = simulatePerpAccountScenario({
      snapshot: {
        crossAccountValue: '1000',
        positions: [
          {
            kind: 'flat',
            asset,
            marginMode: { kind: 'cross' },
            leverage: '10',
          },
        ],
        markets: [
          {
            asset,
            markPrice: '100',
            maxLeverage: '20',
            marginTiers: [
              { lowerBound: '0', maxLeverage: '20' },
              { lowerBound: '1000', maxLeverage: '10' },
            ],
          },
        ],
      },
      actions: ladder.value.data.legs.map((leg) => ({
        kind: 'fill' as const,
        asset,
        fill: {
          side: 'buy' as const,
          size: leg.size,
          price: leg.price,
          fee: { kind: 'none' as const },
        },
        isolatedMarginAllocation: { kind: 'not-applicable' as const },
      })),
    })

    expect(scenario.value.status).toBe('ok')
    if (scenario.value.status !== 'ok') return
    expect(scenario.value.data.delta.actionsApplied).toBe(3)
    expect(scenario.value.data.positionTransitions).toHaveLength(3)
    expect(scenario.value.data.projected.positions[0]).toMatchObject({
      state: { kind: 'open', signedSize: '3', entryPrice: '100' },
    })
    expect(scenario.value.data.projected.liquidation.byAsset).toHaveProperty('hl:testnet:perp::3')
  })
})
