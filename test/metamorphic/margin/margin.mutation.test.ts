import { describe, expect, it } from 'vitest'
import {
  calculatePerpInitialMargin,
  calculatePerpMaintenanceMargin,
  evaluatePerpAccountMargin,
} from '../../../src/margin/index.js'

const btc = { network: 'mainnet', marketKind: 'perp', dex: null, index: 0 } as const
const eth = { network: 'mainnet', marketKind: 'perp', dex: null, index: 1 } as const

const tiers = [
  { lowerBound: '0', maxLeverage: '10' },
  { lowerBound: '1000', maxLeverage: '5' },
] as const
const highLeverageTier = [{ lowerBound: '0', maxLeverage: '40' }] as const

describe('margin directed mutation-kill vectors', () => {
  it('kills a max-leverage-instead-of-user-leverage initial margin mutant', () => {
    const result = calculatePerpInitialMargin({
      position: {
        asset: btc,
        signedSize: '2',
        markPrice: '100',
        leverage: '4',
        marginMode: { kind: 'cross' },
        marginTiers: tiers,
      },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.initialMargin).toBe('50')
    expect(result.value.data.initialMargin).not.toBe('20')
  })

  it('kills a missing-tier-deduction maintenance mutant', () => {
    const result = calculatePerpMaintenanceMargin({
      position: {
        asset: btc,
        signedSize: '20',
        markPrice: '100',
        leverage: '5',
        marginMode: { kind: 'cross' },
        marginTiers: tiers,
      },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.tierIndex).toBe(1)
    expect(result.value.data.maintenanceMargin).toBe('150')
    expect(result.value.data.maintenanceMargin).not.toBe('200')
  })

  it('kills a sum-of-per-position-transfer-requirements account mutant', () => {
    const result = evaluatePerpAccountMargin({
      crossAccountValue: '1000',
      positions: [
        {
          asset: btc,
          signedSize: '1',
          markPrice: '100',
          leverage: '20',
          marginMode: { kind: 'cross' },
          marginTiers: highLeverageTier,
        },
        {
          asset: eth,
          signedSize: '-1',
          markPrice: '100',
          leverage: '20',
          marginMode: { kind: 'cross' },
          marginTiers: highLeverageTier,
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.cross.transferMarginRequirement).toBe('20')
    expect(result.value.data.cross.transferMarginRequirement).not.toBe('10')
  })
})
