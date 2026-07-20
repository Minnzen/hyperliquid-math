import { describe, expect, it } from 'vitest'
import { decodeAssetId, encodeAssetId } from '../../../src/identifiers/index.js'

const documentedOracleCases = [
  [{ kind: 'perp', index: 0 }, 0],
  [{ kind: 'perp', index: 9_999 }, 9_999],
  [{ kind: 'spot', index: 0 }, 10_000],
  [{ kind: 'spot', index: 89_999 }, 99_999],
  [{ kind: 'hip3-perp', dexIndex: 1, index: 0 }, 110_000],
  [{ kind: 'hip3-perp', dexIndex: 9_989, index: 9_999 }, 99_999_999],
] as const

describe('asset ID documented oracle cases', () => {
  it.each(documentedOracleCases)('matches encode oracle for %j', (input, expectedAssetId) => {
    expect(encodeAssetId(input).value).toEqual({ status: 'ok', data: expectedAssetId })
  })

  it.each(documentedOracleCases)('matches decode oracle for %i', (expectedDecoded, assetId) => {
    expect(decodeAssetId({ assetId }).value).toEqual({ status: 'ok', data: expectedDecoded })
  })
})
