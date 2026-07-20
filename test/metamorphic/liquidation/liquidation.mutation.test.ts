import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { calculatePerpLiquidationPrice } from '../../../src/liquidation/index.js'

const btc = {
  network: 'mainnet',
  marketKind: 'perp',
  dex: null,
  index: 0,
} as const

const eth = {
  network: 'mainnet',
  marketKind: 'perp',
  dex: null,
  index: 1,
} as const

const singleTier = [{ lowerBound: '0', maxLeverage: '10' }] as const
const twoTiers = [
  { lowerBound: '0', maxLeverage: '10' },
  { lowerBound: '1000', maxLeverage: '5' },
] as const

describe('liquidation directed mutation-kill vectors', () => {
  it('kills a side-sign inversion mutant for short liquidation distance', () => {
    const result = calculatePerpLiquidationPrice({
      targetAsset: btc,
      crossAccountValue: '0',
      positions: [
        {
          asset: btc,
          signedSize: '-10',
          entryPrice: '100',
          markPrice: '100',
          marginMode: {
            kind: 'isolated',
            isolatedMarginValue: '200',
            marginRemoval: 'allowed',
          },
          marginTiers: singleTier,
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(new Decimal(result.value.data.liquidationPrice).gt('100')).toBe(true)
    expect(new Decimal(result.value.data.adverseDistance).gt('0')).toBe(true)
  })

  it('kills a denominator mutant by locking the isolated long root', () => {
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
            isolatedMarginValue: '200',
            marginRemoval: 'allowed',
          },
          marginTiers: singleTier,
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(
      new Decimal(result.value.data.liquidationPrice).eq(
        '84.21052631578947368421052631578947368421',
      ),
    ).toBe(true)
    expect(new Decimal(result.value.data.liquidationPrice).eq('85')).toBe(false)
  })

  it('kills a lower-tier-inclusion mutant at an exact tier boundary', () => {
    const result = calculatePerpLiquidationPrice({
      targetAsset: btc,
      crossAccountValue: '0',
      positions: [
        {
          asset: btc,
          signedSize: '10',
          entryPrice: '120',
          markPrice: '120',
          marginMode: {
            kind: 'isolated',
            isolatedMarginValue: '250',
            marginRemoval: 'allowed',
          },
          marginTiers: twoTiers,
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.liquidationPrice).toBe('100')
    expect(result.value.data.selectedTier.index).toBe(1)
    expect(result.value.data.selectedTier.index).not.toBe(0)
  })

  it('kills an isolated-double-count mutant in cross liquidation', () => {
    const smallIsolated = calculatePerpLiquidationPrice({
      targetAsset: btc,
      crossAccountValue: '300',
      positions: [
        {
          asset: btc,
          signedSize: '10',
          entryPrice: '100',
          markPrice: '100',
          marginMode: { kind: 'cross' },
          marginTiers: singleTier,
        },
        {
          asset: eth,
          signedSize: '1',
          entryPrice: '100',
          markPrice: '100',
          marginMode: {
            kind: 'isolated',
            isolatedMarginValue: '100',
            marginRemoval: 'allowed',
          },
          marginTiers: singleTier,
        },
      ],
    })
    const largeIsolated = calculatePerpLiquidationPrice({
      targetAsset: btc,
      crossAccountValue: '300',
      positions: [
        {
          asset: btc,
          signedSize: '10',
          entryPrice: '100',
          markPrice: '100',
          marginMode: { kind: 'cross' },
          marginTiers: singleTier,
        },
        {
          asset: eth,
          signedSize: '1',
          entryPrice: '100',
          markPrice: '100',
          marginMode: {
            kind: 'isolated',
            isolatedMarginValue: '1000000',
            marginRemoval: 'allowed',
          },
          marginTiers: singleTier,
        },
      ],
    })

    expect(smallIsolated.value.status).toBe('ok')
    expect(largeIsolated.value.status).toBe('ok')
    if (smallIsolated.value.status !== 'ok' || largeIsolated.value.status !== 'ok') return
    expect(largeIsolated.value.data.liquidationPrice).toBe(
      smallIsolated.value.data.liquidationPrice,
    )
  })
})
