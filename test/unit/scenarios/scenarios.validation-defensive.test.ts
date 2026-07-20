import { afterEach, describe, expect, it, vi } from 'vitest'

const btc = { network: 'testnet', marketKind: 'perp', dex: null, index: 3 } as const
const standardTiers = [
  { lowerBound: '0', maxLeverage: '20' },
  { lowerBound: '1000', maxLeverage: '10' },
] as const

function validInput() {
  return {
    snapshot: {
      crossAccountValue: '1000',
      positions: [],
      markets: [
        {
          asset: btc,
          markPrice: '100',
          maxLeverage: '20',
          marginTiers: standardTiers,
        },
      ],
    },
    actions: [],
  }
}

describe('scenario validation defensive dependency fallbacks', () => {
  afterEach(() => {
    vi.doUnmock('../../../src/margin/validation.js')
    vi.resetModules()
  })

  it('uses the caller asset path when margin asset validation returns an issue without a path', async () => {
    vi.resetModules()
    vi.doMock('../../../src/margin/validation.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../../src/margin/validation.js')>()
      return {
        ...actual,
        normalizePerpMarginAssetRef: () => ({
          ok: false,
          issue: { code: 'asset-without-path' },
        }),
      }
    })
    const { normalizeInput } = await import('../../../src/scenarios/validation.js')

    const normalized = normalizeInput(validInput())

    expect(normalized).toEqual({
      ok: false,
      issue: { code: 'asset-without-path', path: '/snapshot/markets/0/asset' },
    })
  })

  it('uses the caller tiers path when margin tier validation returns an issue without a path', async () => {
    vi.resetModules()
    vi.doMock('../../../src/margin/validation.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../../src/margin/validation.js')>()
      return {
        ...actual,
        normalizePerpMarginTiers: () => ({
          ok: false,
          issue: { code: 'tiers-without-path' },
        }),
      }
    })
    const { normalizeInput } = await import('../../../src/scenarios/validation.js')

    const normalized = normalizeInput(validInput())

    expect(normalized).toEqual({
      ok: false,
      issue: { code: 'tiers-without-path', path: '/snapshot/markets/0/marginTiers' },
    })
  })

  it('rejects a defensive empty normalized tier array before accepting max leverage', async () => {
    vi.resetModules()
    vi.doMock('../../../src/margin/validation.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../../src/margin/validation.js')>()
      return {
        ...actual,
        normalizePerpMarginTiers: () => ({ ok: true, value: [] }),
      }
    })
    const { normalizeInput } = await import('../../../src/scenarios/validation.js')

    const normalized = normalizeInput(validInput())

    expect(normalized).toEqual({
      ok: false,
      issue: expect.objectContaining({
        code: 'max-leverage-tier-mismatch',
        path: '/snapshot/markets/0/maxLeverage',
      }),
    })
  })
})
