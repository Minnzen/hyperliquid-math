import { Decimal } from 'decimal.js'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  calculatePerpMaxOrderSize,
  calculatePerpSlippagePrice,
  evaluatePerpReduceOnly,
} from '../../../src/orders/index.js'

const maxOrderSeed = 0x4d4001
const slippageSeed = 0x4d4002
const reduceOnlySeed = 0x4d4003

const unavailableOrderValueLimit = {
  kind: 'not-supported',
  reason: { code: 'rule-not-in-snapshot', path: '/orderValueLimit' },
} as const

function d(value: string) {
  return new Decimal(value)
}

function decimalFromUnits(units: bigint, scale: Decimal.Value) {
  return new Decimal(units.toString()).div(scale).toFixed()
}

describe('orders properties', () => {
  it('keeps max-size direction symmetric for mirrored long and short reducing orders', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        fc.integer({ min: 1, max: 50 }),
        fc.bigInt({ min: 1n, max: 10_000_000n }),
        fc.boolean(),
        (positionUnits, collateralUnits, leverage, priceCents, reduceOnly) => {
          const positionSize = decimalFromUnits(positionUnits, 1_000n)
          const availableCollateral = decimalFromUnits(collateralUnits, 100n)
          const referencePrice = decimalFromUnits(priceCents, 100n)
          const orderValueLimit = d(positionSize)
            .plus(availableCollateral)
            .times(referencePrice)
            .times(leverage + 1)
            .toFixed()

          const longSell = calculatePerpMaxOrderSize({
            availableCollateral,
            leverage: leverage.toString(),
            referencePrice,
            currentSignedSize: positionSize,
            side: 'sell',
            reduceOnly,
            szDecimals: 3,
            orderValueLimit: { kind: 'available', value: orderValueLimit },
          })
          const shortBuy = calculatePerpMaxOrderSize({
            availableCollateral,
            leverage: leverage.toString(),
            referencePrice,
            currentSignedSize: d(positionSize).negated().toFixed(),
            side: 'buy',
            reduceOnly,
            szDecimals: 3,
            orderValueLimit: { kind: 'available', value: orderValueLimit },
          })

          expect(longSell.value.status).toBe('ok')
          expect(shortBuy.value.status).toBe('ok')
          if (longSell.value.status !== 'ok' || shortBuy.value.status !== 'ok') return
          expect(longSell.value.data.reducibleSize).toBe(shortBuy.value.data.reducibleSize)
          expect(longSell.value.data.collateralBoundSize).toBe(
            shortBuy.value.data.collateralBoundSize,
          )
          expect(longSell.value.data.localUpperBoundSize).toBe(
            shortBuy.value.data.localUpperBoundSize,
          )
        },
      ),
      { numRuns: 300, seed: maxOrderSeed },
    )
  })

  it('returns a local upper bound no greater than any available max-size component', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10_000_000n }),
        fc.integer({ min: 1, max: 50 }),
        fc.bigInt({ min: 1n, max: 10_000_000n }),
        fc.bigInt({ min: -1_000_000n, max: 1_000_000n }),
        fc.constantFrom('buy', 'sell'),
        fc.boolean(),
        fc.bigInt({ min: 1n, max: 10_000_000n }),
        (collateralCents, leverage, priceCents, signedSizeUnits, side, reduceOnly, limitCents) => {
          const availableCollateral = decimalFromUnits(collateralCents, 100n)
          const referencePrice = decimalFromUnits(priceCents, 100n)
          const currentSignedSize = decimalFromUnits(signedSizeUnits, 1_000n)
          const orderValueLimit = decimalFromUnits(limitCents, 100n)

          const result = calculatePerpMaxOrderSize({
            availableCollateral,
            leverage: leverage.toString(),
            referencePrice,
            currentSignedSize,
            side,
            reduceOnly,
            szDecimals: 3,
            orderValueLimit: { kind: 'available', value: orderValueLimit },
          })

          expect(result.value.status).toBe('ok')
          if (result.value.status !== 'ok') return
          const upperBound = d(result.value.data.localUpperBoundSize)
          expect(upperBound.lte(result.value.data.collateralBoundSize)).toBe(true)
          expect(upperBound.lte(result.value.data.orderValueBoundSize ?? '0')).toBe(true)
          expect(upperBound.decimalPlaces()).toBeLessThanOrEqual(3)
        },
      ),
      { numRuns: 300, seed: maxOrderSeed + 1 },
    )
  })

  it('never leaks opening capacity into reduce-only wrong-side or flat requests', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.integer({ min: 1, max: 50 }),
        fc.bigInt({ min: 1n, max: 10_000_000n }),
        (positionUnits, collateralUnits, leverage, priceCents) => {
          const currentSignedSize = decimalFromUnits(positionUnits, 1_000n)
          const result = calculatePerpMaxOrderSize({
            availableCollateral: decimalFromUnits(collateralUnits, 100n),
            leverage: leverage.toString(),
            referencePrice: decimalFromUnits(priceCents, 100n),
            currentSignedSize,
            side: 'buy',
            reduceOnly: true,
            szDecimals: 3,
            orderValueLimit: unavailableOrderValueLimit,
          })

          expect(result.value.status).toBe('ok')
          if (result.value.status !== 'ok') return
          expect(result.value.data.reducibleSize).toBe('0')
          expect(result.value.data.collateralBoundSize).toBe('0')
          expect(result.value.data.localUpperBoundSize).toBe('0')
        },
      ),
      { numRuns: 300, seed: reduceOnlySeed },
    )
  })

  it('classifies reduce-only transitions symmetrically around zero position', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.bigInt({ min: 1n, max: 1_500_000n }),
        (positionUnits, requestUnits) => {
          const positionSize = decimalFromUnits(positionUnits, 1_000n)
          const requestedSize = decimalFromUnits(requestUnits, 1_000n)
          const expected =
            requestUnits < positionUnits
              ? 'reduce'
              : requestUnits === positionUnits
                ? 'close'
                : 'would-flip'

          const longSell = evaluatePerpReduceOnly({
            currentSignedSize: positionSize,
            side: 'sell',
            requestedSize,
          })
          const shortBuy = evaluatePerpReduceOnly({
            currentSignedSize: d(positionSize).negated().toFixed(),
            side: 'buy',
            requestedSize,
          })

          expect(longSell.value.status).toBe('ok')
          expect(shortBuy.value.status).toBe('ok')
          if (longSell.value.status !== 'ok' || shortBuy.value.status !== 'ok') return
          expect(longSell.value.data.requestedEffect).toBe(expected)
          expect(shortBuy.value.data.requestedEffect).toBe(expected)
          expect(longSell.value.data.acceptedTransitionSize).toBe(
            shortBuy.value.data.acceptedTransitionSize,
          )
          expect(longSell.value.data.check.status).toBe(shortBuy.value.data.check.status)
        },
      ),
      { numRuns: 300, seed: reduceOnlySeed + 1 },
    )
  })

  it('rounds slippage boundaries conservatively relative to the raw price on both sides', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10_000_000_000n }),
        fc.bigInt({ min: 0n, max: 99_999n }),
        fc.integer({ min: 0, max: 6 }),
        (priceUnits, slippageTenthsBps, szDecimals) => {
          const referencePrice = decimalFromUnits(priceUnits, 1_000n)
          const slippageBps = decimalFromUnits(slippageTenthsBps, 10n)

          const buy = calculatePerpSlippagePrice({
            side: 'buy',
            referencePrice,
            slippageBps,
            szDecimals,
          })
          const sell = calculatePerpSlippagePrice({
            side: 'sell',
            referencePrice,
            slippageBps,
            szDecimals,
          })

          if (buy.value.status === 'invalid-input') {
            expect(buy.value.issues).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  code: expect.stringMatching(/^(rounded-to-zero|no-valid-protection-price)$/),
                }),
              ]),
            )
          } else {
            expect(buy.value.status).toBe('ok')
            if (buy.value.status === 'ok') {
              expect(d(buy.value.data.protectionPrice).gt(0)).toBe(true)
              expect(d(buy.value.data.protectionPrice).lte(buy.value.data.rawPrice)).toBe(true)
              expect(d(buy.value.data.protectionPrice).gte(referencePrice)).toBe(true)
            }
          }
          if (sell.value.status === 'invalid-input') {
            expect(sell.value.issues).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ code: 'no-valid-protection-price' }),
              ]),
            )
            return
          }
          expect(sell.value.status).toBe('ok')
          if (sell.value.status !== 'ok') return
          expect(d(sell.value.data.protectionPrice).gt(0)).toBe(true)
          expect(d(sell.value.data.protectionPrice).gte(sell.value.data.rawPrice)).toBe(true)
          expect(d(sell.value.data.protectionPrice).lte(referencePrice)).toBe(true)
        },
      ),
      { numRuns: 300, seed: slippageSeed },
    )
  })
})
