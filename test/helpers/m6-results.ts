import {
  calculateOutcomeDualPrice,
  calculateOutcomeSettlement,
  calculateUnifiedAccountRatio,
  decodeAssetId,
  encodeAssetId,
  evaluateRecurringOutcome,
} from '../../src/index.js'

function traceContract(result: {
  trace: { formulaId: string; authority: string; maturity: string; sourceRefs: readonly string[] }
}) {
  return {
    formulaId: result.trace.formulaId,
    authority: result.trace.authority,
    maturity: result.trace.maturity,
    sourceRefs: result.trace.sourceRefs,
  }
}

export function m6Results() {
  const outcomeAssetId = encodeAssetId({ kind: 'outcome', outcome: 42, side: 1 })
  const decodedOutcomeAssetId = decodeAssetId({ assetId: 100_000_421 })
  const outcomeDualPrice = calculateOutcomeDualPrice({ price: '0.37' })
  const outcomeSettlement = calculateOutcomeSettlement({
    tokenSide: 'no',
    settleFraction: '0.25',
    size: '3',
    entryPrice: '0.4',
  })
  const recurringPriceBinary = evaluateRecurringOutcome({
    class: 'priceBinary',
    markPrice0: '1',
    t0: 0,
    markPrice1: '3',
    t1: 2,
    settlementTime: 1,
    targetPrice: '2',
  })
  const recurringPriceBucket = evaluateRecurringOutcome({
    class: 'priceBucket',
    markPrice0: '1',
    t0: 0,
    markPrice1: '3',
    t1: 2,
    settlementTime: 1,
    priceThresholds: ['1.5', '2.5'],
  })
  const unifiedAccountRatio = calculateUnifiedAccountRatio({
    dexes: [
      {
        dexIndex: 0,
        collateralToken: 0,
        crossMaintenanceMarginUsed: '1',
        isolatedMarginUsed: '1',
      },
      {
        dexIndex: 1,
        collateralToken: 0,
        crossMaintenanceMarginUsed: '2',
        isolatedMarginUsed: '0',
      },
      {
        dexIndex: 2,
        collateralToken: 1,
        crossMaintenanceMarginUsed: '0',
        isolatedMarginUsed: '0',
      },
    ],
    spotBalances: [
      { token: 0, total: '10' },
      { token: 1, total: '-5' },
    ],
  })
  const results = {
    outcomeAssetId,
    decodedOutcomeAssetId,
    outcomeDualPrice,
    outcomeSettlement,
    recurringPriceBinary,
    recurringPriceBucket,
    unifiedAccountRatio,
  }

  return {
    values: Object.fromEntries(
      Object.entries(results).map(([name, result]) => [name, result.value]),
    ),
    traceContracts: Object.fromEntries(
      Object.entries(results).map(([name, result]) => [name, traceContract(result)]),
    ),
  }
}
