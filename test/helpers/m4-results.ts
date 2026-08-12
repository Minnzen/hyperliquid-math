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

const asset = {
  network: 'mainnet',
  marketKind: 'perp',
  dex: null,
  index: 0,
} as const

function traceContract(result: {
  trace: { formulaId: string; authority: string; maturity: string }
}) {
  return {
    formulaId: result.trace.formulaId,
    authority: result.trace.authority,
    maturity: result.trace.maturity,
  }
}

export function m4Results() {
  const orderValidation = validatePerpOrder({
    price: '100.12',
    size: '0.5',
    szDecimals: 2,
    minimumNotional: { kind: 'available', value: '10' },
    priceBand: { kind: 'available', value: { lowerBound: '90', upperBound: '110' } },
  })
  const maxOrderSize = calculatePerpMaxOrderSize({
    availableCollateral: '100',
    leverage: '5',
    referencePrice: '100',
    currentSignedSize: '2',
    side: 'sell',
    reduceOnly: false,
    szDecimals: 2,
    orderValueLimit: { kind: 'available', value: '600' },
  })
  const reduceOnly = evaluatePerpReduceOnly({
    currentSignedSize: '2',
    side: 'sell',
    requestedSize: '1',
  })
  const slippagePrice = calculatePerpSlippagePrice({
    side: 'buy',
    referencePrice: '100.123',
    slippageBps: '100',
    szDecimals: 2,
  })
  const triggerClassification = classifyPerpTrigger({
    positionSide: 'long',
    orderSide: 'sell',
    markPrice: '100',
    triggerPrice: '110',
  })
  const triggerPrice = derivePerpTriggerPrice({
    position: { kind: 'open', signedSize: '2', entryPrice: '100' },
    target: { kind: 'pnl', amount: '16' },
    cumulativeCost: '4',
  })
  const scaleLadder = buildPerpScaleLadder({
    side: 'buy',
    lowerPrice: '90',
    upperPrice: '110',
    totalSize: '1',
    legCount: 3,
    distribution: 'linear',
    szDecimals: 2,
  })
  const twapExecutionTarget = calculatePerpTwapExecutionTarget({
    totalSize: '12',
    durationMs: 120_000,
    elapsedMs: 60_000,
  })
  const replay = replayPerpAccountEvents({
    snapshot: {
      cashBalance: '1000',
      positions: [{ asset, state: { kind: 'open', signedSize: '2', entryPrice: '100' } }],
    },
    events: [
      {
        kind: 'fill',
        eventId: 'fill-1',
        timestampMs: 1,
        asset,
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
        asset,
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
  const reconciliation = reconcilePerpAccountSnapshot({
    projected: {
      cashBalance: '1010',
      positions: [{ asset, state: { kind: 'open', signedSize: '1', entryPrice: '100' } }],
    },
    observed: {
      cashBalance: '1009.99',
      positions: [{ asset, state: { kind: 'open', signedSize: '1.001', entryPrice: '100.002' } }],
    },
    tolerances: { cashBalance: '0.02', signedSize: '0.002', entryPrice: '0.005' },
    evidence: { kind: 'complete', eventCount: 3 },
  })
  const results = {
    orderValidation,
    maxOrderSize,
    reduceOnly,
    slippagePrice,
    triggerClassification,
    triggerPrice,
    scaleLadder,
    twapExecutionTarget,
    replay,
    reconciliation,
  }

  return {
    values: {
      orderValidation: orderValidation.value,
      maxOrderSize: maxOrderSize.value,
      reduceOnly: reduceOnly.value,
      slippagePrice: slippagePrice.value,
      triggerClassification:
        triggerClassification.value.status === 'ok'
          ? {
              status: 'ok',
              data: {
                classification: triggerClassification.value.data.classification,
                checks: triggerClassification.value.data.checks,
              },
            }
          : triggerClassification.value,
      triggerPrice: triggerPrice.value,
      scaleLadder: scaleLadder.value,
      twapExecutionTarget: twapExecutionTarget.value,
      replay:
        replay.value.status === 'ok'
          ? {
              status: 'ok',
              data: {
                final: replay.value.data.final,
                totals: replay.value.data.totals,
                ledger: replay.value.data.ledger.map((line) => ({
                  kind: line.kind,
                  amount: line.amount,
                })),
              },
            }
          : replay.value,
      reconciliation:
        reconciliation.value.status === 'ok'
          ? {
              status: 'ok',
              data: {
                cashBalanceResidual: reconciliation.value.data.cashBalanceResidual,
                positions: reconciliation.value.data.positions.map((position) => ({
                  assetKey: position.assetKey,
                  status: position.status,
                  signedSizeResidual:
                    'signedSizeResidual' in position ? position.signedSizeResidual : null,
                  entryPriceResidual:
                    'entryPriceResidual' in position ? position.entryPriceResidual : null,
                })),
                checkStatuses: reconciliation.value.data.checks.map((check) => check.status),
                corrected: reconciliation.value.data.corrected,
              },
            }
          : reconciliation.value,
    },
    traceContracts: Object.fromEntries(
      Object.entries(results).map(([name, result]) => [name, traceContract(result)]),
    ),
  }
}
