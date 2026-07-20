import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

interface LiveFixture {
  schemaVersion: 1
  sourceId: string
  network: 'mainnet' | 'testnet'
  endpoint: string
  capturedAt: string
  responseHashes: Record<string, string>
  selection: {
    perpUniverse: Array<{ index: number; name: string; szDecimals: number }>
    spotUniverse: Array<{ index: number; name: string; tokens: [number, number] }>
    spotTokens: Array<{ index: number; name: string; szDecimals: number }>
    perpDexs: Array<{ dexIndex: number; name: string }>
    hip3Dex: { dexIndex: number; name: string }
    hip3Universe: Array<{ index: number; name: string; szDecimals: number }>
  }
  l2Book: {
    coin: string
    time: number
    levels: [
      Array<{ px: string; sz: string; n: number }>,
      Array<{ px: string; sz: string; n: number }>,
    ]
  }
}

const m5RequestKeys = [
  'allMids',
  'hip3Meta',
  'hip3MetaAndAssetCtxs',
  'perpDexs',
  'spotClearinghouseState',
  'spotMeta',
  'spotMetaAndAssetCtxs',
] as const

interface M5LiveFixture {
  schemaVersion: 1
  sourceId: string
  network: 'mainnet' | 'testnet'
  endpoint: string
  capturedAt: string
  subject: { kind: string; address: string; usage: string }
  requests: Record<(typeof m5RequestKeys)[number], Record<string, string>>
  requestOutcomes: Record<(typeof m5RequestKeys)[number], { status: number; ok: boolean }>
  responseHashes: Record<(typeof m5RequestKeys)[number], string>
  selection: {
    spotUniverse: Array<{
      tokens: [number, number]
      name: string
      index: number
      isCanonical: boolean
    }>
    spotTokens: Array<{
      name: string
      index: number
      szDecimals: number
      weiDecimals: number
      tokenId: string
      isCanonical: boolean
    }>
    spotAssetContexts: Array<{
      index: number
      coin: string
      markPx: string
      midPx: string | null
    }>
    allMids: Array<[string, string]>
    perpDexs: Array<{ dexIndex: number; name: string; deployerFeeScale: string }>
    hip3Dex: { dexIndex: number; name: string; deployerFeeScale: string }
    hip3Meta: {
      collateralToken: number
      marginTableCount: number
      universe: Array<{
        name: string
        szDecimals: number
        maxLeverage: number
        onlyIsolated: boolean
        marginMode: 'noCross' | 'strictIsolated' | null
        growthMode: 'enabled' | null
      }>
    }
    hip3AssetContexts: Array<{ index: number; name: string; markPx: string; oraclePx: string }>
    spotClearinghouseState: { balances: unknown[] }
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function readPublicExports(): Promise<Record<string, unknown>> {
  return import('../../src/index.js') as Promise<Record<string, unknown>>
}

function okData(result: unknown): unknown {
  if (
    typeof result === 'object' &&
    result !== null &&
    'value' in result &&
    typeof result.value === 'object' &&
    result.value !== null &&
    'status' in result.value &&
    result.value.status === 'ok' &&
    'data' in result.value
  ) {
    return result.value.data
  }
  return undefined
}

const liveFixturePaths = [
  'fixtures/live/2026-07-19-mainnet-m1.json',
  'fixtures/live/2026-07-19-testnet-m1.json',
] as const

const m5LiveFixturePaths = [
  'fixtures/live/2026-07-19-mainnet-m5.json',
  'fixtures/live/2026-07-19-testnet-m5.json',
] as const

describe('live fixture schema replay', () => {
  it.each(liveFixturePaths)('validates the offline live fixture envelope: %s', async (path) => {
    const fixture = await readJson<LiveFixture>(path)

    expect(fixture.schemaVersion).toBe(1)
    expect(fixture.sourceId).toMatch(/^HL\.LIVE\.(MAINNET|TESTNET)\.M1\.2026-07-19$/)
    expect(fixture.capturedAt).toMatch(/^2026-07-19T/)
    expect(fixture.endpoint).toMatch(/^https:\/\/api\.hyperliquid(?:-testnet)?\.xyz\/info$/)
    for (const hash of Object.values(fixture.responseHashes)) {
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it.each(liveFixturePaths)('validates the captured metadata selection shape: %s', async (path) => {
    const fixture = await readJson<LiveFixture>(path)

    expect(fixture.selection.perpUniverse.length).toBeGreaterThan(0)
    expect(fixture.selection.spotUniverse.length).toBeGreaterThan(0)
    expect(fixture.selection.spotTokens.length).toBeGreaterThan(0)
    expect(fixture.selection.hip3Universe.length).toBeGreaterThan(0)
    for (const asset of [...fixture.selection.perpUniverse, ...fixture.selection.hip3Universe]) {
      expect(asset.index).toBeGreaterThanOrEqual(0)
      expect(asset.szDecimals).toBeGreaterThanOrEqual(0)
      expect(asset.name.length).toBeGreaterThan(0)
    }
  })

  it.each(liveFixturePaths)('validates the captured L2 book levels: %s', async (path) => {
    const fixture = await readJson<LiveFixture>(path)

    expect(fixture.l2Book.coin).toBe('BTC')
    expect(fixture.l2Book.levels).toHaveLength(2)
    for (const side of fixture.l2Book.levels) {
      expect(side.length).toBeGreaterThan(0)
      for (const level of side) {
        expect(level.px).toMatch(/^[0-9]+(?:\.[0-9]+)?$/)
        expect(level.sz).toMatch(/^[0-9]+(?:\.[0-9]+)?$/)
        expect(level.n).toBeGreaterThan(0)
      }
    }
  })

  it('matches public encodeAssetId against captured live metadata indexes', async () => {
    const publicExports = await readPublicExports()
    expect(publicExports.encodeAssetId, 'export encodeAssetId from . and ./identifiers').toBeTypeOf(
      'function',
    )
    expect(publicExports.decodeAssetId, 'export decodeAssetId from . and ./identifiers').toBeTypeOf(
      'function',
    )

    for (const path of liveFixturePaths) {
      const fixture = await readJson<LiveFixture>(path)
      for (const asset of fixture.selection.perpUniverse.slice(0, 2)) {
        const result = (publicExports.encodeAssetId as (input: unknown) => unknown)({
          kind: 'perp',
          index: asset.index,
        })
        expect(okData(result), `${fixture.network}:${asset.name}`).toBe(asset.index)
        expect(
          okData(
            (publicExports.decodeAssetId as (input: unknown) => unknown)({ assetId: asset.index }),
          ),
        ).toEqual({ kind: 'perp', index: asset.index })
      }
      for (const market of fixture.selection.spotUniverse.slice(0, 2)) {
        const result = (publicExports.encodeAssetId as (input: unknown) => unknown)({
          kind: 'spot',
          index: market.index,
        })
        expect(okData(result), `${fixture.network}:${market.name}`).toBe(10000 + market.index)
        expect(
          okData(
            (publicExports.decodeAssetId as (input: unknown) => unknown)({
              assetId: 10000 + market.index,
            }),
          ),
        ).toEqual({ kind: 'spot', index: market.index })
      }
      for (const asset of fixture.selection.hip3Universe.slice(0, 2)) {
        const result = (publicExports.encodeAssetId as (input: unknown) => unknown)({
          kind: 'hip3-perp',
          dexIndex: fixture.selection.hip3Dex.dexIndex,
          index: asset.index,
        })
        expect(okData(result), `${fixture.network}:${asset.name}`).toBe(
          100000 + fixture.selection.hip3Dex.dexIndex * 10000 + asset.index,
        )
        expect(
          okData(
            (publicExports.decodeAssetId as (input: unknown) => unknown)({
              assetId: 100000 + fixture.selection.hip3Dex.dexIndex * 10000 + asset.index,
            }),
          ),
        ).toEqual({
          kind: 'hip3-perp',
          dexIndex: fixture.selection.hip3Dex.dexIndex,
          index: asset.index,
        })
      }
    }
  })
})

describe('M5 Spot and HIP-3 live fixture replay', () => {
  it.each(m5LiveFixturePaths)(
    'locks the successful anonymous request envelope: %s',
    async (path) => {
      const fixture = await readJson<M5LiveFixture>(path)

      expect(fixture.schemaVersion).toBe(1)
      expect(fixture.sourceId).toBe(`HL.LIVE.${fixture.network.toUpperCase()}.M5.2026-07-19`)
      expect(fixture.capturedAt).toMatch(/^2026-07-19T/)
      expect(fixture.endpoint).toBe(
        fixture.network === 'mainnet'
          ? 'https://api.hyperliquid.xyz/info'
          : 'https://api.hyperliquid-testnet.xyz/info',
      )
      expect(Object.keys(fixture.requests).sort()).toEqual(m5RequestKeys)
      expect(Object.keys(fixture.requestOutcomes).sort()).toEqual(m5RequestKeys)
      expect(Object.keys(fixture.responseHashes).sort()).toEqual(m5RequestKeys)
      for (const key of m5RequestKeys) {
        expect(fixture.requestOutcomes[key]).toEqual({ status: 200, ok: true })
        expect(fixture.responseHashes[key]).toMatch(/^[a-f0-9]{64}$/)
      }
    },
  )

  it.each(m5LiveFixturePaths)(
    'locks selected Spot metadata and observed mids: %s',
    async (path) => {
      const fixture = await readJson<M5LiveFixture>(path)

      expect(fixture.selection.spotUniverse.length).toBeGreaterThan(0)
      expect(fixture.selection.spotTokens.length).toBeGreaterThan(0)
      expect(fixture.selection.spotAssetContexts.length).toBeGreaterThan(0)
      expect(fixture.selection.allMids.length).toBeGreaterThan(0)
      for (const token of fixture.selection.spotTokens) {
        expect(token.index).toBeGreaterThanOrEqual(0)
        expect(token.szDecimals).toBeGreaterThanOrEqual(0)
        expect(token.weiDecimals).toBeGreaterThanOrEqual(0)
        expect(token.tokenId).toMatch(/^0x[a-f0-9]{32}$/)
      }
      for (const [coin, mid] of fixture.selection.allMids) {
        expect(coin.length).toBeGreaterThan(0)
        expect(mid).toMatch(/^[0-9]+(?:\.[0-9]+)?$/)
      }
      expect(fixture.selection.spotTokens[0]).toMatchObject({ name: 'USDC', index: 0 })
    },
  )

  it.each(m5LiveFixturePaths)(
    'locks HIP-3 dex, collateral, and asset observations: %s',
    async (path) => {
      const fixture = await readJson<M5LiveFixture>(path)
      const expectedDex = fixture.network === 'mainnet' ? 'xyz' : 'test'

      expect(fixture.selection.hip3Dex.name).toBe(expectedDex)
      expect(fixture.selection.hip3Dex.deployerFeeScale).toBe('1.0')
      expect(fixture.selection.perpDexs).toContainEqual(
        expect.objectContaining({
          dexIndex: fixture.selection.hip3Dex.dexIndex,
          name: expectedDex,
        }),
      )
      expect(fixture.selection.hip3Meta.collateralToken).toBeGreaterThanOrEqual(0)
      expect(fixture.selection.hip3Meta.marginTableCount).toBeGreaterThan(0)
      expect(fixture.selection.hip3Meta.universe.length).toBeGreaterThan(0)
      for (const asset of fixture.selection.hip3Meta.universe) {
        expect(asset.name).toMatch(new RegExp(`^${expectedDex}:`))
        expect(asset.szDecimals).toBeGreaterThanOrEqual(0)
        expect(asset.maxLeverage).toBeGreaterThan(0)
      }
      expect(fixture.selection.hip3AssetContexts.length).toBeGreaterThan(0)
    },
  )

  it.each(m5LiveFixturePaths)(
    'preserves empty public Spot state as absence evidence: %s',
    async (path) => {
      const fixture = await readJson<M5LiveFixture>(path)

      expect(fixture.subject.kind).toBe('public-hlp-child')
      expect(fixture.subject.address).toMatch(/^0x[a-f0-9]{40}$/)
      expect(fixture.subject.usage).toContain('absence evidence')
      expect(fixture.selection.spotClearinghouseState.balances).toEqual([])
      expect(fixture.responseHashes.spotClearinghouseState).toBe(
        '524ce15a3ba4e57e130190de01eca238ef18a4637ae106ee2dcc1584236d1a00',
      )
    },
  )

  it('preserves legacy testnet metadata without promoting it to an acceptance oracle', async () => {
    const fixture = await readJson<M5LiveFixture>('fixtures/live/2026-07-19-testnet-m5.json')

    expect(fixture.selection.spotTokens).toContainEqual(
      expect.objectContaining({ name: 'JPL ', szDecimals: 3, weiDecimals: 5 }),
    )
    expect(fixture.selection.spotTokens).toContainEqual(
      expect.objectContaining({ name: 'BREAD', szDecimals: 1, weiDecimals: 1 }),
    )
  })
})
