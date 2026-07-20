import { Decimal } from 'decimal.js'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { calculatePerpLiquidationPrice } from '../../../src/liquidation/index.js'

const targetAsset = {
  network: 'mainnet',
  marketKind: 'perp',
  dex: null,
  index: 0,
} as const

const tiers = [
  { lowerBound: '0', maxLeverage: '10' },
  { lowerBound: '1000', maxLeverage: '5' },
] as const

function isolatedResult(signedSize: string, isolatedMarginValue: string) {
  return calculatePerpLiquidationPrice({
    targetAsset,
    crossAccountValue: '0',
    positions: [
      {
        asset: targetAsset,
        signedSize,
        entryPrice: '100',
        markPrice: '100',
        marginMode: {
          kind: 'isolated',
          isolatedMarginValue,
          marginRemoval: 'allowed',
        },
        marginTiers: tiers,
      },
    ],
  })
}

describe('liquidation properties', () => {
  it('moves an isolated long liquidation price down when margin increases', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 101, max: 500 }),
        fc.integer({ min: 1, max: 500 }),
        (baseMargin, extraMargin) => {
          fc.pre(baseMargin + extraMargin < 1000)
          const lowerMargin = isolatedResult('10', baseMargin.toString())
          const higherMargin = isolatedResult('10', (baseMargin + extraMargin).toString())

          expect(lowerMargin.value.status).toBe('ok')
          expect(higherMargin.value.status).toBe('ok')
          if (lowerMargin.value.status !== 'ok' || higherMargin.value.status !== 'ok') return
          expect(
            new Decimal(higherMargin.value.data.liquidationPrice).lte(
              lowerMargin.value.data.liquidationPrice,
            ),
          ).toBe(true)
        },
      ),
    )
  })

  it('moves an isolated short liquidation price up when margin increases', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 101, max: 500 }),
        fc.integer({ min: 1, max: 500 }),
        (baseMargin, extraMargin) => {
          const lowerMargin = isolatedResult('-10', baseMargin.toString())
          const higherMargin = isolatedResult('-10', (baseMargin + extraMargin).toString())

          expect(lowerMargin.value.status).toBe('ok')
          expect(higherMargin.value.status).toBe('ok')
          if (lowerMargin.value.status !== 'ok' || higherMargin.value.status !== 'ok') return
          expect(
            new Decimal(higherMargin.value.data.liquidationPrice).gte(
              lowerMargin.value.data.liquidationPrice,
            ),
          ).toBe(true)
        },
      ),
    )
  })

  it('returns a tier candidate whose root selects the same tier by notional', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 25 }),
        fc.integer({ min: 80, max: 160 }),
        fc.integer({ min: 60, max: 700 }),
        (size, mark, margin) => {
          const result = calculatePerpLiquidationPrice({
            targetAsset,
            crossAccountValue: '0',
            positions: [
              {
                asset: targetAsset,
                signedSize: size.toString(),
                entryPrice: mark.toString(),
                markPrice: mark.toString(),
                marginMode: {
                  kind: 'isolated',
                  isolatedMarginValue: margin.toString(),
                  marginRemoval: 'allowed',
                },
                marginTiers: tiers,
              },
            ],
          })

          if (result.value.status !== 'ok') return
          expect(result.value.data.backstopPrice).not.toBeNull()
          expect(result.value.data.backstopMaintenanceThreshold).not.toBeNull()
          expect(
            new Decimal(result.value.data.accountEquityAtLiquidation)
              .minus(result.value.data.totalAccountMaintenanceMargin)
              .abs()
              .lte('1e-35'),
          ).toBe(true)
          const notional = new Decimal(result.value.data.liquidationNotional)
          const selectedIndex = result.value.data.selectedTier.index
          if (notional.gte(1000)) {
            expect(selectedIndex).toBe(1)
          } else {
            expect(selectedIndex).toBe(0)
          }
        },
      ),
    )
  })
})
