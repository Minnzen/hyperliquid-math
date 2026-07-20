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
})
