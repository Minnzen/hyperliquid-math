import { describe, expect, it } from 'vitest'
import { calculatePerpLiquidationPrice } from '../../../src/liquidation/index.js'

const btc = {
  network: 'mainnet',
  marketKind: 'perp',
  dex: null,
  index: 0,
} as const

const singleTier = [{ lowerBound: '0', maxLeverage: '10' }] as const

describe('calculatePerpLiquidationPrice negative liquidatable snapshots', () => {
  it('returns a positive cross liquidation root when cross account value is negative', () => {
    const result = calculatePerpLiquidationPrice({
      targetAsset: btc,
      crossAccountValue: '-20',
      positions: [
        {
          asset: btc,
          signedSize: '10',
          entryPrice: '100',
          markPrice: '100',
          marginMode: { kind: 'cross' },
          marginTiers: singleTier,
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.marginMode).toEqual({ kind: 'cross' })
    expect(result.value.data.liquidationPrice).toBe('107.3684210526315789473684210526315789474')
    expect(result.value.data.liquidationNotional).toBe('1073.684210526315789473684210526315789474')
    expect(result.value.data.accountEquityAtLiquidation).toBe(
      '53.684210526315789473684210526315789474',
    )
    expect(result.value.data.targetMaintenanceMargin).toBe(
      '53.6842105263157894736842105263157894737',
    )
    expect(result.value.data.totalAccountMaintenanceMargin).toBe(
      '53.6842105263157894736842105263157894737',
    )
    expect(result.value.data.currentlyAtOrBelowMaintenance).toBe(true)
  })

  it('returns a positive isolated liquidation root when isolated margin value is negative', () => {
    const result = calculatePerpLiquidationPrice({
      targetAsset: btc,
      crossAccountValue: '0',
      positions: [
        {
          asset: btc,
          signedSize: '10',
          entryPrice: '100',
          markPrice: '100',
          marginMode: {
            kind: 'isolated',
            isolatedMarginValue: '-20',
            marginRemoval: 'strict',
          },
          marginTiers: singleTier,
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.marginMode).toEqual({ kind: 'isolated', marginRemoval: 'strict' })
    expect(result.value.data.liquidationPrice).toBe('107.3684210526315789473684210526315789474')
    expect(result.value.data.liquidationNotional).toBe('1073.684210526315789473684210526315789474')
    expect(result.value.data.accountEquityAtLiquidation).toBe(
      '53.684210526315789473684210526315789474',
    )
    expect(result.value.data.targetMaintenanceMargin).toBe(
      '53.6842105263157894736842105263157894737',
    )
    expect(result.value.data.totalAccountMaintenanceMargin).toBe(
      '53.6842105263157894736842105263157894737',
    )
    expect(result.value.data.currentlyAtOrBelowMaintenance).toBe(true)
  })
})
