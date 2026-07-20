import { describe, expect, it } from 'vitest'
import {
  reconcilePerpAccountSnapshot,
  replayPerpAccountEvents,
} from '../../../src/reconciliation/index.js'

const btc = { network: 'mainnet', marketKind: 'perp', dex: null, index: 0 } as const
const eth = { network: 'mainnet', marketKind: 'perp', dex: null, index: 1 } as const

describe('replayPerpAccountEvents', () => {
  it('replays ordered fills, funding, and transfers into ledger attribution', () => {
    const result = replayPerpAccountEvents({
      snapshot: {
        cashBalance: '1000',
        positions: [
          {
            asset: btc,
            state: { kind: 'open', signedSize: '2', entryPrice: '100' },
          },
        ],
      },
      events: [
        {
          kind: 'fill',
          eventId: 'fill-1',
          timestampMs: 1,
          asset: btc,
          fill: {
            side: 'sell',
            size: '1',
            price: '110',
            fee: { kind: 'explicit', amount: '2' },
          },
        },
        {
          kind: 'funding',
          eventId: 'funding-1',
          timestampMs: 2,
          asset: btc,
          accountValueDelta: '-3',
        },
        {
          kind: 'transfer',
          eventId: 'transfer-1',
          timestampMs: 3,
          accountValueDelta: '5',
        },
      ],
      completeness: { kind: 'complete' },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.final).toEqual({
      cashBalance: '1010',
      positions: [{ asset: btc, state: { kind: 'open', signedSize: '1', entryPrice: '100' } }],
    })
    expect(result.value.data.totals).toEqual({
      realizedPnl: '10',
      feeAccountValueDelta: '-2',
      fundingAccountValueDelta: '-3',
      transferAccountValueDelta: '5',
      netCashDelta: '10',
    })
    expect(result.value.data.ledger.map((line) => [line.kind, line.amount])).toEqual([
      ['realized-pnl', '10'],
      ['trade-fee', '-2'],
      ['funding', '-3'],
      ['transfer', '5'],
    ])
    expect(result.trace.formulaId).toBe('hl.reconciliation.perp-account.replay')
  })

  it('surfaces neutral residuals when raw server fill evidence is supplied', () => {
    const result = replayPerpAccountEvents({
      snapshot: {
        cashBalance: '0',
        positions: [
          {
            asset: btc,
            state: { kind: 'open', signedSize: '2', entryPrice: '100' },
          },
        ],
      },
      events: [
        {
          kind: 'fill',
          eventId: 'server-observed-fill',
          timestampMs: 1,
          asset: btc,
          fill: {
            side: 'sell',
            size: '1',
            price: '110',
            fee: { kind: 'explicit', amount: '2' },
          },
          serverFillEvidence: { startPosition: '2.001', closedPnl: '9.5', fee: '2.1' },
        },
      ],
      completeness: { kind: 'complete' },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.transitions[0]).toMatchObject({
      kind: 'fill',
      serverFillEvidence: { startPosition: '2.001', closedPnl: '9.5', fee: '2.1' },
      serverFillResiduals: {
        status: 'evaluated',
        startPositionResidual: '0.001',
        serverClosedPnlMinusProjectedGrossRealizedPnl: '-0.5',
        serverClosedPnlMinusMathNetClosedPnl: '1.5',
        serverFeeMinusProjectionFeeAmount: '0.1',
      },
    })
  })

  it('starts an absent fill asset from flat', () => {
    const result = replayPerpAccountEvents({
      snapshot: { cashBalance: '0', positions: [] },
      events: [
        {
          kind: 'fill',
          eventId: 'eth-open',
          timestampMs: 1,
          asset: eth,
          fill: { side: 'buy', size: '2', price: '10', fee: { kind: 'none' } },
        },
      ],
      completeness: { kind: 'complete' },
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        final: {
          cashBalance: '0',
          positions: [{ asset: eth, state: { kind: 'open', signedSize: '2', entryPrice: '10' } }],
        },
      },
    })
    if (result.value.status !== 'ok') return
    expect(result.value.data.transitions[0]).toMatchObject({
      kind: 'fill',
      serverFillEvidence: null,
      serverFillResiduals: { status: 'not-evaluated' },
    })
  })

  it('evaluates server evidence from flat and serializes a later full close as flat', () => {
    const result = replayPerpAccountEvents({
      snapshot: {
        cashBalance: '0',
        positions: [{ asset: btc, state: { kind: 'flat' } }],
      },
      events: [
        {
          kind: 'fill',
          eventId: 'open-with-evidence',
          timestampMs: 1,
          asset: btc,
          fill: { side: 'buy', size: '2', price: '100', fee: { kind: 'none' } },
          serverFillEvidence: { startPosition: '0', closedPnl: '0', fee: '0' },
        },
        {
          kind: 'fill',
          eventId: 'full-close',
          timestampMs: 2,
          asset: btc,
          fill: { side: 'sell', size: '2', price: '110', fee: { kind: 'none' } },
        },
      ],
      completeness: { kind: 'complete' },
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        final: { positions: [{ asset: btc, state: { kind: 'flat' } }] },
      },
    })
    if (result.value.status !== 'ok') return
    expect(result.value.data.transitions[0]).toMatchObject({
      serverFillResiduals: {
        status: 'evaluated',
        startPositionResidual: '0',
      },
    })
  })

  it('returns indeterminate without leaking a prefix when history is incomplete', () => {
    const result = replayPerpAccountEvents({
      snapshot: { cashBalance: '0', positions: [] },
      events: [
        {
          kind: 'transfer',
          eventId: 'known-prefix',
          timestampMs: 1,
          accountValueDelta: '5',
        },
      ],
      completeness: {
        kind: 'incomplete',
        reason: { code: 'historical-orders-cap-reached', path: '/completeness' },
      },
    })

    expect(result.value).toMatchObject({
      status: 'indeterminate',
      reason: { code: 'historical-orders-cap-reached' },
    })
    expect(result.value).not.toHaveProperty('data')
  })

  it('accepts a fully validated incomplete-evidence reason without requiring a path', () => {
    const reason = {
      code: 'bounded-history',
      details: { endpoint: 'historicalOrders', capped: true },
      sourceRefs: ['HL.LIVE.MAINNET.M4.2026-07-19'],
    } as const
    const result = replayPerpAccountEvents({
      snapshot: { cashBalance: '0', positions: [] },
      events: [],
      completeness: { kind: 'incomplete', reason },
    })

    expect(result.value).toEqual({ status: 'indeterminate', reason })
  })

  it('rejects spot assets from the perp-account replay contract', () => {
    const result = replayPerpAccountEvents({
      snapshot: {
        cashBalance: '0',
        positions: [
          {
            asset: { ...btc, marketKind: 'spot' } as never,
            state: { kind: 'flat' },
          },
        ],
      },
      events: [],
      completeness: { kind: 'complete' },
    })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-market-kind', path: '/snapshot/positions/0/asset/marketKind' }],
    })
  })

  it('rejects duplicate event ids and decreasing timestamps', () => {
    const duplicate = replayPerpAccountEvents({
      snapshot: { cashBalance: '0', positions: [] },
      events: [
        { kind: 'transfer', eventId: 'same', timestampMs: 1, accountValueDelta: '1' },
        { kind: 'transfer', eventId: 'same', timestampMs: 2, accountValueDelta: '1' },
      ],
      completeness: { kind: 'complete' },
    })
    const decreasing = replayPerpAccountEvents({
      snapshot: { cashBalance: '0', positions: [] },
      events: [
        { kind: 'transfer', eventId: 'later', timestampMs: 2, accountValueDelta: '1' },
        { kind: 'transfer', eventId: 'earlier', timestampMs: 1, accountValueDelta: '1' },
      ],
      completeness: { kind: 'complete' },
    })

    expect(duplicate.value.status).toBe('invalid-input')
    expect(decreasing.value.status).toBe('invalid-input')
  })
})

describe('reconcilePerpAccountSnapshot', () => {
  it('computes numeric residuals and preserves observed server correction', () => {
    const observed = {
      cashBalance: '1009.99',
      positions: [
        { asset: btc, state: { kind: 'open', signedSize: '1.001', entryPrice: '100.002' } },
        { asset: eth, state: { kind: 'open', signedSize: '2', entryPrice: '10' } },
      ],
    } as const
    const result = reconcilePerpAccountSnapshot({
      projected: {
        cashBalance: '1010',
        positions: [{ asset: btc, state: { kind: 'open', signedSize: '1', entryPrice: '100' } }],
      },
      observed,
      tolerances: { cashBalance: '0.02', signedSize: '0.002', entryPrice: '0.005' },
      evidence: { kind: 'complete', eventCount: 3 },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.cashBalanceResidual).toBe('-0.01')
    expect(result.value.data.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetKey: 'hl:mainnet:perp::0',
          status: 'numeric-residual',
          signedSizeResidual: '0.001',
          entryPriceResidual: '0.002',
        }),
        expect.objectContaining({
          assetKey: 'hl:mainnet:perp::1',
          status: 'missing-projected',
        }),
      ]),
    )
    expect(result.value.data.checks.map((check) => check.status)).toEqual([
      'satisfied',
      'satisfied',
      'satisfied',
      'violated',
    ])
    expect(result.value.data.corrected).toEqual({
      authority: 'server-authoritative',
      snapshot: observed,
    })
    expect(result.trace.authority).toBe('local-exact')
  })

  it('returns indeterminate when event evidence is incomplete', () => {
    const result = reconcilePerpAccountSnapshot({
      projected: { cashBalance: '0', positions: [] },
      observed: { cashBalance: '1', positions: [] },
      tolerances: { cashBalance: '0', signedSize: '0', entryPrice: '0' },
      evidence: {
        kind: 'incomplete',
        reason: { code: 'fills-truncated', path: '/evidence' },
      },
    })

    expect(result.value).toMatchObject({
      status: 'indeterminate',
      reason: { code: 'fills-truncated' },
    })
  })
})
