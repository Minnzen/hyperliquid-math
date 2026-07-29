import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Decimal40 } from '../../../src/core/decimal.js'
import {
  calculateOutcomeDualPrice,
  calculateOutcomeSettlement,
  evaluateRecurringOutcome,
} from '../../../src/hip4/index.js'

const dualSeed = 0x6_4001
const settlementSeed = 0x6_4002
const interpolationSeed = 0x6_4003
const bucketSeed = 0x6_4004

function decimalFromBasisPoints(value: number): string {
  return new Decimal40(value.toString()).div('10000').toFixed()
}

describe('HIP-4 properties', () => {
  it('keeps every valid price and its dual complementary and involutive', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (basisPoints) => {
        const price = decimalFromBasisPoints(basisPoints)
        const first = calculateOutcomeDualPrice({ price })

        expect(first.value.status).toBe('ok')
        if (first.value.status !== 'ok') return
        expect(new Decimal40(price).plus(first.value.data.dualPrice).toFixed()).toBe('1')

        const second = calculateOutcomeDualPrice({ price: first.value.data.dualPrice })
        expect(second.value).toEqual({ status: 'ok', data: { dualPrice: price } })
      }),
      { numRuns: 300, seed: dualSeed },
    )
  })

  it('keeps Yes and No payout fractions complementary for the same settlement', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (settleBasisPoints, sizeUnits) => {
          const settleFraction = decimalFromBasisPoints(settleBasisPoints)
          const size = sizeUnits.toString()
          const common = { settleFraction, size, entryPrice: '0.5' } as const
          const yes = calculateOutcomeSettlement({ ...common, tokenSide: 'yes' })
          const no = calculateOutcomeSettlement({ ...common, tokenSide: 'no' })

          expect(yes.value.status).toBe('ok')
          expect(no.value.status).toBe('ok')
          if (yes.value.status !== 'ok' || no.value.status !== 'ok') return
          expect(
            new Decimal40(yes.value.data.payoutFraction)
              .plus(no.value.data.payoutFraction)
              .toFixed(),
          ).toBe('1')
          expect(
            new Decimal40(yes.value.data.settlementValue)
              .plus(no.value.data.settlementValue)
              .toFixed(),
          ).toBe(size)
        },
      ),
      { numRuns: 300, seed: settlementSeed },
    )
  })

  it('interpolates exactly to each endpoint at the corresponding timestamp', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (mark0Units, mark1Units, duration) => {
          const markPrice0 = mark0Units.toString()
          const markPrice1 = mark1Units.toString()
          const common = {
            class: 'priceBinary',
            markPrice0,
            t0: 0,
            markPrice1,
            t1: duration,
            targetPrice: '1',
          } as const
          const atStart = evaluateRecurringOutcome({ ...common, settlementTime: 0 })
          const atEnd = evaluateRecurringOutcome({ ...common, settlementTime: duration })

          expect(atStart.value.status).toBe('ok')
          expect(atEnd.value.status).toBe('ok')
          if (atStart.value.status !== 'ok' || atEnd.value.status !== 'ok') return
          expect(atStart.value.data.interpolatedMarkPrice).toBe(markPrice0)
          expect(atEnd.value.data.interpolatedMarkPrice).toBe(markPrice1)
        },
      ),
      { numRuns: 300, seed: interpolationSeed },
    )
  })

  it('always emits a three-entry one-hot settlement vector for valid buckets', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30_000 }), (markUnits) => {
        const markPrice = markUnits.toString()
        const result = evaluateRecurringOutcome({
          class: 'priceBucket',
          markPrice0: markPrice,
          t0: 0,
          markPrice1: markPrice,
          t1: 2,
          settlementTime: 1,
          priceThresholds: ['10000', '20000'],
        })

        expect(result.value.status).toBe('ok')
        if (result.value.status !== 'ok') return
        expect(result.value.data.class).toBe('priceBucket')
        if (result.value.data.class !== 'priceBucket') return
        expect(result.value.data.settleFractions).toHaveLength(3)
        expect(
          result.value.data.settleFractions.filter((fraction: string) => fraction === '1'),
        ).toHaveLength(1)
        expect(result.value.data.settleFractions[result.value.data.settledBucket]).toBe('1')
      }),
      { numRuns: 300, seed: bucketSeed },
    )
  })
})
