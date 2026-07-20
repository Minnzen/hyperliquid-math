import { Decimal } from 'decimal.js'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Decimal40 } from '../../../src/core/decimal.js'
import { calculateBookMetrics, simulateBookFill } from '../../../src/orderbook/index.js'

const decimalString = fc
  .integer({ min: 1, max: 10_000_000 })
  .map((cents) => new Decimal40(cents).div(100).toFixed())

function level(px: string, sz: string, n = 1) {
  return { px, sz, n }
}

describe('orderbook properties', () => {
  it('computes midpoint exactly between best bid and best ask for generated books', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 101, max: 10_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        decimalString,
        (bestBidCents, gapCents, size) => {
          const bestBid = new Decimal40(bestBidCents).div(100)
          const bestAsk = bestBid.plus(new Decimal40(gapCents).div(100))
          const result = calculateBookMetrics({
            levels: [
              [level(bestBid.toFixed(), size), level(bestBid.minus(1).toFixed(), size)],
              [level(bestAsk.toFixed(), size), level(bestAsk.plus(1).toFixed(), size)],
            ],
          })

          expect(result.value.status).toBe('ok')
          if (result.value.status !== 'ok') return

          const mid = new Decimal(result.value.data.mid)
          expect(mid.minus(bestBid).toFixed()).toBe(bestAsk.minus(mid).toFixed())
          expect(result.value.data.spread).toBe(bestAsk.minus(bestBid).toFixed())
        },
      ),
      { numRuns: 300 },
    )
  })

  it('never fills more than requested or available size for generated size requests', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 200_000 }),
        (firstLevelUnits, secondLevelUnits, requestUnits) => {
          const firstSize = new Decimal40(firstLevelUnits).div(1000)
          const secondSize = new Decimal40(secondLevelUnits).div(1000)
          const requested = new Decimal40(requestUnits).div(1000)
          const available = firstSize.plus(secondSize)
          const result = simulateBookFill({
            levels: [
              [level('99', firstSize.toFixed()), level('98', secondSize.toFixed())],
              [level('101', firstSize.toFixed()), level('102', secondSize.toFixed())],
            ],
            side: 'buy',
            amount: { kind: 'size', value: requested.toFixed() },
            referencePrice: '100',
          })

          expect(result.value.status).toBe('ok')
          if (result.value.status !== 'ok') return

          const filled = new Decimal(result.value.data.filledSize)
          expect(filled.lte(requested)).toBe(true)
          expect(filled.lte(available)).toBe(true)
          expect(new Decimal(result.value.data.unfilledAmount).plus(filled).toFixed()).toBe(
            requested.toFixed(),
          )
        },
      ),
      { numRuns: 300 },
    )
  })
})
