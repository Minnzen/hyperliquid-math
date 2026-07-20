import { describe, expect, it } from 'vitest'
import { transferConstraintReason } from '../../../src/scenarios/constraints.js'
import {
  type PerpAccountScenarioSnapshot,
  simulatePerpAccountScenario,
} from '../../../src/scenarios/index.js'
import { applyActions, buildWorking, computeDelta } from '../../../src/scenarios/reducer.js'
import { normalizeInput } from '../../../src/scenarios/validation.js'
import { accountView } from '../../../src/scenarios/views.js'

const btc = { network: 'testnet', marketKind: 'perp', dex: null, index: 3 } as const
const eth = { network: 'testnet', marketKind: 'perp', dex: null, index: 4 } as const
const standardTiers = [
  { lowerBound: '0', maxLeverage: '20' },
  { lowerBound: '1000', maxLeverage: '10' },
] as const

function market(
  asset: {
    readonly network: 'testnet'
    readonly marketKind: 'perp'
    readonly dex: string | null
    readonly index: number
  } = btc,
  markPrice = '100',
) {
  return { asset, markPrice, maxLeverage: '20', marginTiers: standardTiers }
}

function crossLongSnapshot(): PerpAccountScenarioSnapshot {
  return {
    crossAccountValue: '1000',
    positions: [
      {
        kind: 'open',
        asset: btc,
        signedSize: '2',
        entryPrice: '100',
        marginMode: { kind: 'cross' },
        leverage: '10',
      },
    ],
    markets: [market()],
  }
}

function isolatedLongSnapshot(
  marginRemoval: 'allowed' | 'strict' = 'allowed',
): PerpAccountScenarioSnapshot {
  return {
    crossAccountValue: '1000',
    positions: [
      {
        kind: 'open',
        asset: btc,
        signedSize: '2',
        entryPrice: '100',
        marginMode: {
          kind: 'isolated',
          isolatedMarginValue: '100',
          marginRemoval,
        },
        leverage: '10',
      },
    ],
    markets: [market()],
  }
}

function crossDelta(amount: string) {
  return { kind: 'cross-account-value-delta', amount } as const
}

function expectSingleInvalidIssue(
  input: unknown,
  expected: { readonly code: string; readonly path: string },
) {
  const result = simulatePerpAccountScenario(input as never)

  expect(result.value.status).toBe('invalid-input')
  if (result.value.status !== 'invalid-input') return
  expect(result.value.issues).toEqual([expect.objectContaining(expected)])
}

function normalizedScenario(input: Parameters<typeof simulatePerpAccountScenario>[0]) {
  const normalized = normalizeInput(input)
  expect(normalized.ok).toBe(true)
  if (!normalized.ok) throw new Error('test fixture should normalize')
  return normalized.input
}

describe('simulatePerpAccountScenario', () => {
  it('returns an identity projection when actions are empty', () => {
    const result = simulatePerpAccountScenario({
      snapshot: crossLongSnapshot(),
      actions: [],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.projected).toEqual(result.value.data.current)
    expect(result.value.data.delta).toMatchObject({
      crossAccountValue: '0',
      actionsApplied: 0,
    })
    expect(result.trace.assumptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'counterfactual-action', protocolSupport: 'unverified' }),
      ]),
    )
  })

  it('credits a cross reducing fill by realized pnl minus the fee exactly once', () => {
    const result = simulatePerpAccountScenario({
      snapshot: crossLongSnapshot(),
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: {
            side: 'sell',
            size: '1',
            price: '110',
            fee: { kind: 'explicit', amount: '3' },
          },
          isolatedMarginAllocation: { kind: 'not-applicable' },
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.projected.cross.accountValue).toBe('1007')
    expect(result.value.data.delta.crossAccountValue).toBe('7')
    expect(result.value.data.fills).toEqual([
      expect.objectContaining({
        actionIndex: 0,
        grossRealizedPnl: '10',
        feeAccountValueDelta: '-3',
      }),
    ])
    expect(result.value.data.assumptions).toEqual(
      expect.arrayContaining([
        {
          kind: 'fill-model',
          model: 'explicit-sequence',
          parameters: {
            fee: 'explicit-per-fill',
            fillPrice: 'explicit',
            markPrice: 'frozen',
          },
        },
      ]),
    )
  })

  it('replaces the old frozen-mark unrealized pnl after a cross fill', () => {
    const snapshot = crossLongSnapshot()
    const result = simulatePerpAccountScenario({
      snapshot: { ...snapshot, markets: [market(btc, '105')] },
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: {
            side: 'sell',
            size: '1',
            price: '110',
            fee: { kind: 'explicit', amount: '3' },
          },
          isolatedMarginAllocation: { kind: 'not-applicable' },
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    // +10 realized -3 fee +5 projected UPnL -10 previous UPnL = +2 equity.
    expect(result.value.data.delta.crossAccountValue).toBe('2')
    expect(result.value.data.projected.cross.accountValue).toBe('1002')
  })

  it('applies cross account deltas in caller order', () => {
    const result = simulatePerpAccountScenario({
      snapshot: crossLongSnapshot(),
      actions: [crossDelta('5'), crossDelta('-2')],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.projected.cross.accountValue).toBe('1003')
    expect(
      result.value.data.actions.map((action: { actionIndex: number }) => action.actionIndex),
    ).toEqual([0, 1])
  })

  it('blocks a cross withdrawal that would breach the transfer-margin requirement', () => {
    const result = simulatePerpAccountScenario({
      snapshot: crossLongSnapshot(),
      actions: [crossDelta('-990')],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: {
        code: 'cross-transfer-margin-constraint',
        path: '/actions/0/amount',
      },
    })
    expect(result.trace.completion).toMatchObject({ status: 'incomplete', actionIndex: 0 })
  })

  it('blocks an allowed isolated removal that would exceed max removable margin', () => {
    const result = simulatePerpAccountScenario({
      snapshot: isolatedLongSnapshot('allowed'),
      actions: [{ kind: 'isolated-margin-delta', asset: btc, amount: '-90' }],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: {
        code: 'isolated-transfer-margin-constraint',
        path: '/actions/0/amount',
      },
    })
  })

  it('preserves an explicit fill while reporting objective post-fill margin violations', () => {
    const result = simulatePerpAccountScenario({
      snapshot: crossLongSnapshot(),
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: {
            side: 'sell',
            size: '1',
            price: '100',
            fee: { kind: 'explicit', amount: '1005' },
          },
          isolatedMarginAllocation: { kind: 'not-applicable' },
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.projected.cross.accountValue).toBe('-5')
    expect(result.value.data.constraintChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'violated',
          transitionEffect: 'preserves-transition',
          violation: expect.objectContaining({
            ruleId: 'hl.scenario.cross-account-non-negative',
          }),
        }),
        expect.objectContaining({
          status: 'violated',
          transitionEffect: 'preserves-transition',
          violation: expect.objectContaining({
            ruleId: 'hl.scenario.cross-transfer-margin',
          }),
        }),
      ]),
    )
  })

  it('rejects an invalid second action without exposing a projected prefix', () => {
    const result = simulatePerpAccountScenario({
      snapshot: crossLongSnapshot(),
      actions: [crossDelta('5'), { kind: 'cross-account-value-delta', amount: 'not-decimal' }],
    } as never)

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual([
      expect.objectContaining({ path: expect.stringMatching(/^\/actions\/1\//) }),
    ])
    expect(result.value).not.toHaveProperty('data')
    expect(result.trace.completion).toMatchObject({ status: 'incomplete' })
  })

  it('returns indeterminate at the unsupported allocation action path', () => {
    const result = simulatePerpAccountScenario({
      snapshot: {
        crossAccountValue: '1000',
        positions: [
          {
            kind: 'flat',
            asset: btc,
            marginMode: { kind: 'isolated', marginRemoval: 'allowed' },
            leverage: '10',
          },
        ],
        markets: [market()],
      },
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
          isolatedMarginAllocation: {
            kind: 'not-supported',
            reason: {
              code: 'server-allocation-unverified',
              path: '/actions/0/isolatedMarginAllocation',
            },
          },
        },
      ],
    })

    expect(result.value).toMatchObject({
      status: 'indeterminate',
      reason: { path: '/actions/0/isolatedMarginAllocation' },
    })
    expect(result.trace.completion).toMatchObject({ status: 'incomplete', actionIndex: 0 })
  })

  it('transfers an isolated margin increase from cross to isolated', () => {
    const result = simulatePerpAccountScenario({
      snapshot: isolatedLongSnapshot(),
      actions: [{ kind: 'isolated-margin-delta', asset: btc, amount: '20' }],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.projected.cross.accountValue).toBe('980')
    expect(result.value.data.projected.positions).toEqual([
      expect.objectContaining({
        assetKey: 'hl:testnet:perp::3',
        marginMode: expect.objectContaining({ isolatedMarginValue: '120' }),
      }),
    ])
    expect(result.value.data.delta.crossAccountValue).toBe('-20')
  })

  it('returns indeterminate for strict isolated margin removal', () => {
    const result = simulatePerpAccountScenario({
      snapshot: isolatedLongSnapshot('strict'),
      actions: [{ kind: 'isolated-margin-delta', asset: btc, amount: '-1' }],
    })

    expect(result.value).toMatchObject({
      status: 'indeterminate',
      reason: { path: '/actions/0/amount' },
    })
    expect(result.trace.completion).toMatchObject({ status: 'incomplete', actionIndex: 0 })
  })

  it('does not expose a valid prefix when a later action is indeterminate', () => {
    const result = simulatePerpAccountScenario({
      snapshot: isolatedLongSnapshot('strict'),
      actions: [crossDelta('5'), { kind: 'isolated-margin-delta', asset: btc, amount: '-1' }],
    })

    expect(result.value).toMatchObject({
      status: 'indeterminate',
      reason: { path: '/actions/1/amount' },
    })
    expect(result.value).not.toHaveProperty('data')
    expect(result.trace.completion).toMatchObject({ status: 'incomplete', actionIndex: 1 })
  })

  it('leaves cross liquidation unchanged for a pure cross leverage update', () => {
    const result = simulatePerpAccountScenario({
      snapshot: crossLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'cross',
          leverage: '5',
          marginEffect: { kind: 'none' },
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.projected.positions).toEqual([
      expect.objectContaining({ leverage: '5' }),
    ])
    expect(result.value.data.projected.liquidation.byAsset['hl:testnet:perp::3']).toEqual(
      result.value.data.current.liquidation.byAsset['hl:testnet:perp::3'],
    )
  })

  it('reports a projected leverage update above the selected notional tier maximum', () => {
    const result = simulatePerpAccountScenario({
      snapshot: {
        crossAccountValue: '1000',
        positions: [
          {
            kind: 'open',
            asset: btc,
            signedSize: '20',
            entryPrice: '100',
            marginMode: { kind: 'cross' },
            leverage: '10',
          },
        ],
        markets: [market()],
      },
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'cross',
          leverage: '15',
          marginEffect: { kind: 'none' },
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.constraintChecks).toEqual(
      expect.arrayContaining([
        {
          status: 'violated',
          ruleId: 'hl.scenario.opening-leverage-within-tier',
          transitionEffect: 'preserves-transition',
          violation: {
            ruleId: 'hl.scenario.opening-leverage-within-tier',
            code: 'leverage-exceeds-tier-max-leverage',
            path: '/projected/positions/0/leverage',
            actual: '15',
            limit: '10',
          },
        },
      ]),
    )
  })

  it('marks cross to isolated leverage mode switches as protocol unverified', () => {
    const result = simulatePerpAccountScenario({
      snapshot: crossLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'isolated',
          leverage: '5',
          marginEffect: { kind: 'auto-from-leverage' },
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.trace.maturity).toBe('experimental')
    expect(result.value.data.assumptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'counterfactual-action', protocolSupport: 'unverified' }),
      ]),
    )
  })

  it('rejects preserve-isolated-margin for a cross to isolated mode switch', () => {
    const result = simulatePerpAccountScenario({
      snapshot: crossLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'isolated',
          leverage: '5',
          marginEffect: { kind: 'preserve-isolated-margin' },
        },
      ],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: { code: 'invalid-margin-effect', path: '/actions/0/marginEffect' },
    })
  })

  it('never auto-removes excess isolated margin during an isolated leverage update', () => {
    const result = simulatePerpAccountScenario({
      snapshot: isolatedLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'isolated',
          leverage: '5',
          marginEffect: { kind: 'auto-from-leverage' },
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.projected.cross.accountValue).toBe('1000')
    expect(result.value.data.projected.positions[0]).toMatchObject({
      leverage: '5',
      marginMode: { kind: 'isolated', isolatedMarginValue: '100' },
    })
    expect(result.value.data.actions[0]).toMatchObject({
      accountValueDelta: '0',
      marginDelta: '0',
    })
  })

  it('applies an explicit isolated margin delta during an isolated leverage update', () => {
    const result = simulatePerpAccountScenario({
      snapshot: isolatedLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'isolated',
          leverage: '5',
          marginEffect: { kind: 'explicit-isolated-margin-delta', amount: '20' },
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.projected.cross.accountValue).toBe('980')
    expect(result.value.data.projected.positions[0]?.marginMode).toMatchObject({
      kind: 'isolated',
      isolatedMarginValue: '120',
    })
  })

  it('releases all isolated margin when switching an isolated position to cross', () => {
    const result = simulatePerpAccountScenario({
      snapshot: isolatedLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'cross',
          leverage: '10',
          marginEffect: { kind: 'release-all-isolated-to-cross' },
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.projected.cross.accountValue).toBe('1100')
    expect(result.value.data.projected.positions[0]?.marginMode).toEqual({ kind: 'cross' })
    expect(result.value.data.delta.isolatedMarginValues['hl:testnet:perp::3']).toBe('-100')
  })

  it('opens an isolated position with auto-from-leverage exactly once', () => {
    const result = simulatePerpAccountScenario({
      snapshot: {
        crossAccountValue: '1000',
        positions: [
          {
            kind: 'flat',
            asset: btc,
            marginMode: { kind: 'isolated', marginRemoval: 'allowed' },
            leverage: '10',
          },
        ],
        markets: [market()],
      },
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
          isolatedMarginAllocation: { kind: 'auto-from-leverage' },
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.projected.cross.accountValue).toBe('990')
    expect(result.value.data.projected.positions[0]).toMatchObject({
      state: { kind: 'open', signedSize: '1', entryPrice: '100' },
      marginMode: { kind: 'isolated', isolatedMarginValue: '10' },
    })
    expect(result.value.data.actions[0]).toMatchObject({
      accountValueDelta: '-10',
      marginDelta: '10',
    })
  })

  it('keeps the scenario formula id aligned with the public manifest', () => {
    const result = simulatePerpAccountScenario({
      snapshot: crossLongSnapshot(),
      actions: [crossDelta('1')],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.trace.formulaId).toBe('hl.scenario.perp-account.simulate')
    expect(result.value.data.actions[0]?.formulaIds).toContain('hl.scenario.perp-account.simulate')
  })

  it.each([
    ['reduce', { side: 'sell', size: '1', price: '110', fee: { kind: 'none' } }],
    ['close', { side: 'sell', size: '2', price: '110', fee: { kind: 'none' } }],
    ['flip', { side: 'sell', size: '3', price: '110', fee: { kind: 'none' } }],
  ] as const)('returns indeterminate for isolated %s fill reallocation', (_name, fill) => {
    const result = simulatePerpAccountScenario({
      snapshot: isolatedLongSnapshot(),
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill,
          isolatedMarginAllocation: { kind: 'not-applicable' },
        },
      ],
    })

    expect(result.value.status).toBe('indeterminate')
    expect(result.trace.completion).toMatchObject({ status: 'incomplete', actionIndex: 0 })
  })

  it('rejects duplicate market asset identities before applying actions', () => {
    const result = simulatePerpAccountScenario({
      snapshot: {
        ...crossLongSnapshot(),
        markets: [market(btc), market({ ...btc })],
      },
      actions: [crossDelta('1')],
    })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual([
      expect.objectContaining({ path: expect.stringMatching(/^\/snapshot\/markets/) }),
    ])
  })

  it('rejects actions targeting assets outside the frozen market set', () => {
    const result = simulatePerpAccountScenario({
      snapshot: crossLongSnapshot(),
      actions: [crossDelta('1'), { kind: 'isolated-margin-delta', asset: eth, amount: '1' }],
    })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual([
      expect.objectContaining({ path: expect.stringMatching(/^\/actions\/1\/asset/) }),
    ])
  })

  it('blocks a cross withdrawal that would make cross account value negative', () => {
    const result = simulatePerpAccountScenario({
      snapshot: { crossAccountValue: '1', positions: [], markets: [] },
      actions: [crossDelta('-2')],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: {
        code: 'cross-account-non-negative-constraint',
        path: '/actions/0/amount',
      },
    })
  })

  it('blocks a cross withdrawal that would breach maintenance margin before transfer margin', () => {
    const result = simulatePerpAccountScenario({
      snapshot: {
        crossAccountValue: '100',
        positions: [
          {
            kind: 'open',
            asset: btc,
            signedSize: '100',
            entryPrice: '100',
            marginMode: { kind: 'cross' },
            leverage: '20',
          },
        ],
        markets: [market()],
      },
      actions: [crossDelta('-50')],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: {
        code: 'cross-maintenance-margin-constraint',
        path: '/actions/0/amount',
      },
    })
  })

  it('blocks an isolated margin removal that would make isolated account value negative', () => {
    const result = simulatePerpAccountScenario({
      snapshot: isolatedLongSnapshot('allowed'),
      actions: [{ kind: 'isolated-margin-delta', asset: btc, amount: '-101' }],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: {
        code: 'isolated-account-non-negative-constraint',
        path: '/actions/0/amount',
      },
    })
  })

  it('blocks an isolated margin removal that would breach maintenance margin before transfer margin', () => {
    const result = simulatePerpAccountScenario({
      snapshot: {
        crossAccountValue: '1000',
        positions: [
          {
            kind: 'open',
            asset: btc,
            signedSize: '100',
            entryPrice: '100',
            marginMode: {
              kind: 'isolated',
              isolatedMarginValue: '60',
              marginRemoval: 'allowed',
            },
            leverage: '20',
          },
        ],
        markets: [market()],
      },
      actions: [{ kind: 'isolated-margin-delta', asset: btc, amount: '-10' }],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: {
        code: 'isolated-maintenance-margin-constraint',
        path: '/actions/0/amount',
      },
    })
  })

  it('returns indeterminate when an action targets a market asset without an open position', () => {
    const result = simulatePerpAccountScenario({
      snapshot: { crossAccountValue: '1000', positions: [], markets: [market()] },
      actions: [{ kind: 'isolated-margin-delta', asset: btc, amount: '1' }],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: { code: 'missing-position', path: '/actions/0/asset' },
    })
  })

  it('requires an open isolated position for isolated margin deltas', () => {
    const result = simulatePerpAccountScenario({
      snapshot: crossLongSnapshot(),
      actions: [{ kind: 'isolated-margin-delta', asset: btc, amount: '1' }],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: { code: 'isolated-position-required', path: '/actions/0/asset' },
    })
  })

  it('returns the provided reason for unsupported leverage margin effects', () => {
    const result = simulatePerpAccountScenario({
      snapshot: crossLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'cross',
          leverage: '10',
          marginEffect: {
            kind: 'not-supported',
            reason: { code: 'server-leverage-unverified', path: '/actions/0/marginEffect' },
          },
        },
      ],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: { code: 'server-leverage-unverified', path: '/actions/0/marginEffect' },
    })
  })

  it('reconstructs supported public not-supported reasons without exposing extra input fields', () => {
    const result = simulatePerpAccountScenario({
      snapshot: crossLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'cross',
          leverage: '10',
          marginEffect: {
            kind: 'not-supported',
            reason: {
              code: 'server-leverage-unverified',
              path: '/actions/0/marginEffect',
              details: {
                mode: 'cross',
                nested: { source: 'caller' },
                retryable: false,
                attempts: [1, null],
              },
              sourceRefs: ['hl.gitbook.exchange.update-leverage'],
            },
          },
        },
      ],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: {
        code: 'server-leverage-unverified',
        path: '/actions/0/marginEffect',
        details: {
          mode: 'cross',
          nested: { source: 'caller' },
          retryable: false,
          attempts: [1, null],
        },
        sourceRefs: ['hl.gitbook.exchange.update-leverage'],
      },
    })
  })

  it('rejects margin effects on a cross to cross leverage update', () => {
    const result = simulatePerpAccountScenario({
      snapshot: crossLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'cross',
          leverage: '10',
          marginEffect: { kind: 'auto-from-leverage' },
        },
      ],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: { code: 'invalid-margin-effect', path: '/actions/0/marginEffect' },
    })
  })

  it('rejects no-op margin effects for isolated leverage targets', () => {
    const result = simulatePerpAccountScenario({
      snapshot: isolatedLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'isolated',
          leverage: '10',
          marginEffect: { kind: 'none' },
        },
      ],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: { code: 'invalid-margin-effect', path: '/actions/0/marginEffect' },
    })
  })

  it('rejects release-all margin effects for isolated leverage targets', () => {
    const result = simulatePerpAccountScenario({
      snapshot: isolatedLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'isolated',
          leverage: '10',
          marginEffect: { kind: 'release-all-isolated-to-cross' },
        },
      ],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: { code: 'invalid-margin-effect', path: '/actions/0/marginEffect' },
    })
  })

  it('rejects non-release margin effects for isolated to cross leverage targets', () => {
    const result = simulatePerpAccountScenario({
      snapshot: isolatedLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'cross',
          leverage: '10',
          marginEffect: { kind: 'none' },
        },
      ],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: { code: 'invalid-margin-effect', path: '/actions/0/marginEffect' },
    })
  })

  it('returns indeterminate when a normalized leverage auto allocation loses its market', () => {
    const normalized = normalizedScenario({
      snapshot: crossLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'isolated',
          leverage: '5',
          marginEffect: { kind: 'auto-from-leverage' },
        },
      ],
    })

    const applied = applyActions({ ...normalized, markets: new Map() })

    expect(applied).toEqual({
      ok: false,
      reason: { code: 'missing-market', path: '/actions/0/asset' },
      actionIndex: 0,
    })
  })

  it('returns indeterminate for an undefined normalized action', () => {
    const normalized = normalizedScenario({
      snapshot: crossLongSnapshot(),
      actions: [crossDelta('1')],
    })

    const applied = applyActions({
      ...normalized,
      actions: [undefined, ...normalized.actions],
    } as typeof normalized)

    expect(applied).toEqual({
      ok: false,
      reason: { code: 'normalized-action-invariant', path: '/actions/0' },
      actionIndex: 0,
    })
  })

  it('preserves isolated margin during an isolated leverage update when requested', () => {
    const result = simulatePerpAccountScenario({
      snapshot: isolatedLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'isolated',
          leverage: '5',
          marginEffect: { kind: 'preserve-isolated-margin' },
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.actions[0]).toMatchObject({
      accountValueDelta: '0',
      marginDelta: '0',
    })
  })

  it('blocks isolated leverage margin increases when cross transfer constraints fail', () => {
    const result = simulatePerpAccountScenario({
      snapshot: { ...crossLongSnapshot(), crossAccountValue: '5' },
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'isolated',
          leverage: '5',
          marginEffect: { kind: 'explicit-isolated-margin-delta', amount: '10' },
        },
      ],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: { code: 'cross-account-non-negative-constraint', path: '/actions/0/marginEffect' },
    })
  })

  it('returns indeterminate when a normalized leverage target is neither cross nor isolated', () => {
    const normalized = normalizedScenario({
      snapshot: crossLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'cross',
          leverage: '5',
          marginEffect: { kind: 'none' },
        },
      ],
    })
    const malformed = {
      ...normalized,
      actions: [{ ...normalized.actions[0], targetMode: 'portfolio' }],
    } as unknown as typeof normalized

    const applied = applyActions(malformed)

    expect(applied).toEqual({
      ok: false,
      reason: { code: 'normalized-action-invariant', path: '/actions/0/targetMode' },
      actionIndex: 0,
    })
  })

  it('returns indeterminate for an unknown normalized position margin mode during leverage update', () => {
    const normalized = normalizedScenario({
      snapshot: crossLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'cross',
          leverage: '5',
          marginEffect: { kind: 'release-all-isolated-to-cross' },
        },
      ],
    })
    const malformed = {
      ...normalized,
      positions: [
        {
          ...normalized.positions[0],
          marginMode: { kind: 'portfolio-margin' },
        },
      ],
    } as unknown as typeof normalized

    const applied = applyActions(malformed)

    expect(applied).toEqual({
      ok: false,
      reason: {
        code: 'normalized-state-invariant',
        path: '/actions/0/asset/marginMode',
      },
      actionIndex: 0,
    })
  })

  it('returns indeterminate for an unknown normalized leverage margin effect', () => {
    const normalized = normalizedScenario({
      snapshot: isolatedLongSnapshot(),
      actions: [
        {
          kind: 'set-leverage',
          asset: btc,
          targetMode: 'isolated',
          leverage: '5',
          marginEffect: { kind: 'preserve-isolated-margin' },
        },
      ],
    })
    const malformed = {
      ...normalized,
      actions: [
        {
          ...normalized.actions[0],
          marginEffect: { kind: 'portfolio-margin' },
        },
      ],
    } as unknown as typeof normalized

    const applied = applyActions(malformed)

    expect(applied).toEqual({
      ok: false,
      reason: { code: 'normalized-action-invariant', path: '/actions/0/marginEffect' },
      actionIndex: 0,
    })
  })

  it('returns indeterminate for an unknown normalized action kind', () => {
    const normalized = normalizedScenario({ snapshot: crossLongSnapshot(), actions: [] })
    const malformed = {
      ...normalized,
      actions: [{ kind: 'rebalance', assetKey: 'hl:testnet:perp::3' }],
    } as unknown as typeof normalized

    const applied = applyActions(malformed)

    expect(applied).toEqual({
      ok: false,
      reason: { code: 'normalized-action-invariant', path: '/actions/0/kind' },
      actionIndex: 0,
    })
  })

  it('keeps flat positions out of liquidation inputs', () => {
    const result = simulatePerpAccountScenario({
      snapshot: {
        crossAccountValue: '1000',
        positions: [
          {
            kind: 'open',
            asset: btc,
            signedSize: '2',
            entryPrice: '100',
            marginMode: { kind: 'cross' },
            leverage: '10',
          },
          {
            kind: 'flat',
            asset: eth,
            marginMode: { kind: 'cross' },
            leverage: '10',
          },
        ],
        markets: [market(btc), market(eth)],
      },
      actions: [],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.current.liquidation.byAsset['hl:testnet:perp::4']).toBeNull()
  })

  it('computes liquidation for each open target without confusing other open positions', () => {
    const result = simulatePerpAccountScenario({
      snapshot: {
        crossAccountValue: '1000',
        positions: [
          {
            kind: 'open',
            asset: btc,
            signedSize: '2',
            entryPrice: '100',
            marginMode: { kind: 'cross' },
            leverage: '10',
          },
          {
            kind: 'open',
            asset: eth,
            signedSize: '-1',
            entryPrice: '100',
            marginMode: { kind: 'cross' },
            leverage: '10',
          },
        ],
        markets: [market(btc), market(eth)],
      },
      actions: [],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(Object.keys(result.value.data.current.liquidation.byAsset).sort()).toEqual([
      'hl:testnet:perp::3',
      'hl:testnet:perp::4',
    ])
  })

  it('throws when cross transfer constraint facts lose a validated market', () => {
    const normalized = normalizedScenario({ snapshot: crossLongSnapshot(), actions: [] })

    expect(() =>
      transferConstraintReason(buildWorking(normalized), new Map(), '/actions/0/amount', {
        cross: true,
      }),
    ).toThrow('market already validated')
  })

  it('throws when isolated transfer constraint facts lose a validated market', () => {
    const normalized = normalizedScenario({ snapshot: isolatedLongSnapshot(), actions: [] })

    expect(() =>
      transferConstraintReason(buildWorking(normalized), new Map(), '/actions/0/amount', {
        cross: false,
        isolatedAssetKey: 'hl:testnet:perp::3',
      }),
    ).toThrow('market already validated')
  })

  it('returns missing position when an isolated transfer constraint targets absent state', () => {
    const normalized = normalizedScenario({ snapshot: crossLongSnapshot(), actions: [] })

    const reason = transferConstraintReason(
      buildWorking(normalized),
      normalized.markets,
      '/actions/0/amount',
      { cross: false, isolatedAssetKey: 'hl:testnet:perp::4' },
    )

    expect(reason).toEqual({ code: 'missing-position', path: '/actions/0/amount' })
  })

  it('requires isolated state for isolated transfer constraint targets', () => {
    const normalized = normalizedScenario({ snapshot: crossLongSnapshot(), actions: [] })

    const reason = transferConstraintReason(
      buildWorking(normalized),
      normalized.markets,
      '/actions/0/amount',
      { cross: false, isolatedAssetKey: 'hl:testnet:perp::3' },
    )

    expect(reason).toEqual({ code: 'isolated-position-required', path: '/actions/0/amount' })
  })

  it('computes deltas for projected positions missing from the current view', () => {
    const normalized = normalizedScenario({ snapshot: crossLongSnapshot(), actions: [] })
    const current = {
      ...accountView(buildWorking(normalized), normalized.markets),
      positions: [],
      liquidation: { byAsset: {} },
    }
    const projected = accountView(buildWorking(normalized), normalized.markets)

    const delta = computeDelta(current, projected, 0)

    expect(delta.marginRequirements['hl:testnet:perp::3']).toBe('5')
    expect(delta.liquidationPrices['hl:testnet:perp::3']).toBeNull()
  })

  it('requires an isolated margin allocation when an isolated fill opens exposure', () => {
    const result = simulatePerpAccountScenario({
      snapshot: {
        crossAccountValue: '1000',
        positions: [
          {
            kind: 'flat',
            asset: btc,
            marginMode: { kind: 'isolated', marginRemoval: 'allowed' },
            leverage: '10',
          },
        ],
        markets: [market()],
      },
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
          isolatedMarginAllocation: { kind: 'not-applicable' },
        },
      ],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: {
        code: 'isolated-margin-allocation-required',
        path: '/actions/0/isolatedMarginAllocation',
      },
    })
  })

  it('applies an explicit isolated allocation when an isolated fill opens exposure', () => {
    const result = simulatePerpAccountScenario({
      snapshot: {
        crossAccountValue: '1000',
        positions: [
          {
            kind: 'flat',
            asset: btc,
            marginMode: { kind: 'isolated', marginRemoval: 'allowed' },
            leverage: '10',
          },
        ],
        markets: [market()],
      },
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
          isolatedMarginAllocation: { kind: 'explicit-margin-delta', amount: '12' },
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.actions[0]).toMatchObject({
      accountValueDelta: '-12',
      marginDelta: '12',
    })
  })

  it('rejects an isolated allocation on a cross fill', () => {
    const result = simulatePerpAccountScenario({
      snapshot: crossLongSnapshot(),
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
          isolatedMarginAllocation: { kind: 'auto-from-leverage' },
        },
      ],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: {
        code: 'invalid-isolated-allocation',
        path: '/actions/0/isolatedMarginAllocation',
      },
    })
  })

  it('returns indeterminate when a normalized isolated auto allocation loses its market', () => {
    const normalized = normalizedScenario({
      snapshot: {
        crossAccountValue: '1000',
        positions: [
          {
            kind: 'flat',
            asset: btc,
            marginMode: { kind: 'isolated', marginRemoval: 'allowed' },
            leverage: '10',
          },
        ],
        markets: [market()],
      },
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
          isolatedMarginAllocation: { kind: 'auto-from-leverage' },
        },
      ],
    })

    const applied = applyActions({ ...normalized, markets: new Map() })

    expect(applied).toEqual({
      ok: false,
      reason: { code: 'missing-market', path: '/actions/0/asset' },
      actionIndex: 0,
    })
  })

  it('returns indeterminate when a normalized isolated auto allocation loses its second market lookup', () => {
    const normalized = normalizedScenario({
      snapshot: {
        crossAccountValue: '1000',
        positions: [
          {
            kind: 'flat',
            asset: btc,
            marginMode: { kind: 'isolated', marginRemoval: 'allowed' },
            leverage: '10',
          },
        ],
        markets: [market()],
      },
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
          isolatedMarginAllocation: { kind: 'auto-from-leverage' },
        },
      ],
    })
    const markets = new Map(normalized.markets)
    let calls = 0
    const flakyMarkets = {
      get(key: string) {
        calls += 1
        return calls === 1 ? markets.get(key) : undefined
      },
    } as typeof normalized.markets

    const applied = applyActions({ ...normalized, markets: flakyMarkets })

    expect(applied).toEqual({
      ok: false,
      reason: { code: 'missing-market', path: '/actions/0/asset' },
      actionIndex: 0,
    })
  })

  it('returns indeterminate for a normalized isolated fill allocation kind invariant failure', () => {
    const normalized = normalizedScenario({
      snapshot: isolatedLongSnapshot(),
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
          isolatedMarginAllocation: { kind: 'explicit-margin-delta', amount: '12' },
        },
      ],
    })
    const malformed = {
      ...normalized,
      actions: [
        {
          ...normalized.actions[0],
          isolatedMarginAllocation: { kind: 'caller-defined' },
        },
      ],
    } as unknown as typeof normalized

    const applied = applyActions(malformed)

    expect(applied).toEqual({
      ok: false,
      reason: {
        code: 'normalized-action-invariant',
        path: '/actions/0/isolatedMarginAllocation',
      },
      actionIndex: 0,
    })
  })

  it('returns indeterminate when an isolated fill transfer sees a normalized mode invariant failure', () => {
    const normalized = normalizedScenario({
      snapshot: isolatedLongSnapshot(),
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
          isolatedMarginAllocation: { kind: 'explicit-margin-delta', amount: '12' },
        },
      ],
    })
    let kindReads = 0
    const marginMode = {
      get kind() {
        kindReads += 1
        return kindReads < 2 ? 'isolated' : 'cross'
      },
      isolatedMarginValue: '100',
      isolatedMarginValueDecimal:
        normalized.positions[0]?.marginMode.kind === 'isolated'
          ? normalized.positions[0].marginMode.isolatedMarginValueDecimal
          : undefined,
      marginRemoval: 'allowed',
    }
    const malformed = {
      ...normalized,
      positions: [{ ...normalized.positions[0], marginMode }],
    } as typeof normalized

    const applied = applyActions(malformed)

    expect(applied).toEqual({
      ok: false,
      reason: { code: 'normalized-state-invariant', path: '/actions/0/asset' },
      actionIndex: 0,
    })
  })

  it('returns indeterminate when an isolated transfer sees a normalized mode invariant failure', () => {
    const normalized = normalizedScenario({
      snapshot: isolatedLongSnapshot(),
      actions: [{ kind: 'isolated-margin-delta', asset: btc, amount: '1' }],
    })
    let kindReads = 0
    const marginMode = {
      get kind() {
        kindReads += 1
        return kindReads === 1 ? 'isolated' : 'cross'
      },
      isolatedMarginValue: '100',
      isolatedMarginValueDecimal:
        normalized.positions[0]?.marginMode.kind === 'isolated'
          ? normalized.positions[0].marginMode.isolatedMarginValueDecimal
          : undefined,
      marginRemoval: 'allowed',
    }
    const malformed = {
      ...normalized,
      positions: [{ ...normalized.positions[0], marginMode }],
    } as typeof normalized

    const applied = applyActions(malformed)

    expect(applied).toEqual({
      ok: false,
      reason: { code: 'normalized-state-invariant', path: '/actions/0/asset' },
      actionIndex: 0,
    })
  })

  it('keeps isolated no-op fills from requiring additional margin allocation', () => {
    const result = simulatePerpAccountScenario({
      snapshot: isolatedLongSnapshot(),
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: { side: 'buy', size: '0', price: '100', fee: { kind: 'none' } },
          isolatedMarginAllocation: { kind: 'not-applicable' },
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.actions[0]).toMatchObject({
      marginDelta: '0',
      positionEffect: 'no-op',
    })
  })

  it('returns indeterminate for an unknown normalized isolated no-op allocation', () => {
    const normalized = normalizedScenario({
      snapshot: isolatedLongSnapshot(),
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: { side: 'buy', size: '0', price: '100', fee: { kind: 'none' } },
          isolatedMarginAllocation: { kind: 'not-applicable' },
        },
      ],
    })
    const malformed = {
      ...normalized,
      actions: [
        {
          ...normalized.actions[0],
          isolatedMarginAllocation: { kind: 'portfolio-margin' },
        },
      ],
    } as unknown as typeof normalized

    const applied = applyActions(malformed)

    expect(applied).toEqual({
      ok: false,
      reason: {
        code: 'normalized-action-invariant',
        path: '/actions/0/isolatedMarginAllocation',
      },
      actionIndex: 0,
    })
  })

  it('does not auto-remove excess isolated margin when an isolated fill increases exposure', () => {
    const result = simulatePerpAccountScenario({
      snapshot: isolatedLongSnapshot(),
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
          isolatedMarginAllocation: { kind: 'auto-from-leverage' },
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.actions[0]).toMatchObject({
      accountValueDelta: '0',
      marginDelta: '0',
      positionEffect: 'increase',
    })
  })

  it('blocks isolated fill allocation when the cross transfer would breach constraints', () => {
    const result = simulatePerpAccountScenario({
      snapshot: {
        crossAccountValue: '25',
        positions: [
          {
            kind: 'flat',
            asset: btc,
            marginMode: { kind: 'isolated', marginRemoval: 'allowed' },
            leverage: '10',
          },
          {
            kind: 'open',
            asset: eth,
            signedSize: '2',
            entryPrice: '100',
            marginMode: { kind: 'cross' },
            leverage: '20',
          },
        ],
        markets: [market(), market(eth)],
      },
      actions: [
        {
          kind: 'fill',
          asset: btc,
          fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
          isolatedMarginAllocation: { kind: 'auto-from-leverage' },
        },
      ],
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: {
        code: 'cross-transfer-margin-constraint',
        path: '/actions/0/isolatedMarginAllocation',
      },
    })
  })

  it('throws an invariant failure when a market lookup disappears during liquidation', () => {
    const normalized = normalizedScenario({ snapshot: crossLongSnapshot(), actions: [] })
    const markets = new Map(normalized.markets)
    let calls = 0
    const flakyMarkets = {
      get(key: string) {
        calls += 1
        return calls === 1 ? markets.get(key) : undefined
      },
    } as ReadonlyMap<
      string,
      typeof normalized.markets extends ReadonlyMap<string, infer M> ? M : never
    >

    expect(() => accountView(buildWorking(normalized), flakyMarkets)).toThrow(
      'normalized scenario invariant failed at /liquidation/hl:testnet:perp::3/positions/hl:testnet:perp::3/market',
    )
  })

  it('throws an invariant failure when a state iterator omits the liquidation target', () => {
    const normalized = normalizedScenario({ snapshot: crossLongSnapshot(), actions: [] })
    const state = buildWorking(normalized)
    let calls = 0
    const defensiveState = {
      ...state,
      positions: {
        values() {
          calls += 1
          return calls === 1 ? state.positions.values() : new Map().values()
        },
      },
    } as typeof state

    expect(() => accountView(defensiveState, normalized.markets)).toThrow(
      'normalized scenario invariant failed at /liquidation/hl:testnet:perp::3/target',
    )
  })

  it('throws when the account view is asked to render a position without a market', () => {
    const normalized = normalizedScenario({ snapshot: crossLongSnapshot(), actions: [] })

    expect(() => accountView(buildWorking(normalized), new Map())).toThrow(
      'market already validated',
    )
  })

  it.each([
    ['root shape', null, { code: 'invalid-input-shape', path: '' }],
    [
      'snapshot shape',
      { snapshot: null, actions: [] },
      { code: 'invalid-input-shape', path: '/snapshot' },
    ],
    [
      'cross account value',
      {
        snapshot: { ...crossLongSnapshot(), crossAccountValue: null },
        actions: [],
      },
      { code: 'invalid-decimal-string', path: '/snapshot/crossAccountValue' },
    ],
    [
      'markets array',
      {
        snapshot: { ...crossLongSnapshot(), markets: null },
        actions: [],
      },
      { code: 'invalid-input-shape', path: '/snapshot/markets' },
    ],
    [
      'positions array',
      {
        snapshot: { ...crossLongSnapshot(), positions: null },
        actions: [],
      },
      { code: 'invalid-input-shape', path: '/snapshot/positions' },
    ],
    [
      'actions array',
      {
        snapshot: crossLongSnapshot(),
        actions: null,
      },
      { code: 'invalid-input-shape', path: '/actions' },
    ],
    [
      'market shape',
      {
        snapshot: { ...crossLongSnapshot(), markets: [{ ...market(), extra: true }] },
        actions: [],
      },
      { code: 'invalid-input-shape', path: '/snapshot/markets/0' },
    ],
    [
      'market asset',
      {
        snapshot: { ...crossLongSnapshot(), markets: [{ ...market(), asset: null }] },
        actions: [],
      },
      { code: 'invalid-input-shape', path: '/snapshot/markets/0/asset' },
    ],
    [
      'market mark price',
      {
        snapshot: { ...crossLongSnapshot(), markets: [{ ...market(), markPrice: '0' }] },
        actions: [],
      },
      { code: 'non-positive-decimal', path: '/snapshot/markets/0/markPrice' },
    ],
    [
      'market max leverage decimal',
      {
        snapshot: { ...crossLongSnapshot(), markets: [{ ...market(), maxLeverage: null }] },
        actions: [],
      },
      { code: 'invalid-decimal-string', path: '/snapshot/markets/0/maxLeverage' },
    ],
    [
      'market max leverage',
      {
        snapshot: { ...crossLongSnapshot(), markets: [{ ...market(), maxLeverage: '1.5' }] },
        actions: [],
      },
      { code: 'invalid-max-leverage', path: '/snapshot/markets/0/maxLeverage' },
    ],
    [
      'market tiers',
      {
        snapshot: { ...crossLongSnapshot(), markets: [{ ...market(), marginTiers: [] }] },
        actions: [],
      },
      { code: 'invalid-margin-tiers', path: '/snapshot/markets/0/marginTiers' },
    ],
    [
      'market leverage tier mismatch',
      {
        snapshot: { ...crossLongSnapshot(), markets: [{ ...market(), maxLeverage: '10' }] },
        actions: [],
      },
      { code: 'max-leverage-tier-mismatch', path: '/snapshot/markets/0/maxLeverage' },
    ],
    [
      'position shape',
      {
        snapshot: {
          ...crossLongSnapshot(),
          positions: [
            {
              kind: 'open',
              asset: btc,
              signedSize: '2',
              marginMode: { kind: 'cross' },
              leverage: '10',
            },
          ],
        },
        actions: [],
      },
      { code: 'invalid-input-shape', path: '/snapshot/positions/0' },
    ],
    [
      'position kind',
      {
        snapshot: {
          ...crossLongSnapshot(),
          positions: [{ ...crossLongSnapshot().positions[0], kind: 'resting' }],
        },
        actions: [],
      },
      { code: 'invalid-position-kind', path: '/snapshot/positions/0/kind' },
    ],
    [
      'position asset shape',
      {
        snapshot: {
          ...crossLongSnapshot(),
          positions: [{ ...crossLongSnapshot().positions[0], asset: null }],
        },
        actions: [],
      },
      { code: 'invalid-input-shape', path: '/snapshot/positions/0/asset' },
    ],
    [
      'position asset',
      {
        snapshot: {
          ...crossLongSnapshot(),
          positions: [{ ...crossLongSnapshot().positions[0], asset: eth }],
        },
        actions: [],
      },
      { code: 'unknown-market-asset', path: '/snapshot/positions/0/asset' },
    ],
    [
      'position size',
      {
        snapshot: {
          ...crossLongSnapshot(),
          positions: [{ ...crossLongSnapshot().positions[0], signedSize: '0' }],
        },
        actions: [],
      },
      { code: 'zero-open-position-size', path: '/snapshot/positions/0/signedSize' },
    ],
    [
      'position leverage decimal',
      {
        snapshot: {
          ...crossLongSnapshot(),
          positions: [{ ...crossLongSnapshot().positions[0], leverage: null }],
        },
        actions: [],
      },
      { code: 'invalid-decimal-string', path: '/snapshot/positions/0/leverage' },
    ],
    [
      'position leverage',
      {
        snapshot: {
          ...crossLongSnapshot(),
          positions: [{ ...crossLongSnapshot().positions[0], leverage: '21' }],
        },
        actions: [],
      },
      { code: 'invalid-leverage', path: '/snapshot/positions/0/leverage' },
    ],
    [
      'position margin mode shape',
      {
        snapshot: {
          ...crossLongSnapshot(),
          positions: [
            {
              ...crossLongSnapshot().positions[0],
              marginMode: { kind: 'isolated', isolatedMarginValue: '100' },
            },
          ],
        },
        actions: [],
      },
      { code: 'invalid-input-shape', path: '/snapshot/positions/0/marginMode' },
    ],
    [
      'position margin mode',
      {
        snapshot: {
          ...crossLongSnapshot(),
          positions: [
            {
              ...crossLongSnapshot().positions[0],
              marginMode: {
                kind: 'portfolio',
                isolatedMarginValue: '100',
                marginRemoval: 'allowed',
              },
            },
          ],
        },
        actions: [],
      },
      { code: 'invalid-margin-mode', path: '/snapshot/positions/0/marginMode/kind' },
    ],
    [
      'position margin removal',
      {
        snapshot: {
          ...crossLongSnapshot(),
          positions: [
            {
              ...crossLongSnapshot().positions[0],
              marginMode: {
                kind: 'isolated',
                isolatedMarginValue: '100',
                marginRemoval: 'maybe',
              },
            },
          ],
        },
        actions: [],
      },
      { code: 'invalid-margin-removal', path: '/snapshot/positions/0/marginMode/marginRemoval' },
    ],
    [
      'position isolated margin value',
      {
        snapshot: {
          ...crossLongSnapshot(),
          positions: [
            {
              ...crossLongSnapshot().positions[0],
              marginMode: {
                kind: 'isolated',
                isolatedMarginValue: 'bad',
                marginRemoval: 'allowed',
              },
            },
          ],
        },
        actions: [],
      },
      {
        code: 'invalid-decimal-string',
        path: '/snapshot/positions/0/marginMode/isolatedMarginValue',
      },
    ],
    [
      'cross delta shape',
      {
        snapshot: crossLongSnapshot(),
        actions: [{ kind: 'cross-account-value-delta' }],
      },
      { code: 'invalid-input-shape', path: '/actions/0' },
    ],
    [
      'isolated delta shape',
      {
        snapshot: crossLongSnapshot(),
        actions: [{ kind: 'isolated-margin-delta', asset: btc }],
      },
      { code: 'invalid-input-shape', path: '/actions/0' },
    ],
    [
      'isolated delta asset shape',
      {
        snapshot: crossLongSnapshot(),
        actions: [{ kind: 'isolated-margin-delta', asset: null, amount: '1' }],
      },
      { code: 'invalid-input-shape', path: '/actions/0/asset' },
    ],
    [
      'isolated delta amount',
      {
        snapshot: crossLongSnapshot(),
        actions: [{ kind: 'isolated-margin-delta', asset: btc, amount: null }],
      },
      { code: 'invalid-decimal-string', path: '/actions/0/amount' },
    ],
    [
      'duplicate position asset',
      {
        snapshot: {
          ...crossLongSnapshot(),
          positions: [crossLongSnapshot().positions[0], { ...crossLongSnapshot().positions[0] }],
        },
        actions: [],
      },
      { code: 'duplicate-position-asset', path: '/snapshot/positions/1/asset' },
    ],
    [
      'fill asset',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: eth,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: { kind: 'not-applicable' },
          },
        ],
      },
      { code: 'unknown-market-asset', path: '/actions/0/asset' },
    ],
    [
      'fill asset shape',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: null,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: { kind: 'not-applicable' },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/asset' },
    ],
    [
      'fill action shape',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0' },
    ],
    [
      'fill shape',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: { kind: 'not-applicable' },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/fill' },
    ],
    [
      'allocation shape',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: { kind: 'not-applicable', amount: '1' },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/isolatedMarginAllocation' },
    ],
    [
      'allocation kind',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: { kind: 'server-default' },
          },
        ],
      },
      {
        code: 'invalid-isolated-margin-allocation',
        path: '/actions/0/isolatedMarginAllocation/kind',
      },
    ],
    [
      'allocation unsupported shape',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: { kind: 'not-supported' },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/isolatedMarginAllocation' },
    ],
    [
      'allocation unsupported reason code',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: {
              kind: 'not-supported',
              reason: { code: '', path: '/actions/0/isolatedMarginAllocation' },
            },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/isolatedMarginAllocation/reason/code' },
    ],
    [
      'allocation unsupported reason primitive',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: {
              kind: 'not-supported',
              reason: null,
            },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/isolatedMarginAllocation/reason' },
    ],
    [
      'allocation unsupported reason extra key',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: {
              kind: 'not-supported',
              reason: { code: 'server-allocation-unverified', actual: 'hidden' },
            },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/isolatedMarginAllocation/reason' },
    ],
    [
      'allocation unsupported reason missing code',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: {
              kind: 'not-supported',
              reason: { path: '/actions/0/isolatedMarginAllocation' },
            },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/isolatedMarginAllocation/reason/code' },
    ],
    [
      'allocation unsupported reason uninspectable',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: {
              kind: 'not-supported',
              reason: new Proxy(
                { code: 'server-allocation-unverified' },
                {
                  ownKeys() {
                    throw new Error('blocked')
                  },
                },
              ),
            },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/isolatedMarginAllocation/reason' },
    ],
    [
      'allocation unsupported reason details',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: {
              kind: 'not-supported',
              reason: {
                code: 'server-allocation-unverified',
                details: { nested: { value: undefined } },
              },
            },
          },
        ],
      },
      {
        code: 'invalid-input-shape',
        path: '/actions/0/isolatedMarginAllocation/reason/details/nested/value',
      },
    ],
    [
      'allocation unsupported reason details primitive',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: {
              kind: 'not-supported',
              reason: { code: 'server-allocation-unverified', details: [] },
            },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/isolatedMarginAllocation/reason/details' },
    ],
    [
      'allocation unsupported reason details symbol key',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: {
              kind: 'not-supported',
              reason: {
                code: 'server-allocation-unverified',
                details: { [Symbol('hidden')]: 'value' },
              },
            },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/isolatedMarginAllocation/reason/details' },
    ],
    [
      'allocation unsupported reason details getter',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: {
              kind: 'not-supported',
              reason: {
                code: 'server-allocation-unverified',
                details: Object.defineProperty({}, 'value', {
                  enumerable: true,
                  get() {
                    throw new Error('getter must not run')
                  },
                }),
              },
            },
          },
        ],
      },
      {
        code: 'invalid-input-shape',
        path: '/actions/0/isolatedMarginAllocation/reason/details/value',
      },
    ],
    [
      'allocation unsupported reason details uninspectable',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: {
              kind: 'not-supported',
              reason: {
                code: 'server-allocation-unverified',
                details: new Proxy(
                  { value: 'ok' },
                  {
                    ownKeys() {
                      throw new Error('blocked')
                    },
                  },
                ),
              },
            },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/isolatedMarginAllocation/reason/details' },
    ],
    [
      'allocation unsupported reason details non-finite number',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: {
              kind: 'not-supported',
              reason: { code: 'server-allocation-unverified', details: { value: Number.NaN } },
            },
          },
        ],
      },
      {
        code: 'invalid-input-shape',
        path: '/actions/0/isolatedMarginAllocation/reason/details/value',
      },
    ],
    [
      'allocation unsupported reason details sparse array',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: {
              kind: 'not-supported',
              reason: {
                code: 'server-allocation-unverified',
                details: { values: Object.assign(new Array(1), { extra: 'bad' }) },
              },
            },
          },
        ],
      },
      {
        code: 'invalid-input-shape',
        path: '/actions/0/isolatedMarginAllocation/reason/details/values/0',
      },
    ],
    [
      'allocation unsupported reason source refs',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: {
              kind: 'not-supported',
              reason: { code: 'server-allocation-unverified', sourceRefs: ['ok', 1] },
            },
          },
        ],
      },
      {
        code: 'invalid-input-shape',
        path: '/actions/0/isolatedMarginAllocation/reason/sourceRefs/1',
      },
    ],
    [
      'allocation amount',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: { kind: 'explicit-margin-delta', amount: 'bad' },
          },
        ],
      },
      { code: 'invalid-decimal-string', path: '/actions/0/isolatedMarginAllocation/amount' },
    ],
    [
      'allocation explicit shape',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'fill',
            asset: btc,
            fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
            isolatedMarginAllocation: { kind: 'explicit-margin-delta' },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/isolatedMarginAllocation' },
    ],
    [
      'set leverage shape',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'set-leverage',
            asset: btc,
            targetMode: 'cross',
            leverage: '10',
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0' },
    ],
    [
      'set leverage asset shape',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'set-leverage',
            asset: null,
            targetMode: 'cross',
            leverage: '10',
            marginEffect: { kind: 'none' },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/asset' },
    ],
    [
      'set leverage target mode',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'set-leverage',
            asset: btc,
            targetMode: 'portfolio',
            leverage: '10',
            marginEffect: { kind: 'none' },
          },
        ],
      },
      { code: 'invalid-target-mode', path: '/actions/0/targetMode' },
    ],
    [
      'set leverage asset',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'set-leverage',
            asset: eth,
            targetMode: 'cross',
            leverage: '10',
            marginEffect: { kind: 'none' },
          },
        ],
      },
      { code: 'unknown-market-asset', path: '/actions/0/asset' },
    ],
    [
      'set leverage decimal',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'set-leverage',
            asset: btc,
            targetMode: 'cross',
            leverage: null,
            marginEffect: { kind: 'none' },
          },
        ],
      },
      { code: 'invalid-decimal-string', path: '/actions/0/leverage' },
    ],
    [
      'set leverage value',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'set-leverage',
            asset: btc,
            targetMode: 'cross',
            leverage: '21',
            marginEffect: { kind: 'none' },
          },
        ],
      },
      { code: 'invalid-leverage', path: '/actions/0/leverage' },
    ],
    [
      'set leverage known effect shape',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'set-leverage',
            asset: btc,
            targetMode: 'cross',
            leverage: '10',
            marginEffect: { kind: 'none', amount: '1' },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/marginEffect' },
    ],
    [
      'set leverage explicit effect shape',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'set-leverage',
            asset: btc,
            targetMode: 'cross',
            leverage: '10',
            marginEffect: { kind: 'explicit-isolated-margin-delta' },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/marginEffect' },
    ],
    [
      'set leverage explicit effect amount',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'set-leverage',
            asset: btc,
            targetMode: 'cross',
            leverage: '10',
            marginEffect: { kind: 'explicit-isolated-margin-delta', amount: null },
          },
        ],
      },
      { code: 'invalid-decimal-string', path: '/actions/0/marginEffect/amount' },
    ],
    [
      'set leverage unsupported effect shape',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'set-leverage',
            asset: btc,
            targetMode: 'cross',
            leverage: '10',
            marginEffect: { kind: 'not-supported' },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/marginEffect' },
    ],
    [
      'set leverage unsupported effect reason path',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'set-leverage',
            asset: btc,
            targetMode: 'cross',
            leverage: '10',
            marginEffect: {
              kind: 'not-supported',
              reason: { code: 'server-leverage-unverified', path: 0 },
            },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/marginEffect/reason/path' },
    ],
    [
      'set leverage unsupported effect reason getter',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'set-leverage',
            asset: btc,
            targetMode: 'cross',
            leverage: '10',
            marginEffect: {
              kind: 'not-supported',
              reason: Object.defineProperty({}, 'code', {
                enumerable: true,
                get() {
                  throw new Error('getter must not run')
                },
              }),
            },
          },
        ],
      },
      { code: 'invalid-input-shape', path: '/actions/0/marginEffect/reason/code' },
    ],
    [
      'set leverage effect kind',
      {
        snapshot: crossLongSnapshot(),
        actions: [
          {
            kind: 'set-leverage',
            asset: btc,
            targetMode: 'cross',
            leverage: '10',
            marginEffect: { kind: 'borrow' },
          },
        ],
      },
      { code: 'invalid-margin-effect', path: '/actions/0/marginEffect/kind' },
    ],
    [
      'action primitive kind',
      {
        snapshot: crossLongSnapshot(),
        actions: [null],
      },
      { code: 'invalid-action-kind', path: '/actions/0/kind' },
    ],
    [
      'action kind',
      {
        snapshot: crossLongSnapshot(),
        actions: [{ kind: 'deposit', amount: '1' }],
      },
      { code: 'invalid-action-kind', path: '/actions/0/kind' },
    ],
  ] as const)('rejects hostile plain data for %s', (_name, input, expected) => {
    expectSingleInvalidIssue(input, expected)
  })
})
