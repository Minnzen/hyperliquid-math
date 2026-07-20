import {
  calculatePerpInitialMargin,
  calculatePerpLiquidationPrice,
  calculatePerpMaintenanceMargin,
  evaluatePerpAccountMargin,
  simulatePerpAccountScenario,
} from '../../src/index.js'

const asset = {
  network: 'mainnet',
  marketKind: 'perp',
  dex: null,
  index: 0,
} as const
const tiers = [
  { lowerBound: '0', maxLeverage: '20' },
  { lowerBound: '1000', maxLeverage: '10' },
] as const
const crossPosition = {
  asset,
  signedSize: '2',
  markPrice: '100',
  leverage: '10',
  marginMode: { kind: 'cross' },
  marginTiers: tiers,
} as const

export function m3Results() {
  const initialMargin = calculatePerpInitialMargin({ position: crossPosition })
  const maintenanceMargin = calculatePerpMaintenanceMargin({ position: crossPosition })
  const accountMargin = evaluatePerpAccountMargin({
    crossAccountValue: '1000',
    positions: [crossPosition],
  })
  const liquidation = calculatePerpLiquidationPrice({
    targetAsset: asset,
    crossAccountValue: '100',
    positions: [
      {
        asset,
        signedSize: '2',
        entryPrice: '100',
        markPrice: '100',
        marginMode: { kind: 'cross' },
        marginTiers: tiers,
      },
    ],
  })
  const scenario = simulatePerpAccountScenario({
    snapshot: {
      crossAccountValue: '1000',
      positions: [
        {
          kind: 'open',
          asset,
          signedSize: '2',
          entryPrice: '100',
          marginMode: { kind: 'cross' },
          leverage: '10',
        },
      ],
      markets: [{ asset, markPrice: '100', maxLeverage: '20', marginTiers: tiers }],
    },
    actions: [{ kind: 'cross-account-value-delta', amount: '5' }],
  })
  return {
    initialMargin: initialMargin.value,
    maintenanceMargin: maintenanceMargin.value,
    accountMargin: accountMargin.value,
    liquidation: liquidation.value,
    scenario:
      scenario.value.status === 'ok'
        ? {
            status: scenario.value.status,
            projected: scenario.value.data.projected,
            delta: scenario.value.data.delta,
            actions: scenario.value.data.actions,
            constraintChecks: scenario.value.data.constraintChecks,
          }
        : scenario.value,
    traceContracts: [
      initialMargin.trace.formulaId,
      maintenanceMargin.trace.formulaId,
      accountMargin.trace.formulaId,
      liquidation.trace.formulaId,
      scenario.trace.formulaId,
      scenario.trace.authority,
      scenario.trace.maturity,
    ],
  }
}
