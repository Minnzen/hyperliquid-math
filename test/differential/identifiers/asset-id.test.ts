import { describe, expect, it } from 'vitest'
import { decodeAssetId, encodeAssetId } from '../../../src/identifiers/index.js'

const documentedOracleCases = [
  [{ kind: 'perp', index: 0 }, 0],
  [{ kind: 'perp', index: 9_999 }, 9_999],
  [{ kind: 'spot', index: 0 }, 10_000],
  [{ kind: 'spot', index: 89_999 }, 99_999],
  [{ kind: 'hip3-perp', dexIndex: 1, index: 0 }, 110_000],
  [{ kind: 'hip3-perp', dexIndex: 9_989, index: 9_999 }, 99_999_999],
  [{ kind: 'outcome', outcome: 0, side: 0 }, 100_000_000],
  [{ kind: 'outcome', outcome: 1, side: 0 }, 100_000_010],
  [{ kind: 'outcome', outcome: 1, side: 1 }, 100_000_011],
] as const

const documentedDecodeCases = documentedOracleCases.map(
  ([decoded, assetId]) => [assetId, decoded] as const,
)

describe('asset ID documented oracle cases', () => {
  it.each(documentedOracleCases)('matches encode oracle for %j', (input, expectedAssetId) => {
    expect(encodeAssetId(input as never).value).toEqual({ status: 'ok', data: expectedAssetId })
  })

  it.each(documentedDecodeCases)('matches decode oracle for %i', (assetId, expectedDecoded) => {
    expect(decodeAssetId({ assetId }).value).toEqual({ status: 'ok', data: expectedDecoded })
  })
})
