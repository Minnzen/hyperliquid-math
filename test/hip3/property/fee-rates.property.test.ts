import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Decimal40 } from '../../../src/core/decimal.js'
import { calculateHip3FeeRates } from '../../../src/hip3/index.js'

function fixedMicros(value: bigint, denominator = 1_000_000n): string {
  return new Decimal40(value.toString()).div(denominator.toString()).toFixed()
}

describe('HIP-3 fee rate properties', () => {
  it('keeps positive maker and taker rates monotonic in deployer fee scale below one', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000n }),
        fc.bigInt({ min: 1n, max: 1_000n }),
        fc.bigInt({ min: 0n, max: 500_000n }),
        fc.bigInt({ min: 0n, max: 999_998n }),
        (makerMicros, takerMicros, discountMicros, scaleMicros) => {
          const lowerScale = fixedMicros(scaleMicros)
          const higherScale = fixedMicros(scaleMicros + 1n)
          const common = {
            makerRate: fixedMicros(makerMicros),
            takerRate: fixedMicros(takerMicros),
            activeReferralDiscount: fixedMicros(discountMicros),
            isAlignedQuoteToken: false,
            growthMode: false,
          }

          const lower = calculateHip3FeeRates({ ...common, deployerFeeScale: lowerScale })
          const higher = calculateHip3FeeRates({ ...common, deployerFeeScale: higherScale })

          expect(lower.value.status).toBe('ok')
          expect(higher.value.status).toBe('ok')
          if (lower.value.status !== 'ok' || higher.value.status !== 'ok') return
          expect(
            new Decimal40(higher.value.data.effectiveMakerRate).gte(
              lower.value.data.effectiveMakerRate,
            ),
          ).toBe(true)
          expect(
            new Decimal40(higher.value.data.effectiveTakerRate).gte(
              lower.value.data.effectiveTakerRate,
            ),
          ).toBe(true)
        },
      ),
    )
  })

  it('keeps negative maker rebates independent of referral discount when quotes are not aligned', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -1_000n, max: -1n }),
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        fc.bigInt({ min: 0n, max: 3_000_000n }),
        (makerMicros, discountMicros, scaleMicros) => {
          const common = {
            makerRate: fixedMicros(makerMicros),
            takerRate: '0.0004',
            isAlignedQuoteToken: false,
            deployerFeeScale: fixedMicros(scaleMicros),
            growthMode: false,
          }

          const discounted = calculateHip3FeeRates({
            ...common,
            activeReferralDiscount: fixedMicros(discountMicros),
          })
          const undiscounted = calculateHip3FeeRates({
            ...common,
            activeReferralDiscount: '0',
          })

          expect(discounted.value.status).toBe('ok')
          expect(undiscounted.value.status).toBe('ok')
          if (discounted.value.status !== 'ok' || undiscounted.value.status !== 'ok') return
          expect(discounted.value.data.effectiveMakerRate).toBe(
            undiscounted.value.data.effectiveMakerRate,
          )
        },
      ),
    )
  })

  it('keeps growth mode equal to one tenth of non-growth positive effective rates', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000n }),
        fc.bigInt({ min: 1n, max: 1_000n }),
        fc.bigInt({ min: 0n, max: 500_000n }),
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        (makerMicros, takerMicros, discountMicros, scaleMicros) => {
          const common = {
            makerRate: fixedMicros(makerMicros),
            takerRate: fixedMicros(takerMicros),
            activeReferralDiscount: fixedMicros(discountMicros),
            isAlignedQuoteToken: true,
            deployerFeeScale: fixedMicros(scaleMicros),
          }

          const growth = calculateHip3FeeRates({ ...common, growthMode: true })
          const normal = calculateHip3FeeRates({ ...common, growthMode: false })

          expect(growth.value.status).toBe('ok')
          expect(normal.value.status).toBe('ok')
          if (growth.value.status !== 'ok' || normal.value.status !== 'ok') return
          expect(new Decimal40(normal.value.data.effectiveMakerRate).div(10).toFixed()).toBe(
            growth.value.data.effectiveMakerRate,
          )
          expect(new Decimal40(normal.value.data.effectiveTakerRate).div(10).toFixed()).toBe(
            growth.value.data.effectiveTakerRate,
          )
        },
      ),
    )
  })
})
