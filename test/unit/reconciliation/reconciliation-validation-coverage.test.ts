import { describe, expect, it } from 'vitest'
import {
  type PerpAccountReplayEvent,
  type ReconcilePerpAccountSnapshotInput,
  type ReconciliationAsset,
  type ReplayPerpAccountEventsInput,
  reconcilePerpAccountSnapshot,
  replayPerpAccountEvents,
} from '../../../src/reconciliation/index.js'

const btc = { network: 'mainnet', marketKind: 'perp', dex: null, index: 0 } as const
const eth = { network: 'mainnet', marketKind: 'perp', dex: null, index: 1 } as const
const encoded = {
  network: 'testnet',
  marketKind: 'perp',
  dex: "vault !'()*",
  index: 2,
} as const

function flatSnapshot(positions: ReplayPerpAccountEventsInput['snapshot']['positions'] = []) {
  return { cashBalance: '0', positions }
}

function openPosition(asset: ReconciliationAsset, signedSize = '1', entryPrice = '100') {
  return { asset, state: { kind: 'open' as const, signedSize, entryPrice } }
}

function completeReplay(
  override: Partial<ReplayPerpAccountEventsInput> = {},
): ReplayPerpAccountEventsInput {
  return {
    snapshot: flatSnapshot(),
    events: [],
    completeness: { kind: 'complete' },
    ...override,
  }
}

function completeReconcile(
  override: Partial<ReconcilePerpAccountSnapshotInput> = {},
): ReconcilePerpAccountSnapshotInput {
  return {
    projected: flatSnapshot(),
    observed: flatSnapshot(),
    tolerances: { cashBalance: '0', signedSize: '0', entryPrice: '0' },
    evidence: { kind: 'complete', eventCount: 0 },
    ...override,
  }
}

function expectInvalidIssue(result: ReturnType<typeof replayPerpAccountEvents>, code: string) {
  expect(result.value.status).toBe('invalid-input')
  if (result.value.status !== 'invalid-input') return
  expect(result.value.issues[0]?.code).toBe(code)
}

function expectInvalidReconcileIssue(
  result: ReturnType<typeof reconcilePerpAccountSnapshot>,
  code: string,
) {
  expect(result.value.status).toBe('invalid-input')
  if (result.value.status !== 'invalid-input') return
  expect(result.value.issues[0]?.code).toBe(code)
}

describe('reconciliation public validation coverage', () => {
  it('encodes RFC 3986 dex characters in public asset keys', () => {
    const result = replayPerpAccountEvents(
      completeReplay({
        events: [
          {
            kind: 'funding',
            eventId: 'funding-encoded',
            timestampMs: 1,
            asset: encoded,
            accountValueDelta: '1',
          },
        ],
      }),
    )

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.ledger[0]).toMatchObject({
      assetKey: 'hl:testnet:perp:vault%20%21%27%28%29%2A:2',
      amount: '1',
    })
  })

  it('accepts well-formed surrogate pairs in asset dex names', () => {
    const result = replayPerpAccountEvents(
      completeReplay({
        events: [
          {
            kind: 'funding',
            eventId: 'funding-emoji',
            timestampMs: 1,
            asset: { ...btc, dex: '\uD83D\uDE00' },
            accountValueDelta: '1',
          },
        ],
      }),
    )

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.ledger[0]).toMatchObject({
      assetKey: 'hl:mainnet:perp:%F0%9F%98%80:0',
    })
  })

  it('accepts same-timestamp event order as authoritative input order', () => {
    const result = replayPerpAccountEvents(
      completeReplay({
        events: [
          { kind: 'transfer', eventId: 'first', timestampMs: 7, accountValueDelta: '1' },
          { kind: 'transfer', eventId: 'second', timestampMs: 7, accountValueDelta: '2' },
        ],
      }),
    )

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.transitions.map((transition) => transition.eventId)).toEqual([
      'first',
      'second',
    ])
  })

  it('normalizes open snapshot positions into replay output', () => {
    const result = replayPerpAccountEvents(
      completeReplay({
        snapshot: flatSnapshot([openPosition(btc, '2.5', '99.5')]),
      }),
    )

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.initial.positions).toEqual([
      { asset: btc, state: { kind: 'open', signedSize: '2.5', entryPrice: '99.5' } },
    ])
  })

  it('preserves incomplete completeness reasons with optional path defaults', () => {
    const result = replayPerpAccountEvents(
      completeReplay({
        completeness: { kind: 'incomplete', reason: { code: 'ws-gap' } },
        events: [{ kind: 'transfer', eventId: 'skipped', timestampMs: 1, accountValueDelta: '5' }],
      }),
    )

    expect(result.value).toEqual({ status: 'indeterminate', reason: { code: 'ws-gap' } })
    expect(result.trace.normalizedInputs).toEqual({
      initialPositionCount: 0,
      completenessKind: 'incomplete',
    })
  })

  it('preserves incomplete reconciliation evidence reasons with optional path defaults', () => {
    const result = reconcilePerpAccountSnapshot(
      completeReconcile({
        evidence: { kind: 'incomplete', reason: { code: 'event-window-open' } },
      }),
    )

    expect(result.value).toEqual({ status: 'indeterminate', reason: { code: 'event-window-open' } })
    expect(result.trace.normalizedInputs).toEqual({
      evidenceKind: 'incomplete',
      evidenceReasonCode: 'event-window-open',
      evidenceReasonPath: '',
    })
  })

  it('reports missing observed positions from the union of projected and observed assets', () => {
    const result = reconcilePerpAccountSnapshot(
      completeReconcile({
        projected: flatSnapshot([openPosition(btc)]),
        observed: flatSnapshot(),
      }),
    )

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.positions).toEqual([
      {
        assetKey: 'hl:mainnet:perp::0',
        status: 'missing-observed',
        projectedState: { kind: 'open', signedSize: '1', entryPrice: '100' },
      },
    ])
    expect(result.value.data.checks[1]).toMatchObject({
      status: 'violated',
      violation: { code: 'position-state-mismatch' },
    })
  })

  it('reports flat positions when both snapshots are flat for the same asset', () => {
    const result = reconcilePerpAccountSnapshot(
      completeReconcile({
        projected: flatSnapshot([{ asset: btc, state: { kind: 'flat' } }]),
        observed: flatSnapshot([{ asset: btc, state: { kind: 'flat' } }]),
      }),
    )

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.positions).toEqual([
      { assetKey: 'hl:mainnet:perp::0', status: 'flat' },
    ])
  })

  it('reports state mismatch when one snapshot is flat and the other is open', () => {
    const result = reconcilePerpAccountSnapshot(
      completeReconcile({
        projected: flatSnapshot([{ asset: btc, state: { kind: 'flat' } }]),
        observed: flatSnapshot([openPosition(btc)]),
      }),
    )

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.positions[0]).toMatchObject({
      assetKey: 'hl:mainnet:perp::0',
      status: 'state-mismatch',
    })
  })

  it('violates numeric checks when residuals exceed tolerances', () => {
    const result = reconcilePerpAccountSnapshot(
      completeReconcile({
        projected: flatSnapshot([openPosition(btc, '1', '100')]),
        observed: { cashBalance: '3', positions: [openPosition(btc, '2', '101')] },
        tolerances: { cashBalance: '2.99', signedSize: '0.5', entryPrice: '0.5' },
      }),
    )

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.checks.map((check) => check.status)).toEqual([
      'violated',
      'violated',
      'violated',
    ])
    expect(result.value.data.checks[0]).toMatchObject({
      violation: { code: 'residual-outside-tolerance', actual: '3', limit: '2.99' },
    })
  })

  it('orders reconciliation asset union with projected assets before observed-only assets', () => {
    const result = reconcilePerpAccountSnapshot(
      completeReconcile({
        projected: flatSnapshot([openPosition(eth)]),
        observed: flatSnapshot([openPosition(btc), openPosition(eth)]),
      }),
    )

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.positions.map((position) => position.assetKey)).toEqual([
      'hl:mainnet:perp::1',
      'hl:mainnet:perp::0',
    ])
  })

  it('rejects non-plain root replay inputs', () => {
    expectInvalidIssue(replayPerpAccountEvents(null as never), 'invalid-input-shape')
  })

  it('rejects accessor fields instead of evaluating them', () => {
    const asset = { network: 'mainnet', marketKind: 'perp', dex: null } as Record<string, unknown>
    Object.defineProperty(asset, 'index', {
      enumerable: true,
      get() {
        throw new Error('must not evaluate accessor')
      },
    })

    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          snapshot: flatSnapshot([{ asset: asset as never, state: { kind: 'flat' } }]),
        }),
      ),
      'invalid-input-shape',
    )
  })

  it('rejects proxy inputs that cannot be inspected as plain data', () => {
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('uninspectable')
        },
      },
    )

    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          snapshot: proxy as never,
        }),
      ),
      'invalid-input-shape',
    )
  })

  it('rejects non-array snapshot positions', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          snapshot: { cashBalance: '0', positions: {} as never },
        }),
      ),
      'invalid-input-shape',
    )
  })

  it('rejects malformed snapshot position entries', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          snapshot: { cashBalance: '0', positions: [{ asset: btc }] as never },
        }),
      ),
      'invalid-input-shape',
    )
  })

  it('rejects invalid asset networks', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          snapshot: flatSnapshot([
            { asset: { ...btc, network: 'devnet' } as never, state: { kind: 'flat' } },
          ]),
        }),
      ),
      'invalid-network',
    )
  })

  it('normalizes an empty dex string to the first-party dex key', () => {
    const result = replayPerpAccountEvents(
      completeReplay({
        events: [
          {
            kind: 'funding',
            eventId: 'funding-empty-dex',
            timestampMs: 1,
            asset: { ...btc, dex: '' },
            accountValueDelta: '1',
          },
        ],
      }),
    )

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.ledger[0]).toMatchObject({ assetKey: 'hl:mainnet:perp::0' })
  })

  it('rejects non-NFC dex names', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          snapshot: flatSnapshot([{ asset: { ...btc, dex: 'e\u0301' }, state: { kind: 'flat' } }]),
        }),
      ),
      'invalid-dex',
    )
  })

  it('rejects dex names ending in an unpaired high surrogate', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          snapshot: flatSnapshot([{ asset: { ...btc, dex: '\uD800' }, state: { kind: 'flat' } }]),
        }),
      ),
      'invalid-dex',
    )
  })

  it('rejects dex names with an invalid high-surrogate pair', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          snapshot: flatSnapshot([{ asset: { ...btc, dex: '\uD800x' }, state: { kind: 'flat' } }]),
        }),
      ),
      'invalid-dex',
    )
  })

  it('rejects dex names starting with an unpaired low surrogate', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          snapshot: flatSnapshot([{ asset: { ...btc, dex: '\uDC00' }, state: { kind: 'flat' } }]),
        }),
      ),
      'invalid-dex',
    )
  })

  it('rejects dex names with C0 control characters', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          snapshot: flatSnapshot([
            { asset: { ...btc, dex: 'bad\nname' }, state: { kind: 'flat' } },
          ]),
        }),
      ),
      'invalid-dex',
    )
  })

  it('rejects dex names with C1 control characters', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          snapshot: flatSnapshot([
            { asset: { ...btc, dex: 'bad\u007fname' }, state: { kind: 'flat' } },
          ]),
        }),
      ),
      'invalid-dex',
    )
  })

  it('rejects negative asset indexes', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          snapshot: flatSnapshot([{ asset: { ...btc, index: -1 }, state: { kind: 'flat' } }]),
        }),
      ),
      'invalid-index',
    )
  })

  it('rejects duplicate snapshot asset identities', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          snapshot: flatSnapshot([
            { asset: btc, state: { kind: 'flat' } },
            { asset: btc, state: { kind: 'flat' } },
          ]),
        }),
      ),
      'duplicate-asset-position',
    )
  })

  it('rejects invalid open snapshot states before replaying events', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          snapshot: flatSnapshot([openPosition(btc, '0')]),
        }),
      ),
      'zero-open-position-size',
    )
  })

  it('rejects incomplete completeness objects without reasons', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          completeness: { kind: 'incomplete' } as never,
        }),
      ),
      'invalid-input-shape',
    )
  })

  it('rejects unknown completeness kinds with a reason', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          completeness: { kind: 'partial', reason: { code: 'unknown' } } as never,
        }),
      ),
      'invalid-completeness-kind',
    )
  })

  it('rejects invalid completeness reasons', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          completeness: { kind: 'incomplete', reason: { code: '' } },
        }),
      ),
      'invalid-input-shape',
    )
  })

  it('rejects non-array replay events', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: {} as never,
        }),
      ),
      'invalid-input-shape',
    )
  })

  it('rejects sparse replay event arrays', () => {
    const events = [] as unknown[]
    events.length = 1

    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: events as never,
        }),
      ),
      'invalid-input-shape',
    )
  })

  it('rejects primitive replay events', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: ['not-event'] as never,
        }),
      ),
      'invalid-input-shape',
    )
  })

  it('rejects unknown replay event kinds', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [{ kind: 'adjustment', eventId: 'bad', timestampMs: 1 }] as never,
        }),
      ),
      'invalid-event-kind',
    )
  })

  it('rejects empty fill event ids', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [
            {
              kind: 'fill',
              eventId: '',
              timestampMs: 1,
              asset: btc,
              fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            },
          ],
        }),
      ),
      'invalid-event-id',
    )
  })

  it('rejects unsafe funding timestamps', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [
            {
              kind: 'funding',
              eventId: 'bad-time',
              timestampMs: Number.MAX_SAFE_INTEGER + 1,
              asset: btc,
              accountValueDelta: '1',
            },
          ],
        }),
      ),
      'invalid-timestamp-ms',
    )
  })

  it('rejects fill events with extra fields', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [
            {
              kind: 'fill',
              eventId: 'extra-fill',
              timestampMs: 1,
              asset: btc,
              fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
              extra: true,
            } as never,
          ],
        }),
      ),
      'invalid-input-shape',
    )
  })

  it('rejects fill events with invalid assets', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [
            {
              kind: 'fill',
              eventId: 'bad-asset',
              timestampMs: 1,
              asset: { ...btc, index: 1.5 },
              fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            },
          ],
        }),
      ),
      'invalid-index',
    )
  })

  it('rejects fill events with invalid fill payloads', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [
            {
              kind: 'fill',
              eventId: 'bad-fill',
              timestampMs: 1,
              asset: btc,
              fill: { side: 'hold', size: '1', price: '100', fee: { kind: 'none' } },
            } as never,
          ],
        }),
      ),
      'invalid-fill-side',
    )
  })

  it('rejects fill events with malformed server fill evidence objects', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [
            {
              kind: 'fill',
              eventId: 'bad-server-evidence-shape',
              timestampMs: 1,
              asset: btc,
              fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
              serverFillEvidence: { startPosition: '0', closedPnl: '0' },
            } as never,
          ],
        }),
      ),
      'invalid-input-shape',
    )
  })

  it('rejects fill events with invalid server fill evidence decimals', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [
            {
              kind: 'fill',
              eventId: 'bad-server-evidence-decimal',
              timestampMs: 1,
              asset: btc,
              fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
              serverFillEvidence: { startPosition: '0', closedPnl: 'not-decimal', fee: '0' },
            },
          ],
        }),
      ),
      'invalid-decimal-string',
    )
  })

  it.each(['startPosition', 'fee'] as const)(
    'rejects an invalid server fill evidence %s decimal',
    (field) => {
      expectInvalidIssue(
        replayPerpAccountEvents(
          completeReplay({
            events: [
              {
                kind: 'fill',
                eventId: `bad-server-evidence-${field}`,
                timestampMs: 1,
                asset: btc,
                fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
                serverFillEvidence: {
                  startPosition: field === 'startPosition' ? 'not-decimal' : '0',
                  closedPnl: '0',
                  fee: field === 'fee' ? 'not-decimal' : '0',
                },
              },
            ],
          }),
        ),
        'invalid-decimal-string',
      )
    },
  )

  it('rejects duplicate fill event ids after event normalization', () => {
    const fill = {
      kind: 'fill',
      eventId: 'dupe-fill',
      timestampMs: 1,
      asset: btc,
      fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
    } as const

    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [fill, { ...fill, timestampMs: 2 }],
        }),
      ),
      'duplicate-event-id',
    )
  })

  it('rejects decreasing fill event timestamps after event normalization', () => {
    const fill = (
      eventId: string,
      timestampMs: number,
    ): Extract<PerpAccountReplayEvent, { kind: 'fill' }> => ({
      kind: 'fill',
      eventId,
      timestampMs,
      asset: btc,
      fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
    })

    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [fill('late', 2), fill('early', 1)],
        }),
      ),
      'decreasing-event-timestamp',
    )
  })

  it('rejects funding events with extra fields', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [
            {
              kind: 'funding',
              eventId: 'extra-funding',
              timestampMs: 1,
              asset: btc,
              accountValueDelta: '1',
              extra: true,
            } as never,
          ],
        }),
      ),
      'invalid-input-shape',
    )
  })

  it('rejects funding events with invalid assets', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [
            {
              kind: 'funding',
              eventId: 'funding-bad-asset',
              timestampMs: 1,
              asset: { ...btc, marketKind: 'spot' } as never,
              accountValueDelta: '1',
            },
          ],
        }),
      ),
      'invalid-market-kind',
    )
  })

  it('rejects funding events with invalid deltas', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [
            {
              kind: 'funding',
              eventId: 'funding-bad-delta',
              timestampMs: 1,
              asset: btc,
              accountValueDelta: 'not-decimal',
            },
          ],
        }),
      ),
      'invalid-decimal-string',
    )
  })

  it('rejects duplicate funding event ids after event normalization', () => {
    const funding = {
      kind: 'funding',
      eventId: 'dupe-funding',
      timestampMs: 1,
      asset: btc,
      accountValueDelta: '1',
    } as const

    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [funding, { ...funding, timestampMs: 2 }],
        }),
      ),
      'duplicate-event-id',
    )
  })

  it('rejects transfer events with extra fields', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [
            {
              kind: 'transfer',
              eventId: 'extra-transfer',
              timestampMs: 1,
              accountValueDelta: '1',
              asset: btc,
            } as never,
          ],
        }),
      ),
      'invalid-input-shape',
    )
  })

  it('rejects transfer events with invalid headers', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [
            {
              kind: 'transfer',
              eventId: 1,
              timestampMs: 1,
              accountValueDelta: '1',
            } as never,
          ],
        }),
      ),
      'invalid-event-id',
    )
  })

  it('rejects transfer events with invalid deltas', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [
            {
              kind: 'transfer',
              eventId: 'transfer-bad-delta',
              timestampMs: 1,
              accountValueDelta: Number.NaN as never,
            },
          ],
        }),
      ),
      'invalid-decimal-string',
    )
  })

  it('rejects duplicate transfer event ids after event normalization', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [
            { kind: 'transfer', eventId: 'dupe-transfer', timestampMs: 1, accountValueDelta: '1' },
            { kind: 'transfer', eventId: 'dupe-transfer', timestampMs: 2, accountValueDelta: '1' },
          ],
        }),
      ),
      'duplicate-event-id',
    )
  })

  it('rejects decreasing transfer event timestamps after event normalization', () => {
    expectInvalidIssue(
      replayPerpAccountEvents(
        completeReplay({
          events: [
            { kind: 'transfer', eventId: 'late-transfer', timestampMs: 2, accountValueDelta: '1' },
            { kind: 'transfer', eventId: 'early-transfer', timestampMs: 1, accountValueDelta: '1' },
          ],
        }),
      ),
      'decreasing-event-timestamp',
    )
  })

  it('rejects malformed complete evidence without event counts', () => {
    expectInvalidReconcileIssue(
      reconcilePerpAccountSnapshot(
        completeReconcile({
          evidence: { kind: 'complete' } as never,
        }),
      ),
      'invalid-input-shape',
    )
  })

  it('rejects negative complete evidence event counts', () => {
    expectInvalidReconcileIssue(
      reconcilePerpAccountSnapshot(
        completeReconcile({
          evidence: { kind: 'complete', eventCount: -1 },
        }),
      ),
      'invalid-event-count',
    )
  })

  it('rejects unknown evidence kinds with a reason', () => {
    expectInvalidReconcileIssue(
      reconcilePerpAccountSnapshot(
        completeReconcile({
          evidence: { kind: 'partial', reason: { code: 'unknown' } } as never,
        }),
      ),
      'invalid-evidence-kind',
    )
  })

  it('rejects invalid evidence reasons', () => {
    expectInvalidReconcileIssue(
      reconcilePerpAccountSnapshot(
        completeReconcile({
          evidence: { kind: 'incomplete', reason: { code: '' } },
        }),
      ),
      'invalid-input-shape',
    )
  })

  it('rejects invalid projected snapshots before observed snapshots', () => {
    expectInvalidReconcileIssue(
      reconcilePerpAccountSnapshot(
        completeReconcile({
          projected: { cashBalance: 'bad', positions: [] },
          observed: { cashBalance: 'also-bad', positions: [] },
        }),
      ),
      'invalid-decimal-string',
    )
  })

  it('rejects invalid observed snapshots after projected snapshots pass', () => {
    expectInvalidReconcileIssue(
      reconcilePerpAccountSnapshot(
        completeReconcile({
          observed: { cashBalance: 'bad', positions: [] },
        }),
      ),
      'invalid-decimal-string',
    )
  })

  it('rejects tolerance objects with extra fields', () => {
    expectInvalidReconcileIssue(
      reconcilePerpAccountSnapshot(
        completeReconcile({
          tolerances: {
            cashBalance: '0',
            signedSize: '0',
            entryPrice: '0',
            extra: '0',
          } as never,
        }),
      ),
      'invalid-input-shape',
    )
  })

  it('rejects negative cash balance tolerances', () => {
    expectInvalidReconcileIssue(
      reconcilePerpAccountSnapshot(
        completeReconcile({
          tolerances: { cashBalance: '-0.01', signedSize: '0', entryPrice: '0' },
        }),
      ),
      'negative-decimal',
    )
  })

  it('rejects negative signed size tolerances', () => {
    expectInvalidReconcileIssue(
      reconcilePerpAccountSnapshot(
        completeReconcile({
          tolerances: { cashBalance: '0', signedSize: '-0.01', entryPrice: '0' },
        }),
      ),
      'negative-decimal',
    )
  })

  it('rejects negative entry price tolerances', () => {
    expectInvalidReconcileIssue(
      reconcilePerpAccountSnapshot(
        completeReconcile({
          tolerances: { cashBalance: '0', signedSize: '0', entryPrice: '-0.01' },
        }),
      ),
      'negative-decimal',
    )
  })
})
