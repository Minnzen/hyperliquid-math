import { Decimal } from 'decimal.js'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { quantizePrice, quantizeSize } from '../../../src/precision/index.js'

const Decimal40 = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN })

function canonical(decimal: Decimal): string {
  return decimal.isZero() ? '0' : decimal.toFixed()
}

function positiveDecimalString(maxFractionDigits: number) {
  return fc
    .tuple(
      fc.integer({ min: 0, max: 1_000_000_000 }),
      fc.integer({ min: 0, max: 10 ** maxFractionDigits - 1 }),
    )
    .filter(([whole, fraction]) => whole > 0 || fraction > 0)
    .map(([whole, fraction]) => `${whole}.${fraction.toString().padStart(maxFractionDigits, '0')}`)
}

describe('quantizePrice properties', () => {
  it('is idempotent after successful quantization', () => {
    fc.assert(
      fc.property(
        positiveDecimalString(10),
        fc.constantFrom('perp' as const, 'spot' as const),
        fc.integer({ min: 0, max: 6 }),
        fc.constantFrom('down' as const, 'up' as const),
        (value, marketKind, rawSzDecimals, rounding) => {
          const maxSzDecimals = marketKind === 'perp' ? 6 : 8
          const szDecimals = Math.min(rawSzDecimals, maxSzDecimals)
          const first = quantizePrice({ value, marketKind, szDecimals, rounding })
          if (first.value.status !== 'ok') return
          const second = quantizePrice({
            value: first.value.data.value,
            marketKind,
            szDecimals,
            rounding,
          })
          expect(second.value).toEqual({
            status: 'ok',
            data: { value: first.value.data.value, precisionChanged: false },
          })
        },
      ),
      { numRuns: 1_000 },
    )
  })

  it('matches a Decimal reference model', () => {
    fc.assert(
      fc.property(
        positiveDecimalString(10),
        fc.constantFrom('perp' as const, 'spot' as const),
        fc.integer({ min: 0, max: 6 }),
        fc.constantFrom('down' as const, 'up' as const),
        (value, marketKind, rawSzDecimals, rounding) => {
          const maxDecimals = marketKind === 'perp' ? 6 : 8
          const szDecimals = Math.min(rawSzDecimals, maxDecimals)
          const mode = rounding === 'down' ? Decimal.ROUND_DOWN : Decimal.ROUND_UP
          const decimalPlaces = maxDecimals - szDecimals
          const decimalRounded = new Decimal40(value).toDecimalPlaces(decimalPlaces, mode)
          const significantFigureCandidate = decimalRounded.isInteger()
            ? decimalRounded
            : decimalRounded.toSignificantDigits(5, mode)
          const integerCandidate = new Decimal40(value).toDecimalPlaces(0, mode)
          const expectedDecimal =
            rounding === 'down'
              ? Decimal40.max(significantFigureCandidate, integerCandidate)
              : Decimal40.min(significantFigureCandidate, integerCandidate)

          const result = quantizePrice({ value, marketKind, szDecimals, rounding })
          if (expectedDecimal.isZero()) {
            expect(result.value.status).toBe('invalid-input')
          } else {
            expect(result.value).toEqual({
              status: 'ok',
              data: {
                value: canonical(expectedDecimal),
                precisionChanged: !new Decimal40(value).equals(expectedDecimal),
              },
            })
          }
        },
      ),
      { numRuns: 1_000 },
    )
  })
})

describe('quantizeSize properties', () => {
  it('is idempotent after successful quantization', () => {
    fc.assert(
      fc.property(
        positiveDecimalString(10),
        fc.integer({ min: 0, max: 8 }),
        (value, szDecimals) => {
          const first = quantizeSize({ value, szDecimals })
          if (first.value.status !== 'ok') return
          const second = quantizeSize({ value: first.value.data.value, szDecimals })
          expect(second.value).toEqual({
            status: 'ok',
            data: { value: first.value.data.value, precisionChanged: false },
          })
        },
      ),
      { numRuns: 1_000 },
    )
  })

  it('never increases positive exposure', () => {
    fc.assert(
      fc.property(
        positiveDecimalString(10),
        fc.integer({ min: 0, max: 8 }),
        (value, szDecimals) => {
          const result = quantizeSize({ value, szDecimals })
          if (result.value.status !== 'ok') return
          expect(new Decimal40(result.value.data.value).lessThanOrEqualTo(value)).toBe(true)
        },
      ),
      { numRuns: 1_000 },
    )
  })
})
