import { describe, expect, it } from 'vitest'
import { decodeAssetId, encodeAssetId } from '../../../src/identifiers/index.js'

describe('encodeAssetId', () => {
  it.each([
    [{ kind: 'perp', index: 42 }, 42],
    [{ kind: 'spot', index: 3 }, 10003],
    [{ kind: 'hip3-perp', dexIndex: 7, index: 9 }, 170009],
  ])('encodes %j as %i with a complete trace', (input, expected) => {
    const result = encodeAssetId(input as Parameters<typeof encodeAssetId>[0])

    expect(result.value).toEqual({ status: 'ok', data: expected })
    expect(result.trace).toMatchObject({
      formulaId: 'hl.identifiers.asset-id.encode',
      formulaVersion: 2,
      authority: 'local-exact',
      maturity: 'stable',
      completion: { status: 'complete' },
      normalizedInputs: input,
      rounding: [],
      assumptions: [],
      sourceRefs: ['HLM.SPEC.IDENTIFIERS.ASSET_ID.V2', 'HL.DOC.ASSET_IDS.2026-07-30'],
    })
  })

  it.each([
    [{ kind: 'outcome', outcome: 0, side: 0 }, 100_000_000],
    [{ kind: 'outcome', outcome: 1, side: 0 }, 100_000_010],
    [{ kind: 'outcome', outcome: 1, side: 1 }, 100_000_011],
    [{ kind: 'outcome', outcome: 900_719_915_474_099, side: 1 }, Number.MAX_SAFE_INTEGER],
  ])('encodes documented outcome input %j as %i', (input, expected) => {
    const result = encodeAssetId(input as never)

    expect(result.value).toEqual({ status: 'ok', data: expected })
    expect(result.trace).toMatchObject({
      formulaId: 'hl.identifiers.asset-id.encode',
      formulaVersion: 2,
      authority: 'local-exact',
      maturity: 'experimental',
      completion: { status: 'complete' },
      normalizedInputs: input,
      sourceRefs: ['HLM.SPEC.IDENTIFIERS.ASSET_ID.V2', 'HL.DOC.ASSET_IDS.2026-07-30'],
    })
  })

  it.each([
    [null, ''],
    [[], ''],
    [new Date(0), ''],
    [Object.defineProperty({}, 'kind', { enumerable: false, value: 'perp' }), ''],
    [{ kind: 'perp' }, ''],
    [{ kind: 'spot', index: '1' }, '/index'],
    [{ kind: 'perp', index: 10_000 }, '/index'],
    [{ kind: 'spot', index: 90_000 }, '/index'],
    [{ kind: 'hip3-perp', dexIndex: 1 }, ''],
    [{ kind: 'hip3-perp', dexIndex: '1', index: 0 }, '/dexIndex'],
    [{ kind: 'hip3-perp', dexIndex: 1, index: '0' }, '/index'],
    [{ kind: 'hip3-perp', dexIndex: 0, index: 0 }, '/dexIndex'],
    [{ kind: 'hip3-perp', dexIndex: 9_990, index: 0 }, '/dexIndex'],
    [{ kind: 'hip3-perp', dexIndex: 1, index: 10_000 }, '/index'],
    [{ kind: 'outcome', outcome: 0 }, ''],
    [{ kind: 'outcome', outcome: 0, side: -1 }, '/side'],
    [{ kind: 'outcome', outcome: 0, side: 1.5 }, '/side'],
    [{ kind: 'outcome', outcome: 0, side: 2 }, '/side'],
    [{ kind: 'outcome', outcome: 0, side: Number.NaN }, '/side'],
    [{ kind: 'outcome', outcome: 0, side: '1' }, '/side'],
    [{ kind: 'outcome', outcome: 900_719_915_474_100, side: 0 }, '/outcome'],
  ])('rejects unsupported encode input: %j', (input, path) => {
    const result = encodeAssetId(input as unknown as Parameters<typeof encodeAssetId>[0])

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: expect.any(String), path },
    })
  })

  it('rejects uninspectable encode input as an invalid shape', () => {
    const input = new Proxy(
      { kind: 'perp', index: 0 },
      {
        getPrototypeOf() {
          throw new Error('blocked')
        },
      },
    )

    const result = encodeAssetId(input as unknown as Parameters<typeof encodeAssetId>[0])

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'invalid-input-shape', path: '' },
    })
  })
})

describe('decodeAssetId', () => {
  it.each([
    [0, { kind: 'perp', index: 0 }],
    [9_999, { kind: 'perp', index: 9_999 }],
    [10_000, { kind: 'spot', index: 0 }],
    [99_999, { kind: 'spot', index: 89_999 }],
    [110_000, { kind: 'hip3-perp', dexIndex: 1, index: 0 }],
    [170_009, { kind: 'hip3-perp', dexIndex: 7, index: 9 }],
  ])('decodes %i with a complete trace', (assetId, expected) => {
    const result = decodeAssetId({ assetId })

    expect(result.value).toEqual({ status: 'ok', data: expected })
    expect(result.trace).toMatchObject({
      formulaId: 'hl.identifiers.asset-id.decode',
      formulaVersion: 2,
      authority: 'local-exact',
      maturity: 'stable',
      completion: { status: 'complete' },
      normalizedInputs: { assetId },
      rounding: [],
      assumptions: [],
      sourceRefs: ['HLM.SPEC.IDENTIFIERS.ASSET_ID.V2', 'HL.DOC.ASSET_IDS.2026-07-30'],
    })
  })

  it.each([100_000, 109_999])('rejects the unsupported builder asset ID gap at %i', (assetId) => {
    const result = decodeAssetId({ assetId })

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'unsupported-asset-id-gap', path: '/assetId' },
    })
  })

  it.each([
    [100_000_000, { kind: 'outcome', outcome: 0, side: 0 }],
    [100_000_010, { kind: 'outcome', outcome: 1, side: 0 }],
    [100_000_011, { kind: 'outcome', outcome: 1, side: 1 }],
    [Number.MAX_SAFE_INTEGER, { kind: 'outcome', outcome: 900_719_915_474_099, side: 1 }],
  ])('decodes documented outcome asset ID %i', (assetId, expected) => {
    expect(decodeAssetId({ assetId })).toMatchObject({
      value: { status: 'ok', data: expected },
      trace: {
        formulaId: 'hl.identifiers.asset-id.decode',
        formulaVersion: 2,
        authority: 'local-exact',
        maturity: 'experimental',
        completion: { status: 'complete' },
        normalizedInputs: { assetId },
        rounding: [],
        assumptions: [],
        sourceRefs: ['HLM.SPEC.IDENTIFIERS.ASSET_ID.V2', 'HL.DOC.ASSET_IDS.2026-07-30'],
      },
    })
  })

  it('rejects outcome asset IDs whose encoding ends in side digit 2 through 9', () => {
    const result = decodeAssetId({ assetId: 100_000_012 })

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'invalid-outcome-side-encoding', path: '/assetId' },
    })
  })

  it.each([
    null,
    [],
    {},
    { assetId: -1 },
    { assetId: 1.5 },
    { assetId: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects invalid decode input: %j', (input) => {
    const result = decodeAssetId(input as unknown as Parameters<typeof decodeAssetId>[0])
    expect(result.value.status).toBe('invalid-input')
  })
})
