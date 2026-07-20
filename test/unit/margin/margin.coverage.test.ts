import { describe, expect, it } from 'vitest'
import { Decimal40 } from '../../../src/core/decimal.js'
import { selectPerpMarginTierFromSchedule } from '../../../src/margin/internal.js'
import { accountMarginTrace } from '../../../src/margin/trace.js'
import {
  assetKey,
  normalizeEvaluatePerpAccountMarginInput,
  normalizeInitialMarginInput,
  normalizePerpMarginAssetRef,
  normalizePerpMarginPosition,
  normalizePerpMarginTiers,
  prefixIssue,
} from '../../../src/margin/validation.js'

const btc = { network: 'mainnet', marketKind: 'perp', dex: null, index: 0 } as const
const tiers = [{ lowerBound: '0', maxLeverage: '10' }] as const

function crossPosition(overrides: Record<string, unknown> = {}) {
  return {
    asset: btc,
    signedSize: '1',
    markPrice: '100',
    leverage: '5',
    marginMode: { kind: 'cross' },
    marginTiers: tiers,
    ...overrides,
  }
}

describe('margin validation coverage', () => {
  it('rejects a non-plain asset reference', () => {
    const result = normalizePerpMarginAssetRef(null, '/asset')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-input-shape', path: '/asset' },
    })
  })

  it('rejects an unsupported asset network', () => {
    const result = normalizePerpMarginAssetRef({ ...btc, network: 'devnet' }, '/asset')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-network', path: '/asset/network' },
    })
  })

  it('rejects an unsupported market kind', () => {
    const result = normalizePerpMarginAssetRef({ ...btc, marketKind: 'spot' }, '/asset')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-market-kind', path: '/asset/marketKind' },
    })
  })

  it('normalizes an empty dex string to the first-party dex', () => {
    const result = normalizePerpMarginAssetRef({ ...btc, dex: '' }, '/asset')

    expect(result).toEqual({
      ok: true,
      value: { network: 'mainnet', marketKind: 'perp', dex: null, index: 0 },
    })
  })

  it('rejects a non-string non-null dex', () => {
    const result = normalizePerpMarginAssetRef({ ...btc, dex: 1 }, '/asset')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-dex', path: '/asset/dex' },
    })
  })

  it('rejects a non-NFC asset dex', () => {
    const result = normalizePerpMarginAssetRef({ ...btc, dex: 'e\u0301' }, '/asset')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-dex', path: '/asset/dex' },
    })
  })

  it('rejects a negative asset index', () => {
    const result = normalizePerpMarginAssetRef({ ...btc, index: -1 }, '/asset')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-index', path: '/asset/index' },
    })
  })

  it('percent-encodes reserved dex characters in asset keys', () => {
    expect(assetKey({ ...btc, dex: "main!*'()" })).toBe('hl:mainnet:perp:main%21%2A%27%28%29:0')
  })

  it('rejects a non-decimal leverage value', () => {
    const result = normalizePerpMarginPosition(crossPosition({ leverage: 5 }), '/position')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-decimal-string', path: '/position/leverage' },
    })
  })

  it('rejects a fractional leverage value', () => {
    const result = normalizePerpMarginPosition(crossPosition({ leverage: '2.5' }), '/position')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-leverage', path: '/position/leverage' },
    })
  })

  it('rejects leverage above the first tier maximum', () => {
    const result = normalizePerpMarginPosition(crossPosition({ leverage: '11' }), '/position')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-leverage', path: '/position/leverage' },
    })
  })

  it('rejects a cross margin mode with extra isolated fields', () => {
    const result = normalizePerpMarginPosition(
      crossPosition({
        marginMode: { kind: 'cross', isolatedMarginValue: '1', marginRemoval: 'allowed' },
      }),
      '/position',
    )

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-margin-mode', path: '/position/marginMode/kind' },
    })
  })

  it('rejects an isolated margin mode without isolated fields', () => {
    const result = normalizePerpMarginPosition(
      crossPosition({ marginMode: { kind: 'isolated' } }),
      '/position',
    )

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-margin-mode', path: '/position/marginMode/kind' },
    })
  })

  it('rejects a non-plain margin mode', () => {
    const result = normalizePerpMarginPosition(crossPosition({ marginMode: null }), '/position')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-input-shape', path: '/position/marginMode' },
    })
  })

  it('rejects an isolated margin mode with a wrong kind', () => {
    const result = normalizePerpMarginPosition(
      crossPosition({
        leverage: '5',
        marginMode: { kind: 'portfolio', isolatedMarginValue: '100', marginRemoval: 'allowed' },
      }),
      '/position',
    )

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-margin-mode', path: '/position/marginMode/kind' },
    })
  })

  it('rejects a non-decimal isolated margin value', () => {
    const result = normalizePerpMarginPosition(
      crossPosition({
        leverage: '5',
        marginMode: { kind: 'isolated', isolatedMarginValue: 100, marginRemoval: 'allowed' },
      }),
      '/position',
    )

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-decimal-string', path: '/position/marginMode/isolatedMarginValue' },
    })
  })

  it('rejects an unsupported isolated margin removal mode', () => {
    const result = normalizePerpMarginPosition(
      crossPosition({
        leverage: '5',
        marginMode: { kind: 'isolated', isolatedMarginValue: '100', marginRemoval: 'loose' },
      }),
      '/position',
    )

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-margin-removal', path: '/position/marginMode/marginRemoval' },
    })
  })

  it('rejects non-array margin tiers', () => {
    const result = normalizePerpMarginTiers(null, '/tiers')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-input-shape', path: '/tiers' },
    })
  })

  it('rejects empty margin tiers', () => {
    const result = normalizePerpMarginTiers([], '/tiers')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-margin-tiers', path: '/tiers' },
    })
  })

  it('rejects malformed margin tier entries', () => {
    const result = normalizePerpMarginTiers([null], '/tiers')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-input-shape', path: '/tiers/0' },
    })
  })

  it('rejects negative margin tier lower bounds', () => {
    const result = normalizePerpMarginTiers([{ lowerBound: '-1', maxLeverage: '10' }], '/tiers')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'negative-decimal', path: '/tiers/0/lowerBound' },
    })
  })

  it('rejects non-positive margin tier max leverage', () => {
    const result = normalizePerpMarginTiers([{ lowerBound: '0', maxLeverage: '0' }], '/tiers')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'non-positive-decimal', path: '/tiers/0/maxLeverage' },
    })
  })

  it('rejects fractional margin tier max leverage', () => {
    const result = normalizePerpMarginTiers([{ lowerBound: '0', maxLeverage: '10.5' }], '/tiers')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-margin-tier-max-leverage', path: '/tiers/0/maxLeverage' },
    })
  })

  it('rejects a first margin tier that does not start at zero', () => {
    const result = normalizePerpMarginTiers([{ lowerBound: '1', maxLeverage: '10' }], '/tiers')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-margin-tier-lower-bound', path: '/tiers/0/lowerBound' },
    })
  })

  it('rejects non-increasing margin tier lower bounds', () => {
    const result = normalizePerpMarginTiers(
      [
        { lowerBound: '0', maxLeverage: '10' },
        { lowerBound: '0', maxLeverage: '5' },
      ],
      '/tiers',
    )

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-margin-tier-lower-bound', path: '/tiers/1/lowerBound' },
    })
  })

  it('rejects tier schedules that would produce negative maintenance deductions', () => {
    const result = normalizePerpMarginTiers(
      [
        { lowerBound: '0', maxLeverage: '5' },
        { lowerBound: '1000', maxLeverage: '10' },
      ],
      '/tiers',
    )

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-margin-tier-deduction', path: '/tiers/1/maxLeverage' },
    })
  })

  it('rejects non-plain positions', () => {
    const result = normalizePerpMarginPosition(null, '/position')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-input-shape', path: '/position' },
    })
  })

  it('rejects positions with malformed assets', () => {
    const result = normalizePerpMarginPosition(crossPosition({ asset: null }), '/position')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-input-shape', path: '/position/asset' },
    })
  })

  it('rejects non-decimal signed sizes', () => {
    const result = normalizePerpMarginPosition(crossPosition({ signedSize: 1 }), '/position')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-decimal-string', path: '/position/signedSize' },
    })
  })

  it('rejects non-positive mark prices', () => {
    const result = normalizePerpMarginPosition(crossPosition({ markPrice: '0' }), '/position')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'non-positive-decimal', path: '/position/markPrice' },
    })
  })

  it('rejects position tiers before leverage validation', () => {
    const result = normalizePerpMarginPosition(crossPosition({ marginTiers: [] }), '/position')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-margin-tiers', path: '/position/marginTiers' },
    })
  })

  it('rejects zero-size positions when non-zero exposure is required', async () => {
    const { validateNonZeroPosition } = await import('../../../src/margin/validation.js')
    const normalized = normalizePerpMarginPosition(crossPosition({ signedSize: '0' }), '/position')

    expect(normalized.ok).toBe(true)
    if (!normalized.ok) return
    expect(validateNonZeroPosition(normalized.value, '/position')).toMatchObject({
      ok: false,
      issue: { code: 'zero-position-size', path: '/position/signedSize' },
    })
  })

  it('returns an invalid initial input for a malformed root', () => {
    const result = normalizeInitialMarginInput(null)

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-input-shape', path: '' },
    })
  })

  it('returns an invalid initial input when the nested position is malformed', () => {
    const result = normalizeInitialMarginInput({ position: null })

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-input-shape', path: '/position' },
    })
  })

  it('rejects a malformed account root', () => {
    const result = normalizeEvaluatePerpAccountMarginInput(null)

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-input-shape', path: '' },
    })
  })

  it('rejects a non-decimal cross account value', () => {
    const result = normalizeEvaluatePerpAccountMarginInput({
      crossAccountValue: 100,
      positions: [],
    })

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-decimal-string', path: '/crossAccountValue' },
    })
  })

  it('rejects non-array account positions', () => {
    const result = normalizeEvaluatePerpAccountMarginInput({
      crossAccountValue: '100',
      positions: null,
    })

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-input-shape', path: '/positions' },
    })
  })

  it('rejects malformed account positions with their index in the path', () => {
    const result = normalizeEvaluatePerpAccountMarginInput({
      crossAccountValue: '100',
      positions: [null],
    })

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-input-shape', path: '/positions/0' },
    })
  })

  it('rejects duplicate account position assets', () => {
    const result = normalizeEvaluatePerpAccountMarginInput({
      crossAccountValue: '100',
      positions: [crossPosition(), crossPosition()],
    })

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'duplicate-asset', path: '/positions/1/asset' },
    })
  })

  it('prefixes issue paths without losing issue details', () => {
    expect(
      prefixIssue(
        { code: 'invalid-decimal-string', path: '/value', actual: 'x', expected: 'decimal' },
        '/input',
      ),
    ).toEqual({
      code: 'invalid-decimal-string',
      path: '/input/value',
      actual: 'x',
      expected: 'decimal',
    })
  })

  it('prefixes missing issue paths at the prefix root', () => {
    expect(prefixIssue({ code: 'invalid-input' }, '/input')).toEqual({
      code: 'invalid-input',
      path: '/input',
    })
  })

  it('reports an empty normalized tier schedule as invalid during position normalization', () => {
    const originalEntries = Array.prototype.entries
    Array.prototype.entries = function patchedEntries<T>(this: T[]): ArrayIterator<[number, T]> {
      if (
        this.length === 1 &&
        typeof this[0] === 'object' &&
        this[0] !== null &&
        'lowerBound' in this[0] &&
        'maxLeverage' in this[0]
      ) {
        return [][Symbol.iterator]() as ArrayIterator<[number, T]>
      }
      return originalEntries.call(this) as ArrayIterator<[number, T]>
    }

    try {
      const result = normalizePerpMarginPosition(crossPosition(), '/position')
      expect(result).toMatchObject({
        ok: false,
        issue: { code: 'invalid-margin-tiers', path: '/position/marginTiers' },
      })
    } finally {
      Array.prototype.entries = originalEntries
    }
  })
})

describe('margin internal coverage', () => {
  it('throws when selecting from an empty normalized tier schedule', () => {
    expect(() => selectPerpMarginTierFromSchedule(new Decimal40(1), [])).toThrow(
      'normalized margin tiers must be non-empty',
    )
  })
})

describe('margin trace coverage', () => {
  it('uses empty normalized inputs for complete account traces without input', () => {
    const trace = accountMarginTrace(undefined, { status: 'complete' })

    expect(trace.normalizedInputs).toEqual({})
    expect(trace.assumptions).toEqual([])
  })
})
