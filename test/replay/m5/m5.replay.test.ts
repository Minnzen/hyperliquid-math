import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { validateHip1Deployment } from '../../../src/hip1/index.js'
import {
  calculateHip3FeeRates,
  evaluateHip3MarginMode,
  resolveHip3CollateralSource,
} from '../../../src/hip3/index.js'
import {
  calculateSpotPortfolioValue,
  convertSpotTokenUnits,
  evaluateSpotDustEligibility,
} from '../../../src/spot/index.js'

interface SpotTokenObservation {
  readonly name: string
  readonly index: number
  readonly szDecimals: number
  readonly weiDecimals: number
}

interface SpotContextObservation {
  readonly index: number
  readonly coin: string
  readonly midPx: string | null
}

interface Hip3AssetObservation {
  readonly name: string
  readonly onlyIsolated: boolean
  readonly marginMode: 'noCross' | 'strictIsolated' | null
  readonly growthMode: string | null
}

interface M5LiveFixture {
  readonly sourceId: string
  readonly network: 'mainnet' | 'testnet'
  readonly selection: {
    readonly spotTokens: readonly SpotTokenObservation[]
    readonly spotAssetContexts: readonly SpotContextObservation[]
    readonly spotClearinghouseState: { readonly balances: readonly unknown[] }
    readonly hip3Dex: { readonly name: string; readonly deployerFeeScale: string }
    readonly hip3Meta: {
      readonly collateralToken: number
      readonly universe: readonly Hip3AssetObservation[]
    }
  }
}

async function fixture(path: string): Promise<M5LiveFixture> {
  return JSON.parse(await readFile(path, 'utf8')) as M5LiveFixture
}

describe('M5 dated metadata replay', () => {
  it.each(['mainnet', 'testnet'] as const)(
    'round-trips PURR units from the %s token metadata snapshot',
    async (network) => {
      const observed = await fixture(`fixtures/live/2026-07-19-${network}-m5.json`)
      const token = observed.selection.spotTokens.find((candidate) => candidate.name === 'PURR')
      expect(token).toMatchObject({ szDecimals: 0, weiDecimals: 5 })
      if (token === undefined) return

      const minimal = convertSpotTokenUnits({
        value: '0.5',
        weiDecimals: token.weiDecimals,
        direction: 'human-to-minimal',
      })
      expect(minimal).toMatchObject({ value: { status: 'ok', data: { value: '50000' } } })

      const human = convertSpotTokenUnits({
        value: '50000',
        weiDecimals: token.weiDecimals,
        direction: 'minimal-to-human',
      })
      expect(human).toMatchObject({ value: { status: 'ok', data: { value: '0.5' } } })
    },
  )

  it('replays the observed PURR lot and mid into the deterministic dust predicate', async () => {
    const observed = await fixture('fixtures/live/2026-07-19-mainnet-m5.json')
    const token = observed.selection.spotTokens.find((candidate) => candidate.name === 'PURR')
    const context = observed.selection.spotAssetContexts.find(
      (candidate) => candidate.coin === 'PURR/USDC',
    )
    expect(token).toBeDefined()
    expect(context?.midPx).toBe('0.073122')
    if (token === undefined || context?.midPx === null || context === undefined) return

    const result = evaluateSpotDustEligibility({
      balance: '0.5',
      midPrice: context.midPx,
      weiDecimals: token.weiDecimals,
      szDecimals: token.szDecimals,
      usdThreshold: '1',
    })

    expect(result).toMatchObject({
      value: {
        status: 'ok',
        data: {
          lotSizeWei: '100000',
          lotSize: '1',
          notionalUsd: '0.036561',
          eligible: true,
        },
      },
    })
  })

  it('preserves the captured empty public Spot balance vector as bounded absence evidence', async () => {
    const observed = await fixture('fixtures/live/2026-07-19-mainnet-m5.json')
    expect(observed.selection.spotClearinghouseState.balances).toEqual([])

    expect(calculateSpotPortfolioValue({ balances: [] })).toMatchObject({
      value: {
        status: 'ok',
        data: { tokens: [], portfolioValue: '0', entryNotional: '0', unrealizedPnl: '0' },
      },
    })
  })

  it('evaluates only the objective HIP-1 slice present in observed token metadata', async () => {
    const observed = await fixture('fixtures/live/2026-07-19-mainnet-m5.json')
    const token = observed.selection.spotTokens.find((candidate) => candidate.name === 'PURR')
    expect(token).toBeDefined()
    if (token === undefined) return

    const result = validateHip1Deployment({
      name: token.name,
      weiDecimals: token.weiDecimals,
      szDecimals: token.szDecimals,
      maxSupplyWei: '1',
      userGenesisWei: '1',
      anchorGenesisWei: '0',
    })
    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        lotSizeWei: '100000',
        checks: expect.arrayContaining([
          { status: 'satisfied', ruleId: 'hl.hip1.deployment.name-code-points' },
          { status: 'satisfied', ruleId: 'hl.hip1.deployment.sz-decimals-within-wei' },
        ]),
      },
    })
  })

  it('maps observed HIP-3 collateral indexes and noCross metadata without claiming server eligibility', async () => {
    const observed = await fixture('fixtures/live/2026-07-19-mainnet-m5.json')
    const usdc = observed.selection.spotTokens.find((candidate) => candidate.name === 'USDC')
    const noCross = observed.selection.hip3Meta.universe.find(
      (candidate) => candidate.marginMode === 'noCross',
    )
    expect(usdc).toBeDefined()
    expect(noCross).toBeDefined()
    if (usdc === undefined || noCross?.marginMode !== 'noCross') return

    expect(
      resolveHip3CollateralSource({
        accountAbstractionMode: 'dex-abstraction-deprecated',
        dex: observed.selection.hip3Dex.name,
        collateralTokenIndex: observed.selection.hip3Meta.collateralToken,
        validatorPerpUsdcTokenIndex: usdc.index,
      }),
    ).toMatchObject({
      value: { status: 'ok', data: { route: { kind: 'validator-perp-usdc-balance' } } },
    })

    expect(
      evaluateHip3MarginMode({ assetMarginMode: noCross.marginMode, requestedMode: 'cross' }),
    ).toMatchObject({
      value: { status: 'ok', data: { supportedLocally: false, effectiveMarginMode: null } },
    })
  })

  it('replays captured HIP-3 fee-scale and growth-mode metadata with explicit neutral rates', async () => {
    const observed = await fixture('fixtures/live/2026-07-19-mainnet-m5.json')
    const growthAsset = observed.selection.hip3Meta.universe.find(
      (candidate) => candidate.growthMode === 'enabled',
    )
    expect(growthAsset).toBeDefined()
    if (growthAsset === undefined) return

    const result = calculateHip3FeeRates({
      makerRate: '0',
      takerRate: '0',
      activeReferralDiscount: '0',
      isAlignedQuoteToken: false,
      deployerFeeScale: observed.selection.hip3Dex.deployerFeeScale,
      growthMode: growthAsset.growthMode === 'enabled',
    })

    expect(result).toMatchObject({
      value: {
        status: 'ok',
        data: {
          effectiveMakerRate: '0',
          effectiveTakerRate: '0',
          hip3Scale: '2',
          growthMultiplier: '0.1',
        },
      },
    })
  })
})
