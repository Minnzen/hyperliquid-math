import { describe, expect, it } from 'vitest'
import { decodeAssetId, encodeAssetId } from '../../../src/identifiers/index.js'

describe('outcome asset ID v2 validation boundaries', () => {
  it.each([-1, 2, 0.5, '0', false])('rejects out-of-contract outcome side %j', (side) => {
    expect(encodeAssetId({ kind: 'outcome', outcome: 0, side } as never).value.status).toBe(
      'invalid-input',
    )
  })

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects out-of-contract outcome index %j',
    (outcome) => {
      expect(encodeAssetId({ kind: 'outcome', outcome, side: 0 } as never).value.status).toBe(
        'invalid-input',
      )
    },
  )

  it('rejects exact-shape violations for outcome encoding', () => {
    expect(
      encodeAssetId({ kind: 'outcome', outcome: 0, side: 0, extra: true } as never).value.status,
    ).toBe('invalid-input')
  })

  it('keeps invalid outcome-side traces incomplete and assumption-free', () => {
    const result = decodeAssetId({ assetId: 100_000_002 })

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion.status).toBe('incomplete')
    expect(result.trace.assumptions).toEqual([])
  })
})
