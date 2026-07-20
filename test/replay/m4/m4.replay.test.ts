import { readFile } from 'node:fs/promises'
import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import {
  reconcilePerpAccountSnapshot,
  replayPerpAccountEvents,
} from '../../../src/reconciliation/index.js'

type HyperliquidSide = 'A' | 'B'

interface M4LiveFixture {
  sourceId: string
  network: 'mainnet'
  responseFacts: {
    userFillsByTimeCount: number
    historicalOrdersCount: number
    openOrdersCount: number
    historicalOrdersReachedDocumentedCap: boolean
    capturedFillOrdersPresentInHistoricalOrdersResponse: boolean
  }
  selection: {
    fills: Array<{
      coin: string
      px: string
      sz: string
      side: HyperliquidSide
      time: number
      startPosition: string
      dir: string
      closedPnl: string
      oid: number
      fee: string
      tid: number
    }>
    orderStatus: {
      status: 'order'
      order: {
        order: {
          coin: string
          side: HyperliquidSide
          limitPx: string
          sz: string
          oid: number
          timestamp: number
          origSz: string
          tif: string
        }
        status: string
        statusTimestamp: number
      }
    }
  }
}

const mainnetAsset = (index: number) =>
  ({ network: 'mainnet', marketKind: 'perp', dex: null, index }) as const

async function readM4Fixture(): Promise<M4LiveFixture> {
  return JSON.parse(
    await readFile('fixtures/live/2026-07-19-mainnet-m4.json', 'utf8'),
  ) as M4LiveFixture
}

function canonicalSide(side: HyperliquidSide): 'buy' | 'sell' {
  return side === 'B' ? 'buy' : 'sell'
}

function expectedSignedSize(startPosition: string, side: HyperliquidSide, size: string): string {
  const signedDelta = side === 'B' ? new Decimal(size) : new Decimal(size).neg()
  return new Decimal(startPosition).plus(signedDelta).toFixed()
}

describe('M4 mainnet replay fixture', () => {
  it('maps captured Hyperliquid sides into canonical fill sides before replay', async () => {
    const fixture = await readM4Fixture()

    const result = replayPerpAccountEvents({
      snapshot: {
        cashBalance: '0',
        positions: fixture.selection.fills.map((fill, index) => ({
          asset: mainnetAsset(index),
          state: {
            kind: 'open' as const,
            signedSize: fill.startPosition,
            entryPrice: index === 1 ? '0.001' : fill.px,
          },
        })),
      },
      events: fixture.selection.fills.map((fill, index) => ({
        kind: 'fill' as const,
        eventId: `${fixture.sourceId}:tid:${fill.tid}`,
        timestampMs: fill.time,
        asset: mainnetAsset(index),
        fill: {
          side: canonicalSide(fill.side),
          size: fill.sz,
          price: fill.px,
          fee: { kind: 'explicit' as const, amount: fill.fee },
        },
        serverFillEvidence: {
          startPosition: new Decimal(fill.startPosition).toFixed(),
          closedPnl: new Decimal(fill.closedPnl).toFixed(),
          fee: new Decimal(fill.fee).toFixed(),
        },
      })),
      completeness: { kind: 'complete' },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return

    const finalByAsset = new Map(
      result.value.data.final.positions.map((position) => [
        `${position.asset.network}:${position.asset.index}`,
        position,
      ]),
    )
    for (let index = 0; index < fixture.selection.fills.length; index += 1) {
      const fill = fixture.selection.fills[index]
      expect(fill, `fixture fill ${index}`).toBeDefined()
      if (fill === undefined) continue

      const final = finalByAsset.get(`mainnet:${index}`)
      expect(final?.state).toMatchObject({
        kind: 'open',
        signedSize: expectedSignedSize(fill.startPosition, fill.side, fill.sz),
      })
      expect(result.value.data.transitions[index]).toMatchObject({
        eventId: `${fixture.sourceId}:tid:${fill.tid}`,
        assetKey: `hl:mainnet:perp::${index}`,
        serverFillEvidence: {
          startPosition: new Decimal(fill.startPosition).toFixed(),
          closedPnl: new Decimal(fill.closedPnl).toFixed(),
          fee: new Decimal(fill.fee).toFixed(),
        },
        serverFillResiduals: {
          status: 'evaluated',
          startPositionResidual: '0',
          serverFeeMinusProjectionFeeAmount: '0',
        },
      })
    }

    expect(result.value.data.transitions[1]).toMatchObject({
      projection: {
        classification: 'reduce',
        nextState: { kind: 'open', signedSize: '12282711', entryPrice: '0.001' },
        grossRealizedPnl: '12.24186',
        closedPnl: '12.24186',
      },
      serverFillResiduals: {
        serverClosedPnlMinusProjectedGrossRealizedPnl: '-12.51788',
        serverClosedPnlMinusMathNetClosedPnl: '-12.51788',
      },
    })

    expect(fixture.selection.fills.map((fill) => [fill.side, canonicalSide(fill.side)])).toEqual([
      ['A', 'sell'],
      ['A', 'sell'],
      ['A', 'sell'],
      ['A', 'sell'],
      ['B', 'buy'],
      ['B', 'buy'],
      ['B', 'buy'],
      ['A', 'sell'],
    ])
  })

  it('pins selected fill identity to the authoritative orderStatus response', async () => {
    const fixture = await readM4Fixture()
    const selectedFill = fixture.selection.fills[0]
    expect(selectedFill).toBeDefined()
    if (selectedFill === undefined) return

    const statusOrder = fixture.selection.orderStatus.order.order

    expect(fixture.selection.orderStatus.status).toBe('order')
    expect(fixture.selection.orderStatus.order.status).toBe('filled')
    expect(statusOrder).toMatchObject({
      coin: selectedFill.coin,
      side: selectedFill.side,
      limitPx: selectedFill.px,
      oid: selectedFill.oid,
      timestamp: selectedFill.time,
      origSz: selectedFill.sz,
      tif: 'Ioc',
    })
    expect(statusOrder.sz).toBe('0.0')
    expect(fixture.selection.orderStatus.order.statusTimestamp).toBe(selectedFill.time)
  })

  it('fails closed when historical evidence is capped and misses captured fills', async () => {
    const fixture = await readM4Fixture()

    expect(fixture.responseFacts).toMatchObject({
      userFillsByTimeCount: 16,
      historicalOrdersCount: 2000,
      historicalOrdersReachedDocumentedCap: true,
      capturedFillOrdersPresentInHistoricalOrdersResponse: false,
    })
    expect(fixture.responseFacts.openOrdersCount).toBeGreaterThan(0)

    const incompleteReason = {
      code: 'historical-orders-cap-reached',
      path: '/responseFacts/historicalOrdersReachedDocumentedCap',
    } as const
    const replay = replayPerpAccountEvents({
      snapshot: { cashBalance: '0', positions: [] },
      events: [
        {
          kind: 'transfer',
          eventId: 'bounded-prefix-not-a-complete-ledger',
          timestampMs: fixture.selection.fills[0]?.time ?? 0,
          accountValueDelta: '1',
        },
      ],
      completeness: { kind: 'incomplete', reason: incompleteReason },
    })
    const reconciliation = reconcilePerpAccountSnapshot({
      projected: { cashBalance: '1', positions: [] },
      observed: { cashBalance: '0', positions: [] },
      tolerances: { cashBalance: '0', signedSize: '0', entryPrice: '0' },
      evidence: { kind: 'incomplete', reason: incompleteReason },
    })

    expect(replay.value).toMatchObject({
      status: 'indeterminate',
      reason: incompleteReason,
    })
    expect(replay.value).not.toHaveProperty('data')
    expect(reconciliation.value).toMatchObject({
      status: 'indeterminate',
      reason: incompleteReason,
    })
    expect(reconciliation.value).not.toHaveProperty('data')
  })
})
