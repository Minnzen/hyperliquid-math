import { Decimal } from 'decimal.js'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { calculateTradeFee, calculateWeightedFeeVolume } from '../../../src/fees/index.js'

describe('fee properties', () => {
  it('keeps an explicit fee linear when size is split', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.bigInt({ min: -1_000n, max: 1_000n }),
        (firstSize, secondSize, rateMicros) => {
          const rate = new Decimal(rateMicros.toString()).div(1_000_000).toFixed()
          const first = calculateTradeFee({ price: '17', size: firstSize.toString(), rate })
          const second = calculateTradeFee({ price: '17', size: secondSize.toString(), rate })
          const combined = calculateTradeFee({
            price: '17',
            size: (firstSize + secondSize).toString(),
            rate,
          })

          expect(first.value.status).toBe('ok')
          expect(second.value.status).toBe('ok')
          expect(combined.value.status).toBe('ok')
          if (
            first.value.status !== 'ok' ||
            second.value.status !== 'ok' ||
            combined.value.status !== 'ok'
          ) {
            return
          }

          expect(
            new Decimal(first.value.data.feeAmount).plus(second.value.data.feeAmount).toFixed(),
          ).toBe(combined.value.data.feeAmount)
        },
      ),
    )
  })

  it('equals perps volume plus twice spot volume', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000_000n }),
        fc.bigInt({ min: 0n, max: 1_000_000_000n }),
        (perps, spot) => {
          const result = calculateWeightedFeeVolume({
            perpsVolume: perps.toString(),
            spotVolume: spot.toString(),
          })
          expect(result.value).toEqual({
            status: 'ok',
            data: { weightedVolume: (perps + 2n * spot).toString() },
          })
        },
      ),
    )
  })
})
