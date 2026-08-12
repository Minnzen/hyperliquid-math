import { describe, expect, it } from 'vitest'
import {
  buildPerpScaleLadder,
  calculatePerpMaxOrderSize,
  calculatePerpSlippagePrice,
  calculatePerpTwapExecutionTarget,
  classifyPerpTrigger,
  derivePerpTriggerPrice,
  evaluatePerpReduceOnly,
  reconcilePerpAccountSnapshot,
  replayPerpAccountEvents,
  validatePerpOrder,
} from '../../src/index.js'

const facades = [
  ['validatePerpOrder', validatePerpOrder],
  ['calculatePerpMaxOrderSize', calculatePerpMaxOrderSize],
  ['evaluatePerpReduceOnly', evaluatePerpReduceOnly],
  ['calculatePerpSlippagePrice', calculatePerpSlippagePrice],
  ['classifyPerpTrigger', classifyPerpTrigger],
  ['derivePerpTriggerPrice', derivePerpTriggerPrice],
  ['buildPerpScaleLadder', buildPerpScaleLadder],
  ['calculatePerpTwapExecutionTarget', calculatePerpTwapExecutionTarget],
  ['replayPerpAccountEvents', replayPerpAccountEvents],
  ['reconcilePerpAccountSnapshot', reconcilePerpAccountSnapshot],
] as const

function accessorReason(reads: { count: number }) {
  return Object.defineProperties(
    {},
    {
      code: {
        enumerable: true,
        get() {
          reads.count += 1
          return 'hostile-reason'
        },
      },
      path: { enumerable: true, value: '/reason' },
    },
  )
}

describe('M4 public facade safety', () => {
  it.each(facades)('%s rejects a revoked root proxy without throwing', (_name, facade) => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()

    expect(() => (facade as (input: never) => unknown)(proxy as never)).not.toThrow()
    const result = (facade as (input: never) => { value: { status: string } })(proxy as never)
    expect(result.value.status).toBe('invalid-input')
  })

  it('keeps invalid M4 traces assumption-free', () => {
    const invalidResults = facades.map(([, facade]) =>
      (
        facade as (input: never) => {
          value: { status: string }
          trace: { completion: { status: string }; assumptions: readonly unknown[] }
        }
      )(null as never),
    )

    for (const result of invalidResults) {
      expect(result.value.status).toBe('invalid-input')
      expect(result.trace.completion.status).toBe('incomplete')
      expect(result.trace.assumptions).toEqual([])
    }
  })

  it('records every output-affecting order input in successful traces', () => {
    const validation = validatePerpOrder({
      price: '100',
      size: '1',
      szDecimals: 2,
      minimumNotional: { kind: 'available', value: '10' },
      priceBand: { kind: 'available', value: { lowerBound: '90', upperBound: '110' } },
    })
    const maxSize = calculatePerpMaxOrderSize({
      availableCollateral: '100',
      leverage: '5',
      referencePrice: '100',
      currentSignedSize: '2',
      side: 'sell',
      reduceOnly: false,
      szDecimals: 2,
      orderValueLimit: { kind: 'available', value: '600' },
    })
    const trigger = derivePerpTriggerPrice({
      position: { kind: 'open', signedSize: '2', entryPrice: '100' },
      target: { kind: 'roe', ratio: '0.5', leverage: '10' },
      cumulativeCost: '1',
    })

    expect(validation.trace.normalizedInputs).toEqual({
      price: '100',
      size: '1',
      szDecimals: 2,
      minimumNotional: { kind: 'available', value: '10' },
      priceBand: { kind: 'available', value: { lowerBound: '90', upperBound: '110' } },
    })
    expect(maxSize.trace.normalizedInputs).toEqual({
      availableCollateral: '100',
      leverage: '5',
      referencePrice: '100',
      currentSignedSize: '2',
      side: 'sell',
      reduceOnly: false,
      szDecimals: 2,
      orderValueLimit: { kind: 'available', value: '600' },
    })
    expect(trigger.trace.normalizedInputs).toEqual({
      position: { kind: 'open', signedSize: '2', entryPrice: '100' },
      target: { kind: 'roe', ratio: '0.5', leverage: '10' },
      cumulativeCost: '1',
    })
  })

  it('states material caller evidence in every successful order trace', () => {
    const results = [
      validatePerpOrder({
        price: '100',
        size: '1',
        szDecimals: 2,
        minimumNotional: { kind: 'available', value: '10' },
        priceBand: { kind: 'available', value: { lowerBound: '90', upperBound: '110' } },
      }),
      calculatePerpMaxOrderSize({
        availableCollateral: '100',
        leverage: '5',
        referencePrice: '100',
        currentSignedSize: '0',
        side: 'buy',
        reduceOnly: false,
        szDecimals: 2,
        orderValueLimit: { kind: 'available', value: '1000' },
      }),
      evaluatePerpReduceOnly({ currentSignedSize: '1', side: 'sell', requestedSize: '0.5' }),
      calculatePerpSlippagePrice({
        side: 'buy',
        referencePrice: '100',
        slippageBps: '10',
        szDecimals: 2,
      }),
      classifyPerpTrigger({
        positionSide: 'long',
        orderSide: 'sell',
        markPrice: '100',
        triggerPrice: '110',
      }),
      derivePerpTriggerPrice({
        position: { kind: 'open', signedSize: '1', entryPrice: '100' },
        target: { kind: 'pnl', amount: '10' },
        cumulativeCost: '1',
      }),
      buildPerpScaleLadder({
        side: 'buy',
        lowerPrice: '90',
        upperPrice: '110',
        totalSize: '1',
        legCount: 3,
        distribution: 'linear',
        szDecimals: 2,
      }),
      calculatePerpTwapExecutionTarget({ totalSize: '1', durationMs: 60_000, elapsedMs: 30_000 }),
    ]

    const expectedAssumptions = [
      [
        { kind: 'frozen-input', path: '/minimumNotional', value: 'caller-provided-rule' },
        { kind: 'frozen-input', path: '/priceBand', value: 'caller-provided-rule' },
      ],
      [
        {
          kind: 'frozen-input',
          path: '/availableCollateral',
          value: 'caller-provided-frozen-available-collateral',
        },
        {
          kind: 'frozen-input',
          path: '/referencePrice',
          value: 'caller-provided-reference-price',
        },
      ],
      [
        {
          kind: 'frozen-input',
          path: '/currentSignedSize',
          value: 'caller-provided-frozen-position-size',
        },
      ],
      [
        {
          kind: 'frozen-input',
          path: '/referencePrice',
          value: 'caller-provided-reference-price',
        },
      ],
      [
        {
          kind: 'frozen-input',
          path: '/markPrice',
          value: 'caller-provided-frozen-mark-price',
        },
      ],
      [
        { kind: 'frozen-input', path: '/position', value: 'size-and-entry-fixed' },
        {
          kind: 'frozen-input',
          path: '/cumulativeCost',
          value: 'caller-provided-costs-only-future-costs-excluded',
        },
      ],
      [
        {
          kind: 'frozen-input',
          path: '/distribution',
          value: 'caller-selected-local-ladder-not-server-scale-algorithm',
        },
      ],
      [
        {
          kind: 'frozen-input',
          path: '/durationMs',
          value: 'caller-provided-duration-server-schedule-excluded',
        },
      ],
    ]

    expect(results.map((result) => result.trace.assumptions)).toEqual(expectedAssumptions)
  })

  it('states reconciliation evidence assumptions and arithmetic sources on successful traces', () => {
    const replay = replayPerpAccountEvents({
      snapshot: { cashBalance: '0', positions: [] },
      events: [],
      completeness: { kind: 'complete' },
    })
    const reconciliation = reconcilePerpAccountSnapshot({
      projected: { cashBalance: '0', positions: [] },
      observed: { cashBalance: '0', positions: [] },
      tolerances: { cashBalance: '0', signedSize: '0', entryPrice: '0' },
      evidence: { kind: 'complete', eventCount: 0 },
    })

    expect(replay.trace.assumptions).toEqual([
      { kind: 'frozen-input', path: '/snapshot', value: 'caller-provided-initial-snapshot' },
      { kind: 'frozen-input', path: '/events', value: 'caller-provided-ordered-complete-events' },
      {
        kind: 'frozen-input',
        path: '/events/*/serverFillEvidence',
        value: 'caller-provided-normalized-raw-fill-evidence-when-present',
      },
    ])
    expect(reconciliation.trace.assumptions).toEqual([
      { kind: 'frozen-input', path: '/projected', value: 'caller-provided-projected-snapshot' },
      { kind: 'frozen-input', path: '/observed', value: 'caller-provided-current-server-snapshot' },
      { kind: 'frozen-input', path: '/evidence', value: 'caller-provided-completeness-evidence' },
      { kind: 'frozen-input', path: '/tolerances', value: 'caller-provided-numeric-tolerances' },
    ])
    expect(replay.trace.sourceRefs).toEqual(
      expect.arrayContaining(['HLM.SPEC.POSITIONS.FILL_PROJECT.V1', 'DECIMALJS.10.6.0']),
    )
    expect(reconciliation.trace.sourceRefs).toContain('DECIMALJS.10.6.0')
    expect(reconciliation.trace.authority).toBe('local-exact')
  })

  it('rejects nested rule and evidence reason accessors without invoking them', () => {
    const reads = { count: 0 }

    expect(() =>
      validatePerpOrder({
        price: '100',
        size: '1',
        szDecimals: 2,
        minimumNotional: { kind: 'not-supported', reason: accessorReason(reads) },
        priceBand: { kind: 'not-applicable', reason: { code: 'no-band' } },
      } as never),
    ).not.toThrow()

    expect(() =>
      calculatePerpMaxOrderSize({
        availableCollateral: '100',
        leverage: '5',
        referencePrice: '100',
        currentSignedSize: '0',
        side: 'buy',
        reduceOnly: false,
        szDecimals: 2,
        orderValueLimit: { kind: 'not-supported', reason: accessorReason(reads) },
      } as never),
    ).not.toThrow()

    expect(() =>
      replayPerpAccountEvents({
        snapshot: { cashBalance: '0', positions: [] },
        events: [],
        completeness: { kind: 'incomplete', reason: accessorReason(reads) },
      } as never),
    ).not.toThrow()

    expect(() =>
      reconcilePerpAccountSnapshot({
        projected: { cashBalance: '0', positions: [] },
        observed: { cashBalance: '0', positions: [] },
        tolerances: { cashBalance: '0', signedSize: '0', entryPrice: '0' },
        evidence: { kind: 'incomplete', reason: accessorReason(reads) },
      } as never),
    ).not.toThrow()

    const results = [
      validatePerpOrder({
        price: '100',
        size: '1',
        szDecimals: 2,
        minimumNotional: { kind: 'not-supported', reason: accessorReason(reads) },
        priceBand: { kind: 'not-applicable', reason: { code: 'no-band' } },
      } as never),
      calculatePerpMaxOrderSize({
        availableCollateral: '100',
        leverage: '5',
        referencePrice: '100',
        currentSignedSize: '0',
        side: 'buy',
        reduceOnly: false,
        szDecimals: 2,
        orderValueLimit: { kind: 'not-supported', reason: accessorReason(reads) },
      } as never),
      replayPerpAccountEvents({
        snapshot: { cashBalance: '0', positions: [] },
        events: [],
        completeness: { kind: 'incomplete', reason: accessorReason(reads) },
      } as never),
      reconcilePerpAccountSnapshot({
        projected: { cashBalance: '0', positions: [] },
        observed: { cashBalance: '0', positions: [] },
        tolerances: { cashBalance: '0', signedSize: '0', entryPrice: '0' },
        evidence: { kind: 'incomplete', reason: accessorReason(reads) },
      } as never),
    ]

    expect(reads.count).toBe(0)
    for (const result of results) {
      expect(result.value.status).toBe('invalid-input')
      expect(result.trace.assumptions).toEqual([])
    }
  })

  it('rejects nested accessors in order, ladder, trigger, and replay data without proxy leaks', () => {
    let reads = 0
    const side = Object.defineProperty({}, 'kind', {
      enumerable: true,
      get() {
        reads += 1
        return 'buy'
      },
    })
    const position = Object.defineProperty({}, 'kind', {
      enumerable: true,
      get() {
        reads += 1
        return 'open'
      },
    })
    const replayAsset = Object.defineProperty({}, 'dex', {
      enumerable: true,
      get() {
        reads += 1
        return 'BTC'
      },
    })

    const calls = [
      () => evaluatePerpReduceOnly({ currentSignedSize: '1', side, requestedSize: '1' } as never),
      () =>
        calculatePerpSlippagePrice({
          side,
          referencePrice: '100',
          slippageBps: '1',
          szDecimals: 2,
        } as never),
      () =>
        classifyPerpTrigger({
          positionSide: side,
          orderSide: 'sell',
          markPrice: '100',
          triggerPrice: '101',
        } as never),
      () =>
        derivePerpTriggerPrice({
          position,
          target: { kind: 'pnl', amount: '1' },
          cumulativeCost: '0',
        } as never),
      () =>
        buildPerpScaleLadder({
          side,
          lowerPrice: '90',
          upperPrice: '110',
          totalSize: '1',
          legCount: 3,
          distribution: 'linear',
          szDecimals: 2,
        } as never),
      () =>
        calculatePerpTwapExecutionTarget({
          totalSize: '1',
          durationMs: Object.freeze({}),
          elapsedMs: 0,
        } as never),
      () =>
        replayPerpAccountEvents({
          snapshot: { cashBalance: '0', positions: [] },
          events: [
            {
              kind: 'funding',
              eventId: 'funding-1',
              timestampMs: 1,
              asset: replayAsset,
              accountValueDelta: '1',
            },
          ],
          completeness: { kind: 'complete' },
        } as never),
      () =>
        reconcilePerpAccountSnapshot({
          projected: {
            cashBalance: '0',
            positions: [{ asset: replayAsset, state: { kind: 'flat' } }],
          },
          observed: { cashBalance: '0', positions: [] },
          tolerances: { cashBalance: '0', signedSize: '0', entryPrice: '0' },
          evidence: { kind: 'complete', eventCount: 0 },
        } as never),
    ]

    for (const call of calls) {
      expect(call).not.toThrow()
      expect(call().value.status).toBe('invalid-input')
    }
    expect(reads).toBe(0)
  })

  it('rejects revoked nested proxies without throwing', () => {
    const { proxy: revokedPosition, revoke: revokePosition } = Proxy.revocable({}, {})
    const { proxy: revokedTarget, revoke: revokeTarget } = Proxy.revocable({}, {})
    const { proxy: revokedRule, revoke: revokeRule } = Proxy.revocable({}, {})
    revokePosition()
    revokeTarget()
    revokeRule()

    expect(() =>
      derivePerpTriggerPrice({
        position: revokedPosition,
        target: revokedTarget,
        cumulativeCost: '0',
      } as never),
    ).not.toThrow()

    expect(() =>
      validatePerpOrder({
        price: '100',
        size: '1',
        szDecimals: 2,
        minimumNotional: revokedRule,
        priceBand: { kind: 'not-applicable', reason: { code: 'none' } },
      } as never),
    ).not.toThrow()

    expect(
      derivePerpTriggerPrice({
        position: revokedPosition,
        target: { kind: 'pnl', amount: '1' },
        cumulativeCost: '0',
      } as never).value.status,
    ).toBe('invalid-input')
  })
})
