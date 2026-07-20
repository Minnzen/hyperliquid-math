import { Decimal } from 'decimal.js'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { calculateFundingPayment, calculateFundingRate } from '../../../src/funding/index.js'

describe('funding properties', () => {
  it('changes payment and account delta signs when position side flips', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.bigInt({ min: -10_000n, max: 10_000n }).filter((value) => value !== 0n),
        (size, price, rateMicros) => {
          const rate = `${rateMicros < 0n ? '-' : ''}0.${String(
            rateMicros < 0n ? -rateMicros : rateMicros,
          ).padStart(6, '0')}`
          const long = calculateFundingPayment({
            signedPositionSize: size.toString(),
            oraclePrice: price.toString(),
            fundingRate: rate,
          })
          const short = calculateFundingPayment({
            signedPositionSize: (-size).toString(),
            oraclePrice: price.toString(),
            fundingRate: rate,
          })

          expect(long.value.status).toBe('ok')
          expect(short.value.status).toBe('ok')
          if (long.value.status !== 'ok' || short.value.status !== 'ok') return
          expect(short.value.data.payment).toBe(`-${long.value.data.payment}`.replace('--', ''))
          expect(long.value.data.accountValueDelta).toBe(short.value.data.payment)
          expect(short.value.data.accountValueDelta).toBe(long.value.data.payment)
        },
      ),
    )
  })

  it('never returns a rate outside the supplied hourly cap', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -10_000_000n, max: 10_000_000n }), (premiumMicros) => {
        const premium = `${premiumMicros < 0n ? '-' : ''}${
          premiumMicros < 0n ? -premiumMicros : premiumMicros
        }`
        const result = calculateFundingRate({
          averagePremiumIndex: premium,
          rules: {
            interestRate: '0.0001',
            clampLower: '-0.0005',
            clampUpper: '0.0005',
            baseIntervalHours: 8,
            hourlyCap: '0.04',
          },
        })
        expect(result.value.status).toBe('ok')
        if (result.value.status !== 'ok') return
        expect(new Decimal(result.value.data.hourlyRate).abs().lte('0.04')).toBe(true)
      }),
    )
  })
})
