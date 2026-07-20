import { describe, expect, it } from 'vitest'
import {
  reconcilePerpAccountSnapshot,
  replayPerpAccountEvents,
} from '../../../src/reconciliation/index.js'

const btc = { network: 'mainnet', marketKind: 'perp', dex: null, index: 0 } as const
const eth = { network: 'mainnet', marketKind: 'perp', dex: null, index: 1 } as const

describe('reconciliation metamorphic behavior', () => {
  it('replays fees with account-value sign and preserves same-timestamp event order', () => {
    const result = replayPerpAccountEvents({
      snapshot: {
        cashBalance: '1000',
        positions: [{ asset: btc, state: { kind: 'open', signedSize: '2', entryPrice: '100' } }],
      },
      events: [
        {
          kind: 'fill',
          eventId: 'close-half',
          timestampMs: 1,
          asset: btc,
          fill: { side: 'sell', size: '1', price: '110', fee: { kind: 'explicit', amount: '0.5' } },
        },
        {
          kind: 'funding',
          eventId: 'funding-debit',
          timestampMs: 1,
          asset: btc,
          accountValueDelta: '-1.25',
        },
        { kind: 'transfer', eventId: 'deposit', timestampMs: 1, accountValueDelta: '3.75' },
      ],
      completeness: { kind: 'complete' },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.ledger.map((line) => [line.eventId, line.kind, line.amount])).toEqual([
      ['close-half', 'realized-pnl', '10'],
      ['close-half', 'trade-fee', '-0.5'],
      ['funding-debit', 'funding', '-1.25'],
      ['deposit', 'transfer', '3.75'],
    ])
    expect(result.value.data.totals).toEqual({
      realizedPnl: '10',
      feeAccountValueDelta: '-0.5',
      fundingAccountValueDelta: '-1.25',
      transferAccountValueDelta: '3.75',
      netCashDelta: '12',
    })
    expect(result.value.data.final.cashBalance).toBe('1012')
  })

  it('rejects duplicate replay event ids before applying an otherwise valid prefix', () => {
    const result = replayPerpAccountEvents({
      snapshot: { cashBalance: '0', positions: [] },
      events: [
        { kind: 'transfer', eventId: 'same-id', timestampMs: 1, accountValueDelta: '1' },
        { kind: 'transfer', eventId: 'same-id', timestampMs: 2, accountValueDelta: '2' },
      ],
      completeness: { kind: 'complete' },
    })

    expect(result.value.status).toBe('invalid-input')
    expect(result.value).not.toHaveProperty('data')
  })

  it('fails closed for incomplete replay history even when supplied events are self-consistent', () => {
    const result = replayPerpAccountEvents({
      snapshot: { cashBalance: '0', positions: [] },
      events: [
        { kind: 'transfer', eventId: 'known-deposit', timestampMs: 1, accountValueDelta: '100' },
      ],
      completeness: {
        kind: 'incomplete',
        reason: { code: 'historical-orders-cap-reached', path: '/completeness' },
      },
    })

    expect(result.value).toMatchObject({
      status: 'indeterminate',
      reason: { code: 'historical-orders-cap-reached', path: '/completeness' },
    })
    expect(result.value).not.toHaveProperty('data')
  })

  it('computes reconciliation residuals as observed minus projected across the asset union', () => {
    const observed = {
      cashBalance: '997.5',
      positions: [
        { asset: btc, state: { kind: 'open', signedSize: '1.25', entryPrice: '101.5' } },
        { asset: eth, state: { kind: 'open', signedSize: '-2', entryPrice: '50' } },
      ],
    } as const
    const result = reconcilePerpAccountSnapshot({
      projected: {
        cashBalance: '1000',
        positions: [
          { asset: btc, state: { kind: 'open', signedSize: '1', entryPrice: '100' } },
          {
            asset: { network: 'mainnet', marketKind: 'perp', dex: null, index: 2 },
            state: { kind: 'open', signedSize: '3', entryPrice: '10' },
          },
        ],
      },
      observed,
      tolerances: { cashBalance: '0.01', signedSize: '0.01', entryPrice: '0.01' },
      evidence: { kind: 'complete', eventCount: 7 },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.cashBalanceResidual).toBe('-2.5')
    expect(result.value.data.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetKey: 'hl:mainnet:perp::0',
          status: 'numeric-residual',
          signedSizeResidual: '0.25',
          entryPriceResidual: '1.5',
        }),
        expect.objectContaining({
          assetKey: 'hl:mainnet:perp::1',
          status: 'missing-projected',
        }),
        expect.objectContaining({
          assetKey: 'hl:mainnet:perp::2',
          status: 'missing-observed',
        }),
      ]),
    )
    expect(result.value.data.checks.map((check) => check.status)).toEqual([
      'violated',
      'violated',
      'violated',
      'violated',
      'violated',
    ])
    expect(result.value.data.corrected).toEqual({
      authority: 'server-authoritative',
      snapshot: observed,
    })
  })

  it('uses observed as the explicit corrected snapshot instead of overwriting server state', () => {
    const observed = {
      cashBalance: '100.01',
      positions: [
        { asset: btc, state: { kind: 'open', signedSize: '0.999', entryPrice: '99.99' } },
      ],
    } as const
    const result = reconcilePerpAccountSnapshot({
      projected: {
        cashBalance: '100',
        positions: [{ asset: btc, state: { kind: 'open', signedSize: '1', entryPrice: '100' } }],
      },
      observed,
      tolerances: { cashBalance: '1', signedSize: '1', entryPrice: '1' },
      evidence: { kind: 'complete', eventCount: 2 },
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.checks.every((check) => check.status === 'satisfied')).toBe(true)
    expect(result.value.data.corrected).toEqual({
      authority: 'server-authoritative',
      snapshot: observed,
    })
    expect(result.value.data.corrected).not.toEqual({
      cashBalance: '100',
      positions: [{ asset: btc, state: { kind: 'open', signedSize: '1', entryPrice: '100' } }],
    })
  })
})
