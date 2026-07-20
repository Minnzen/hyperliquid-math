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

function expectDecimalClose(actual: string, expected: string) {
  expect(new Decimal(actual).minus(expected).abs().lte('0.000000000000001')).toBe(true)
}

describe('calculatePerpLiquidationPrice', () => {
  it('solves an isolated long liquidation root from frozen margin value', () => {
    const result = calculatePerpLiquidationPrice({
      targetAsset: btc,
      crossAccountValue: '999999',
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
    expect(result.value.data.assetKey).toBe('hl:mainnet:perp::0')
    expect(result.value.data.marginMode).toEqual({ kind: 'isolated', marginRemoval: 'allowed' })
    expectDecimalClose(
      result.value.data.liquidationPrice,
      '84.21052631578947368421052631578947368421',
    )
    expect(result.value.data.selectedTier).toMatchObject({
      index: 0,
      lowerBound: '0',
      maintenanceRate: '0.05',
      deduction: '0',
    })
    expectDecimalClose(
      result.value.data.adverseDistance,
      '15.78947368421052631578947368421052631579',
    )
    expectDecimalClose(
      result.value.data.adverseDistanceRatio,
      '0.1578947368421052631578947368421052631579',
    )
    expect(result.value.data.currentlyAtOrBelowMaintenance).toBe(false)
    expectDecimalClose(
      result.value.data.backstopPrice ?? '',
      '82.75862068965517241379310344827586206897',
    )
    expectDecimalClose(
      result.value.data.backstopMaintenanceThreshold ?? '',
      '27.58620689655172413793103448275862068966',
    )
    expectDecimalClose(
      result.value.data.backstopAdverseDistance ?? '',
      '17.24137931034482758620689655172413793103',
    )
    expect(result.trace).toMatchObject({
      formulaId: 'hl.liquidation-price.calculate',
      formulaVersion: 1,
      authority: 'local-exact',
      maturity: 'stable',
      completion: { status: 'complete' },
    })
    expect(result.trace.sourceRefs).toEqual(
      expect.arrayContaining([
        'HLM.SPEC.LIQUIDATION.PRICE.V1',
        'HL.DOC.LIQUIDATIONS.2026-07-19',
        'HL.DOC.MARGINING.2026-07-19',
        'HL.DOC.MARGIN_TIERS.2026-07-19',
        'DECIMALJS.10.6.0',
      ]),
    )
    expect(result.trace.assumptions).toEqual(
      expect.arrayContaining([
        { kind: 'frozen-input', path: '/positions/0/markPrice', value: '100' },
        {
          kind: 'frozen-input',
          path: '/positions/0/marginMode/isolatedMarginValue',
          value: '200',
        },
      ]),
    )
  })

  it('solves an isolated short liquidation root with positive adverse distance', () => {
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
            marginRemoval: 'strict',
          },
          marginTiers: singleTier,
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expectDecimalClose(
      result.value.data.liquidationPrice,
      '114.2857142857142857142857142857142857143',
    )
    expectDecimalClose(
      result.value.data.adverseDistance,
      '14.28571428571428571428571428571428571429',
    )
    expectDecimalClose(
      result.value.data.adverseDistanceRatio,
      '0.1428571428571428571428571428571428571429',
    )
    expect(result.value.data.marginMode).toEqual({ kind: 'isolated', marginRemoval: 'strict' })
  })

  it('selects the higher tier when the candidate root lands exactly on a lower bound', () => {
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
    expect(result.value.data.selectedTier).toMatchObject({
      index: 1,
      lowerBound: '1000',
      maintenanceRate: '0.1',
      deduction: '50',
    })
    expect(result.value.data.liquidationPrice).toBe('100')
    expect(result.value.data.liquidationNotional).toBe('1000')
  })

  it('excludes isolated positions when solving a cross target', () => {
    const withoutIsolated = calculatePerpLiquidationPrice({
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
      ],
    })
    const withIsolated = calculatePerpLiquidationPrice({
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
          signedSize: '100',
          entryPrice: '2',
          markPrice: '2',
          marginMode: {
            kind: 'isolated',
            isolatedMarginValue: '1000000',
            marginRemoval: 'allowed',
          },
          marginTiers: singleTier,
        },
      ],
    })

    expect(withoutIsolated.value.status).toBe('ok')
    expect(withIsolated.value.status).toBe('ok')
    if (withoutIsolated.value.status !== 'ok' || withIsolated.value.status !== 'ok') return
    expect(withIsolated.value.data.liquidationPrice).toBe(
      withoutIsolated.value.data.liquidationPrice,
    )
    expect(withIsolated.value.data.totalAccountMaintenanceMargin).toBe(
      withoutIsolated.value.data.totalAccountMaintenanceMargin,
    )
  })

  it('returns not-applicable when no positive finite tier-consistent root exists', () => {
    const result = calculatePerpLiquidationPrice({
      targetAsset: btc,
      crossAccountValue: '1000000',
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

    expect(result.value).toEqual({
      status: 'not-applicable',
      reason: { code: 'no-positive-tier-consistent-liquidation-root', path: '/positions/0' },
    })
    expect(result.trace.completion).toEqual({ status: 'complete' })
  })

  it('returns null backstop fields when no tier-consistent backstop root exists', () => {
    const result = calculatePerpLiquidationPrice({
      targetAsset: btc,
      crossAccountValue: '130',
      positions: [
        {
          asset: btc,
          signedSize: '1',
          entryPrice: '40',
          markPrice: '40',
          marginMode: { kind: 'cross' },
          marginTiers: singleTier,
        },
        {
          asset: eth,
          signedSize: '100',
          entryPrice: '80',
          markPrice: '80',
          marginMode: { kind: 'cross' },
          marginTiers: [{ lowerBound: '0', maxLeverage: '40' }],
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expectDecimalClose(
      result.value.data.liquidationPrice,
      '10.52631578947368421052631578947368421053',
    )
    expect(result.value.data.backstopPrice).toBeNull()
    expect(result.value.data.backstopMaintenanceThreshold).toBeNull()
    expect(result.value.data.backstopAdverseDistance).toBeNull()
    expect(result.trace.intermediates).toContainEqual({
      stepId: 'backstop-root',
      output: {
        price: null,
        tierIndex: null,
        maintenanceThreshold: null,
        reason: 'no-positive-tier-consistent-backstop-root',
      },
    })
  })

  it('rejects a missing target asset as invalid input', () => {
    const result = calculatePerpLiquidationPrice({
      targetAsset: eth,
      crossAccountValue: '200',
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

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'missing-target-asset' })]),
    )
  })

  it('rejects duplicate canonical asset rows as invalid input', () => {
    const result = calculatePerpLiquidationPrice({
      targetAsset: btc,
      crossAccountValue: '200',
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
          asset: btc,
          signedSize: '-1',
          entryPrice: '100',
          markPrice: '100',
          marginMode: { kind: 'cross' },
          marginTiers: singleTier,
        },
      ],
    })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'duplicate-asset' })]),
    )
  })
})
