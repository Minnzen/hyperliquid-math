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
      formulaVersion: 1,
      authority: 'local-exact',
      maturity: 'stable',
      completion: { status: 'complete' },
      normalizedInputs: input,
      rounding: [],
      assumptions: [],
      sourceRefs: ['HLM.SPEC.IDENTIFIERS.ASSET_ID.V1', 'HL.DOC.ASSET_IDS.2026-07-19'],
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
    [{ kind: 'outcome', index: 0 }, '/kind'],
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
      formulaVersion: 1,
      authority: 'local-exact',
      maturity: 'stable',
      completion: { status: 'complete' },
      normalizedInputs: { assetId },
      rounding: [],
      assumptions: [],
      sourceRefs: ['HLM.SPEC.IDENTIFIERS.ASSET_ID.V1', 'HL.DOC.ASSET_IDS.2026-07-19'],
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

  it('returns indeterminate for outcome asset IDs', () => {
    expect(decodeAssetId({ assetId: 100_000_000 })).toEqual({
      value: {
        status: 'indeterminate',
        reason: {
          code: 'outcome-asset-id-not-supported',
          path: '/assetId',
          sourceRefs: ['HL.DOC.ASSET_IDS.2026-07-19'],
        },
        missing: ['/outcomeDexIndex', '/marketIndex'],
      },
      trace: {
        formulaId: 'hl.identifiers.asset-id.decode',
        formulaVersion: 1,
        authority: 'local-exact',
        maturity: 'experimental',
        completion: {
          status: 'incomplete',
          reason: {
            code: 'outcome-asset-id-not-supported',
            path: '/assetId',
            sourceRefs: ['HL.DOC.ASSET_IDS.2026-07-19'],
          },
        },
        normalizedInputs: { assetId: 100_000_000 },
        intermediates: [],
        rounding: [],
        assumptions: [],
        sourceRefs: ['HLM.SPEC.IDENTIFIERS.ASSET_ID.V1', 'HL.DOC.ASSET_IDS.2026-07-19'],
      },
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
