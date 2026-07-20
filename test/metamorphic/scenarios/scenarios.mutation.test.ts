import { describe, expect, it } from 'vitest'
import {
  type PerpAccountScenarioSnapshot,
  simulatePerpAccountScenario,
} from '../../../src/scenarios/index.js'

const btc = { network: 'testnet', marketKind: 'perp', dex: null, index: 3 } as const
const marginTiers = [{ lowerBound: '0', maxLeverage: '20' }] as const

function snapshot(crossAccountValue = '1000'): PerpAccountScenarioSnapshot {
  return {
    crossAccountValue,
    positions: [
      {
        kind: 'open',
        asset: btc,
        signedSize: '2',
        entryPrice: '100',
        marginMode: { kind: 'cross' },
        leverage: '10',
      },
    ],
    markets: [{ asset: btc, markPrice: '100', maxLeverage: '20', marginTiers }],
  }
}

describe('scenario directed mutation-kill vectors', () => {
  it('kills a fee-applied-twice mutant for cross reducing fills', () => {
    const result = simulatePerpAccountScenario({
      snapshot: snapshot(),
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: {
            side: 'sell',
            size: '1',
            price: '110',
            fee: { kind: 'explicit', amount: '3' },
          },
          isolatedMarginAllocation: { kind: 'not-applicable' },
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.delta.crossAccountValue).toBe('7')
    expect(result.value.data.delta.crossAccountValue).not.toBe('4')
  })

  it('kills an action-sort mutant by preserving caller delta order', () => {
    const result = simulatePerpAccountScenario({
      snapshot: snapshot('100'),
      actions: [
        { kind: 'cross-account-value-delta', amount: '-50' },
        { kind: 'cross-account-value-delta', amount: '20' },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(
      result.value.data.actions.map((action: { actionIndex: number }) => action.actionIndex),
    ).toEqual([0, 1])
    expect(result.value.data.projected.cross.accountValue).toBe('70')
  })

  it('kills a prefix-projection mutant when a later action is invalid', () => {
    const result = simulatePerpAccountScenario({
      snapshot: snapshot(),
      actions: [
        { kind: 'cross-account-value-delta', amount: '5' },
        { kind: 'cross-account-value-delta', amount: 'bad' },
      ],
    } as never)

    expect(result.value.status).toBe('invalid-input')
    expect(result.value).not.toHaveProperty('data')
  })

  it('kills an isolated-transfer-sign mutant', () => {
    const result = simulatePerpAccountScenario({
      snapshot: {
        crossAccountValue: '1000',
        positions: [
          {
            kind: 'open',
            asset: btc,
            signedSize: '2',
            entryPrice: '100',
            marginMode: {
              kind: 'isolated',
              isolatedMarginValue: '100',
              marginRemoval: 'allowed',
            },
            leverage: '10',
          },
        ],
        markets: [{ asset: btc, markPrice: '100', maxLeverage: '20', marginTiers }],
      },
      actions: [{ kind: 'isolated-margin-delta', asset: btc, amount: '20' }],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.delta.crossAccountValue).toBe('-20')
    expect(result.value.data.delta.isolatedMarginValues['hl:testnet:perp::3']).toBe('20')
  })

  it('kills a cross-leverage-affects-liquidation mutant', () => {
    const result = simulatePerpAccountScenario({
      snapshot: snapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'cross',
          leverage: '5',
          marginEffect: { kind: 'none' },
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.delta.liquidationPrices['hl:testnet:perp::3']).toBe('0')
  })
})
