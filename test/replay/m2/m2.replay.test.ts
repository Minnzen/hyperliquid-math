import { readFile } from 'node:fs/promises'
import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { selectFeeTier } from '../../../src/fees/index.js'
import {
  calculateFundingPayment,
  calculateFundingPremiumIndex,
  calculateFundingRate,
} from '../../../src/funding/index.js'
import {
  calculatePerpUnrealizedPnl,
  projectPerpFill,
  projectPerpFillSequence,
} from '../../../src/positions/index.js'

interface M2Fixture {
  sourceId: string
  selection: {
    positions: Array<{
      szi: string
      entryPx: string
      positionValue: string
      unrealizedPnl: string
    }>
    fills: Array<{
      coin: string
      side: 'A' | 'B'
      px: string
      sz: string
      startPosition: string
      dir: string
      closedPnl: string
    }>
    funding: Array<{
      delta: { szi: string; fundingRate: string; usdc: string }
    }>
    userFees: {
      feeSchedule: {
        add: string
        cross: string
        vip: Array<{
          ntlCutoff: string
          add: string
          cross: string
        }>
      }
    }
    btcAssetContext: {
      premium: string
      oraclePx: string
      impactPxs: [string, string]
    }
    btcFundingHistory: Array<{ fundingRate: string; premium: string }>
  }
}

async function fixture(path: string): Promise<M2Fixture> {
  return JSON.parse(await readFile(path, 'utf8')) as M2Fixture
}

describe('M2 official API fixture replay', () => {
  it('replays an observed Long > Short fill classification', async () => {
    const mainnet = await fixture('fixtures/live/2026-07-19-mainnet-m2.json')
    const fill = mainnet.selection.fills.find((candidate) => candidate.dir === 'Long > Short')
    expect(fill).toBeDefined()
    if (fill === undefined) return

    const result = projectPerpFill({
      position: { kind: 'open', signedSize: fill.startPosition, entryPrice: '1' },
      fill: {
        side: fill.side === 'B' ? 'buy' : 'sell',
        size: fill.sz,
        price: fill.px,
        fee: { kind: 'none' },
      },
    })
    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.classification).toBe('flip')
    expect(result.value.data.nextState).toEqual({
      kind: 'open',
      signedSize: '-3.8',
      entryPrice: '1.9988',
    })
  })

  it('replays the observed Long > Short vector through the sequence reducer', async () => {
    const mainnet = await fixture('fixtures/live/2026-07-19-mainnet-m2.json')
    const fill = mainnet.selection.fills.find((candidate) => candidate.dir === 'Long > Short')
    expect(fill).toBeDefined()
    if (fill === undefined) return

    const result = projectPerpFillSequence({
      position: { kind: 'open', signedSize: fill.startPosition, entryPrice: '1' },
      fills: [
        {
          side: fill.side === 'B' ? 'buy' : 'sell',
          size: fill.sz,
          price: fill.px,
          fee: { kind: 'none' },
        },
      ],
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        transitions: [{ classification: 'flip' }],
        finalState: { kind: 'open', signedSize: '-3.8', entryPrice: '1.9988' },
      },
    })
  })

  it('replays the observed BTC close against its captured entry basis', async () => {
    const mainnet = await fixture('fixtures/live/2026-07-19-mainnet-m2.json')
    const position = mainnet.selection.positions[0]
    const fill = mainnet.selection.fills.find(
      (candidate) => candidate.coin === 'BTC' && candidate.dir === 'Close Long',
    )
    expect(position).toBeDefined()
    expect(fill).toBeDefined()
    if (position === undefined || fill === undefined) return

    const result = projectPerpFill({
      position: {
        kind: 'open',
        signedSize: fill.startPosition,
        entryPrice: position.entryPx,
      },
      fill: { side: 'sell', size: fill.sz, price: fill.px, fee: { kind: 'none' } },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.classification).toBe('reduce')
    expect(result.value.data.grossRealizedPnl).toBe(fill.closedPnl)
    expect(result.value.data.closedPnl).toBe(fill.closedPnl)
  })

  it('replays displayed unrealized PnL within captured display-precision limits', async () => {
    const mainnet = await fixture('fixtures/live/2026-07-19-mainnet-m2.json')
    for (const position of mainnet.selection.positions) {
      const markPrice = new Decimal(position.positionValue).div(position.szi).abs().toFixed()
      const result = calculatePerpUnrealizedPnl({
        position: {
          kind: 'open',
          signedSize: position.szi,
          entryPrice: position.entryPx,
        },
        markPrice,
      })

      expect(result.value.status).toBe('ok')
      if (result.value.status !== 'ok') continue
      expect(
        new Decimal(result.value.data.unrealizedPnl).minus(position.unrealizedPnl).abs().lt(1),
      ).toBe(true)
    }
  })

  it('replays the captured BTC impact-price premium index exactly', async () => {
    const mainnet = await fixture('fixtures/live/2026-07-19-mainnet-m2.json')
    const context = mainnet.selection.btcAssetContext
    const result = calculateFundingPremiumIndex({
      impactBidPrice: context.impactPxs[0],
      impactAskPrice: context.impactPxs[1],
      oraclePrice: context.oraclePx,
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(new Decimal(result.value.data.premiumIndex).toDecimalPlaces(10).toFixed(10)).toBe(
      context.premium,
    )
  })

  it('replays the observed funding settlement signs and exact implied oracle payments', async () => {
    const mainnet = await fixture('fixtures/live/2026-07-19-mainnet-m2.json')
    for (const record of mainnet.selection.funding) {
      const { szi, fundingRate, usdc } = record.delta
      const impliedOracle = new Decimal(usdc).neg().div(new Decimal(szi).mul(fundingRate)).toFixed()
      const result = calculateFundingPayment({
        signedPositionSize: szi,
        oraclePrice: impliedOracle,
        fundingRate,
      })
      expect(result.value.status).toBe('ok')
      if (result.value.status !== 'ok') continue
      expect(new Decimal(result.value.data.accountValueDelta).toFixed(6)).toBe(
        new Decimal(usdc).toFixed(6),
      )
    }
  })

  it.each(['fixtures/live/2026-07-19-mainnet-m2.json', 'fixtures/live/2026-07-19-testnet-m2.json'])(
    'replays captured BTC hourly funding-history rates from %s',
    async (path) => {
      const captured = await fixture(path)
      for (const record of captured.selection.btcFundingHistory) {
        const result = calculateFundingRate({
          averagePremiumIndex: record.premium,
          rules: {
            interestRate: '0.0001',
            clampLower: '-0.0005',
            clampUpper: '0.0005',
            baseIntervalHours: 8,
            hourlyCap: '0.04',
          },
        })
        expect(result.value.status).toBe('ok')
        if (result.value.status !== 'ok') continue
        expect(result.value.data.hourlyRate).toBe(record.fundingRate)
      }
    },
  )

  it('replays the captured fee tier schedule with strict thresholds', async () => {
    const mainnet = await fixture('fixtures/live/2026-07-19-mainnet-m2.json')
    const schedule = mainnet.selection.userFees.feeSchedule
    const tiers = schedule.vip.map((tier) => ({
      minimumWeightedVolume: tier.ntlCutoff,
      makerRate: tier.add,
      takerRate: tier.cross,
    }))
    const exact = selectFeeTier({
      weightedVolume: '100000000',
      baseRates: { makerRate: schedule.add, takerRate: schedule.cross },
      tiers,
    })
    const above = selectFeeTier({
      weightedVolume: '100000000.000001',
      baseRates: { makerRate: schedule.add, takerRate: schedule.cross },
      tiers,
    })

    expect(exact).toMatchObject({
      value: { status: 'ok', data: { makerRate: '0.00008', takerRate: '0.00035' } },
    })
    expect(above).toMatchObject({
      value: { status: 'ok', data: { makerRate: '0.00004', takerRate: '0.0003' } },
    })
  })
})
