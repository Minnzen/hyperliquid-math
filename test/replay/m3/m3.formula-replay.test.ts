import { readFile } from 'node:fs/promises'
import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { calculatePerpLiquidationPrice } from '../../../src/liquidation/index.js'
import { calculatePerpInitialMargin } from '../../../src/margin/index.js'

interface MarginTierFixture {
  lowerBound: string
  maxLeverage: string | number
}

interface PerpUniverseFixture {
  index: number
  name: string
  marginTable: {
    marginTiers: MarginTierFixture[]
  } | null
}

interface PositionFixture {
  coin: string
  szi: string
  positionValue: string
  liquidationPx: string | null
  marginUsed: string
  leverage: { type: 'cross' | 'isolated'; value: number }
}

interface M3LiveFixture {
  selection: {
    perpUniverse: PerpUniverseFixture[]
    positions: PositionFixture[]
  }
  officialSchemaExamples?: {
    clearinghouseStateIsolatedPosition?: {
      position: PositionFixture & {
        entryPx: string
        maxLeverage: number
        leverage: { type: 'isolated'; value: number; rawUsd: string }
      }
      accountSummaries: {
        crossMarginSummary: { accountValue: string }
        marginSummary: { accountValue: string }
      }
      mappingAssertions: {
        isolatedMarginValue: string
      }
    }
  }
}

interface OracleCoverage {
  functions: Array<{
    exportName: string
    formulaId: string
    oracles: {
      'live-fixtures': {
        coverage: string
        reason?: string
        slice?: string
      }
    }
  }>
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

function decimalString(value: string | number): string {
  return new Decimal(value).toString()
}

function expectDecimalClose(actual: string, expected: string, tolerance: string) {
  expect(new Decimal(actual).minus(expected).abs().lte(tolerance)).toBe(true)
}

describe('M3 formula fixture replay', () => {
  it('replays captured BTC initial margin from position value and user leverage', async () => {
    const fixture = await readJson<M3LiveFixture>('fixtures/live/2026-07-19-mainnet-m3.json')
    const btcUniverse = fixture.selection.perpUniverse.find((asset) => asset.name === 'BTC')
    const btcPosition = fixture.selection.positions.find((position) => position.coin === 'BTC')

    expect(btcUniverse?.index).toBe(0)
    expect(btcUniverse?.marginTable).not.toBeNull()
    expect(btcPosition?.leverage.type).toBe('cross')
    if (
      btcUniverse?.marginTable === null ||
      btcUniverse === undefined ||
      btcPosition === undefined
    ) {
      return
    }

    const result = calculatePerpInitialMargin({
      position: {
        asset: { network: 'mainnet', marketKind: 'perp', dex: null, index: 0 },
        signedSize: btcPosition.szi,
        markPrice: new Decimal(btcPosition.positionValue)
          .div(new Decimal(btcPosition.szi).abs())
          .toString(),
        leverage: decimalString(btcPosition.leverage.value),
        marginMode: { kind: 'cross' },
        marginTiers: btcUniverse.marginTable.marginTiers.map((tier) => ({
          lowerBound: decimalString(tier.lowerBound),
          maxLeverage: decimalString(tier.maxLeverage),
        })),
      },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.positionValue).toBe(btcPosition.positionValue)
    expect(result.value.data.initialMargin).toBe(btcPosition.marginUsed)
  })

  it('replays the official isolated schema liquidation price within captured server precision', async () => {
    const fixture = await readJson<M3LiveFixture>('fixtures/live/2026-07-19-mainnet-m3.json')
    const example = fixture.officialSchemaExamples?.clearinghouseStateIsolatedPosition

    expect(example).toBeDefined()
    if (example === undefined) return

    const markPrice = new Decimal(example.position.positionValue)
      .div(new Decimal(example.position.szi).abs())
      .toString()

    const result = calculatePerpLiquidationPrice({
      targetAsset: { network: 'mainnet', marketKind: 'perp', dex: null, index: 1 },
      crossAccountValue: example.accountSummaries.crossMarginSummary.accountValue,
      positions: [
        {
          asset: { network: 'mainnet', marketKind: 'perp', dex: null, index: 1 },
          signedSize: example.position.szi,
          entryPrice: example.position.entryPx,
          markPrice,
          marginMode: {
            kind: 'isolated',
            isolatedMarginValue: example.mappingAssertions.isolatedMarginValue,
            marginRemoval: 'strict',
          },
          marginTiers: [{ lowerBound: '0', maxLeverage: '50' }],
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(example.position.liquidationPx).not.toBeNull()
    if (example.position.liquidationPx === null) return
    expectDecimalClose(result.value.data.liquidationPrice, example.position.liquidationPx, '0.0001')
  })

  it('records M3 formula oracle coverage without promoting scenario live parity', async () => {
    const coverage = await readJson<OracleCoverage>('fixtures/oracles/m3-oracle-coverage.json')
    const byExport = new Map(coverage.functions.map((entry) => [entry.exportName, entry]))

    expect(byExport.get('calculatePerpInitialMargin')).toMatchObject({
      formulaId: 'hl.margin.initial.calculate',
      oracles: { 'live-fixtures': { coverage: 'partial' } },
    })
    expect(byExport.get('calculatePerpMaintenanceMargin')).toMatchObject({
      formulaId: 'hl.margin.maintenance.calculate',
      oracles: { 'live-fixtures': { coverage: 'not-supported' } },
    })
    expect(byExport.get('evaluatePerpAccountMargin')).toMatchObject({
      formulaId: 'hl.margin.account.evaluate',
      oracles: { 'live-fixtures': { coverage: 'not-supported' } },
    })
    expect(byExport.get('calculatePerpLiquidationPrice')).toMatchObject({
      formulaId: 'hl.liquidation-price.calculate',
      oracles: { 'live-fixtures': { coverage: 'partial' } },
    })
    expect(byExport.get('simulatePerpAccountScenario')).toMatchObject({
      formulaId: 'hl.scenario.perp-account.simulate',
      oracles: { 'live-fixtures': { coverage: 'not-supported' } },
    })
  })
})
