import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Decimal40 } from '../../../src/core/decimal.js'
import {
  calculatePerpInitialMargin,
  calculatePerpMaintenanceMargin,
  evaluatePerpAccountMargin,
} from '../../../src/margin/index.js'

const asset = { network: 'mainnet', marketKind: 'perp', dex: null, index: 0 } as const
const tiers = [
  { lowerBound: '0', maxLeverage: '10' },
  { lowerBound: '1000', maxLeverage: '5' },
] as const

describe('margin properties', () => {
  it('calculates identical initial margin for equal long and short notionals', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.integer({ min: 1, max: 10 }),
        (size, mark, leverage) => {
          const long = calculatePerpInitialMargin({
            position: {
              asset,
              signedSize: size.toString(),
              markPrice: mark.toString(),
              leverage: leverage.toString(),
              marginMode: { kind: 'cross' },
              marginTiers: tiers,
            },
          })
          const short = calculatePerpInitialMargin({
            position: {
              asset,
              signedSize: (-size).toString(),
              markPrice: mark.toString(),
              leverage: leverage.toString(),
              marginMode: { kind: 'cross' },
              marginTiers: tiers,
            },
          })

          expect(long.value.status).toBe('ok')
          expect(short.value.status).toBe('ok')
          if (long.value.status !== 'ok' || short.value.status !== 'ok') return
          expect(long.value.data.initialMargin).toBe(short.value.data.initialMargin)
          expect(long.value.data.transferMarginRequirement).toBe(
            short.value.data.transferMarginRequirement,
          )
        },
      ),
    )
  })

  it('never decreases cross maintenance margin when a cross position grows at the same mark', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000n }),
        fc.bigInt({ min: 1n, max: 1_000n }),
        fc.bigInt({ min: 1n, max: 1_000n }),
        (firstSize, extraSize, mark) => {
          const first = calculatePerpMaintenanceMargin({
            position: {
              asset,
              signedSize: firstSize.toString(),
              markPrice: mark.toString(),
              leverage: '5',
              marginMode: { kind: 'cross' },
              marginTiers: tiers,
            },
          })
          const grown = calculatePerpMaintenanceMargin({
            position: {
              asset,
              signedSize: (firstSize + extraSize).toString(),
              markPrice: mark.toString(),
              leverage: '5',
              marginMode: { kind: 'cross' },
              marginTiers: tiers,
            },
          })

          expect(first.value.status).toBe('ok')
          expect(grown.value.status).toBe('ok')
          if (first.value.status !== 'ok' || grown.value.status !== 'ok') return
          expect(
            new Decimal40(grown.value.data.maintenanceMargin).greaterThanOrEqualTo(
              first.value.data.maintenanceMargin,
            ),
          ).toBe(true)
        },
      ),
    )
  })

  it('keeps isolated notional out of cross transfer requirements', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000n }),
        fc.bigInt({ min: 1n, max: 1_000n }),
        fc.bigInt({ min: 1n, max: 1_000n }),
        (crossSize, isolatedSize, mark) => {
          const crossOnly = evaluatePerpAccountMargin({
            crossAccountValue: '1000000',
            positions: [
              {
                asset,
                signedSize: crossSize.toString(),
                markPrice: mark.toString(),
                leverage: '10',
                marginMode: { kind: 'cross' },
                marginTiers: tiers,
              },
            ],
          })
          const withIsolated = evaluatePerpAccountMargin({
            crossAccountValue: '1000000',
            positions: [
              {
                asset,
                signedSize: crossSize.toString(),
                markPrice: mark.toString(),
                leverage: '10',
                marginMode: { kind: 'cross' },
                marginTiers: tiers,
              },
              {
                asset: { network: 'mainnet', marketKind: 'perp', dex: null, index: 1 },
                signedSize: isolatedSize.toString(),
                markPrice: mark.toString(),
                leverage: '5',
                marginMode: {
                  kind: 'isolated',
                  isolatedMarginValue: '1000000',
                  marginRemoval: 'strict',
                },
                marginTiers: tiers,
              },
            ],
          })

          expect(crossOnly.value.status).toBe('ok')
          expect(withIsolated.value.status).toBe('ok')
          if (crossOnly.value.status !== 'ok' || withIsolated.value.status !== 'ok') return
          expect(withIsolated.value.data.cross.transferMarginRequirement).toBe(
            crossOnly.value.data.cross.transferMarginRequirement,
          )
          expect(withIsolated.value.data.cross.positionValue).toBe(
            crossOnly.value.data.cross.positionValue,
          )
        },
      ),
    )
  })
})
