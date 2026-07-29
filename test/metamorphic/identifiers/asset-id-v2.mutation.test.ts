import { describe, expect, it } from 'vitest'
import { decodeAssetId, encodeAssetId } from '../../../src/identifiers/index.js'

describe('outcome asset ID v2 directed mutation-kill vectors', () => {
  it('uses the ones digit for side and advances outcomes in blocks of ten', () => {
    const outcome7Side0 = encodeAssetId({ kind: 'outcome', outcome: 7, side: 0 } as never)
    const outcome7Side1 = encodeAssetId({ kind: 'outcome', outcome: 7, side: 1 } as never)
    const outcome8Side0 = encodeAssetId({ kind: 'outcome', outcome: 8, side: 0 } as never)

    expect(outcome7Side0.value).toEqual({ status: 'ok', data: 100_000_070 })
    expect(outcome7Side1.value).toEqual({ status: 'ok', data: 100_000_071 })
    expect(outcome8Side0.value).toEqual({ status: 'ok', data: 100_000_080 })
  })

  it.each([2, 3, 4, 5, 6, 7, 8, 9])(
    'rejects undocumented outcome side digit %i instead of guessing',
    (sideDigit) => {
      expect(decodeAssetId({ assetId: 100_000_000 + sideDigit }).value).toMatchObject({
        status: 'invalid-input',
        issues: [
          expect.objectContaining({
            code: 'invalid-outcome-side-encoding',
            path: '/assetId',
          }),
        ],
      })
    },
  )

  it('rejects the first outcome whose encoded ID exceeds JSON safe integer precision', () => {
    expect(
      encodeAssetId({
        kind: 'outcome',
        outcome: 900_719_915_474_100,
        side: 0,
      } as never).value.status,
    ).toBe('invalid-input')
  })

  it('preserves the stable v1 byte encodings below the outcome range', () => {
    expect(encodeAssetId({ kind: 'perp', index: 9_999 }).value).toEqual({
      status: 'ok',
      data: 9_999,
    })
    expect(encodeAssetId({ kind: 'spot', index: 89_999 }).value).toEqual({
      status: 'ok',
      data: 99_999,
    })
    expect(encodeAssetId({ kind: 'hip3-perp', dexIndex: 9_989, index: 9_999 }).value).toEqual({
      status: 'ok',
      data: 99_999_999,
    })
  })
})
