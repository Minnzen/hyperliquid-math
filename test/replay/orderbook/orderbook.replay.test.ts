import { readFile } from 'node:fs/promises'
import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { calculateBookMetrics, simulateBookFill } from '../../../src/orderbook/index.js'

interface L2Level {
  readonly px: string
  readonly sz: string
  readonly n: number
}

interface LiveFixture {
  readonly sourceId: string
  readonly l2Book: {
    readonly levels: readonly [readonly L2Level[], readonly L2Level[]]
  }
}

async function readFixture(path: string): Promise<LiveFixture> {
  return JSON.parse(await readFile(path, 'utf8')) as LiveFixture
}

describe('orderbook live fixture replay', () => {
  it.each([
    ['mainnet', 'fixtures/live/2026-07-19-mainnet-m1.json'],
    ['testnet', 'fixtures/live/2026-07-19-testnet-m1.json'],
  ])('replays %s L2 book metrics and a top-of-book fill', async (_network, path) => {
    const fixture = await readFixture(path)
    const input = { levels: fixture.l2Book.levels }
    const metrics = calculateBookMetrics(input)

    expect(metrics.value.status).toBe('ok')
    if (metrics.value.status !== 'ok') return

    const [bids, asks] = fixture.l2Book.levels
    const bestBid = bids[0]
    const bestAsk = asks[0]
    expect(bestBid).toBeDefined()
    expect(bestAsk).toBeDefined()
    if (bestBid === undefined || bestAsk === undefined) return

    expect(metrics.value.data.bestBid).toBe(new Decimal(bestBid.px).toFixed())
    expect(metrics.value.data.bestAsk).toBe(new Decimal(bestAsk.px).toFixed())
    expect(new Decimal(metrics.value.data.bestAsk).gt(metrics.value.data.bestBid)).toBe(true)

    const fill = simulateBookFill({
      levels: fixture.l2Book.levels,
      side: 'buy',
      amount: { kind: 'size', value: bestAsk.sz },
      referencePrice: metrics.value.data.mid,
    })

    expect(fill.value.status).toBe('ok')
    if (fill.value.status !== 'ok') return
    expect(fill.value.data.completion).toBe('full')
    expect(fill.value.data.fills).toEqual([
      {
        px: new Decimal(bestAsk.px).toFixed(),
        sz: new Decimal(bestAsk.sz).toFixed(),
        notional: new Decimal(bestAsk.px).mul(bestAsk.sz).toFixed(),
      },
    ])
    expect(fill.trace.normalizedInputs).toEqual({
      bidCount: bids.length,
      askCount: asks.length,
      side: 'buy',
      amountKind: 'size',
      amount: new Decimal(bestAsk.sz).toFixed(),
      referencePrice: metrics.value.data.mid,
    })
    expect(fixture.sourceId).toContain('HL.LIVE.')
  })
})
