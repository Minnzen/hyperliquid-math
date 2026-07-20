import { describe, expect, it } from 'vitest'
import { deriveCanonicalAssetKey } from '../../../src/identifiers/index.js'

describe('deriveCanonicalAssetKey', () => {
  it('derives an RFC3986 percent-encoded canonical key with a complete trace', () => {
    expect(
      deriveCanonicalAssetKey({
        network: 'mainnet',
        marketKind: 'perp',
        dex: 'BTC/USDC %',
        index: 12,
      }),
    ).toEqual({
      value: { status: 'ok', data: 'hl:mainnet:perp:BTC%2FUSDC%20%25:12' },
      trace: {
        formulaId: 'hl.identifiers.asset-key.derive',
        formulaVersion: 1,
        authority: 'local-exact',
        maturity: 'stable',
        completion: { status: 'complete' },
        normalizedInputs: {
          network: 'mainnet',
          marketKind: 'perp',
          dex: 'BTC/USDC %',
          index: 12,
        },
        intermediates: [
          {
            stepId: 'encode-dex',
            inputs: { dex: 'BTC/USDC %' },
            output: 'BTC%2FUSDC%20%25',
          },
          {
            stepId: 'join-asset-key',
            output: 'hl:mainnet:perp:BTC%2FUSDC%20%25:12',
          },
        ],
        rounding: [],
        assumptions: [],
        sourceRefs: ['HLM.SPEC.IDENTIFIERS.CANONICAL_KEY.V1'],
      },
    })
  })

  it('normalizes an empty dex string to the first-party dex', () => {
    const result = deriveCanonicalAssetKey({
      network: 'mainnet',
      marketKind: 'perp',
      dex: '',
      index: 0,
    })

    expect(result.value).toEqual({ status: 'ok', data: 'hl:mainnet:perp::0' })
    expect(result.trace.normalizedInputs).toEqual({
      network: 'mainnet',
      marketKind: 'perp',
      dex: null,
      index: 0,
    })
  })

  it('encodes the first-party dex as an empty segment for spot markets', () => {
    const result = deriveCanonicalAssetKey({
      network: 'mainnet',
      marketKind: 'spot',
      dex: null,
      index: 5,
    })

    expect(result.value).toEqual({ status: 'ok', data: 'hl:mainnet:spot::5' })
  })

  it.each([
    [{ network: 'mainnet', marketKind: 'spot', dex: 'xyz', index: 0 }, '/dex'],
    [{ network: 'mainnet', marketKind: 'perp', dex: 'BTC\u0000', index: 0 }, '/dex'],
    [{ network: 'mainnet', marketKind: 'perp', dex: 'e\u0301', index: 0 }, '/dex'],
    [{ network: 'mainnet', marketKind: 'perp', dex: '\uD800', index: 0 }, '/dex'],
    [{ network: 'mainnet', marketKind: 'perp', dex: '\uD800A', index: 0 }, '/dex'],
    [{ network: 'mainnet', marketKind: 'perp', dex: '\uDC00', index: 0 }, '/dex'],
    [{ network: 'devnet', marketKind: 'perp', dex: null, index: 0 }, '/network'],
    [{ network: 'mainnet', marketKind: 'linear', dex: null, index: 0 }, '/marketKind'],
    [{ network: 'mainnet', marketKind: 'perp', dex: 1, index: 0 }, '/dex'],
    [{ network: 'mainnet', marketKind: 'perp', dex: null, index: -1 }, '/index'],
    [{ network: 'mainnet', marketKind: 'perp', dex: null, index: 1.5 }, '/index'],
  ])('rejects invalid input: %j', (input, path) => {
    const result = deriveCanonicalAssetKey(
      input as unknown as Parameters<typeof deriveCanonicalAssetKey>[0],
    )

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: expect.any(String), path },
    })
  })

  it.each([
    null,
    [],
    new Date(0),
    {},
    { network: 'mainnet', marketKind: 'perp', dex: null, index: 0, extra: true },
    Object.defineProperty({ network: 'mainnet', marketKind: 'perp', index: 0 }, 'dex', {
      enumerable: false,
      value: null,
    }),
  ])('rejects an invalid plain-data shape: %j', (input) => {
    const result = deriveCanonicalAssetKey(
      input as unknown as Parameters<typeof deriveCanonicalAssetKey>[0],
    )
    expect(result.value.status).toBe('invalid-input')
  })

  it('rejects uninspectable input as an invalid shape', () => {
    const input = new Proxy(
      { network: 'mainnet', marketKind: 'perp', dex: null, index: 0 },
      {
        ownKeys() {
          throw new Error('blocked')
        },
      },
    )

    const result = deriveCanonicalAssetKey(
      input as unknown as Parameters<typeof deriveCanonicalAssetKey>[0],
    )

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'invalid-input-shape', path: '' },
    })
  })

  it('percent-encodes RFC3986 characters left unescaped by encodeURIComponent', () => {
    const result = deriveCanonicalAssetKey({
      network: 'testnet',
      marketKind: 'perp',
      dex: "!'()*",
      index: 7,
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: 'hl:testnet:perp:%21%27%28%29%2A:7',
    })
  })

  it('accepts well-formed surrogate pairs in dex names', () => {
    const result = deriveCanonicalAssetKey({
      network: 'testnet',
      marketKind: 'perp',
      dex: 'BTC-😀',
      index: 7,
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: 'hl:testnet:perp:BTC-%F0%9F%98%80:7',
    })
  })
})
