import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decodeAssetId, encodeAssetId } from '../../../src/identifiers/index.js'

describe('asset ID properties', () => {
  it('round-trips supported encoded identifiers', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.record({ kind: fc.constant('perp'), index: fc.integer({ min: 0, max: 9_999 }) }),
          fc.record({ kind: fc.constant('spot'), index: fc.integer({ min: 0, max: 89_999 }) }),
          fc.record({
            kind: fc.constant('hip3-perp'),
            dexIndex: fc.integer({ min: 1, max: 9_989 }),
            index: fc.integer({ min: 0, max: 9_999 }),
          }),
          fc.record({
            kind: fc.constant('outcome'),
            outcome: fc.integer({ min: 0, max: 900_719_915_474_099 }),
            side: fc.constantFrom(0 as const, 1 as const),
          }),
        ),
        (input) => {
          const encoded = encodeAssetId(input)
          expect(encoded.value.status).toBe('ok')
          if (encoded.value.status !== 'ok') return

          const decoded = decodeAssetId({ assetId: encoded.value.data })
          expect(decoded.value).toEqual({ status: 'ok', data: input })
        },
      ),
      { numRuns: 1_000 },
    )
  })

  it('uses the final decimal digit only for the binary outcome side', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 900_719_915_474_099 }),
        fc.constantFrom(0 as const, 1 as const),
        (outcome, side) => {
          const encoded = encodeAssetId({ kind: 'outcome', outcome, side } as never)
          expect(encoded.value.status).toBe('ok')
          if (encoded.value.status !== 'ok') return

          expect(encoded.value.data % 10).toBe(side)
          const other = encodeAssetId({ kind: 'outcome', outcome, side: 1 - side } as never)
          expect(other.value.status).toBe('ok')
          if (other.value.status !== 'ok') return
          expect(Math.abs(other.value.data - encoded.value.data)).toBe(1)
        },
      ),
    )
  })
})
