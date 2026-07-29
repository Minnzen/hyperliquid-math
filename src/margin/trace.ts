import { finalizeTrace } from '../core/finalize-trace.js'
import type {
  Assumption,
  CalculationTrace,
  JsonObject,
  MathReason,
  RoundingDecision,
  TraceStep,
} from '../model/index.js'
import type {
  NormalizedCalculateUnifiedAccountRatioInput,
  NormalizedEvaluatePerpAccountMarginInput,
  NormalizedPerpMarginPosition,
} from './types.js'

type TraceCompletion =
  | { readonly status: 'complete' }
  | { readonly status: 'incomplete'; readonly reason: MathReason }

const decimalSource = 'DECIMALJS.10.6.0'
const officialSourceRefs = [
  'HL.DOC.MARGINING.2026-07-19',
  'HL.DOC.MARGIN_TIERS.2026-07-19',
] as const

function normalizedAsset(position: NormalizedPerpMarginPosition): JsonObject {
  return {
    network: position.asset.network,
    marketKind: position.asset.marketKind,
    dex: position.asset.dex,
    index: position.asset.index,
  }
}

function normalizedPosition(position: NormalizedPerpMarginPosition | undefined): JsonObject {
  if (position === undefined) return {}
  return {
    asset: normalizedAsset(position),
    assetKey: position.assetKey,
    signedSize: position.signedSize,
    markPrice: position.markPrice,
    leverage: position.leverage.value,
    marginMode:
      position.marginMode.kind === 'cross'
        ? { kind: 'cross' }
        : {
            kind: 'isolated',
            isolatedMarginValue: position.marginMode.isolatedMarginValue,
            marginRemoval: position.marginMode.marginRemoval,
          },
    marginTiers: position.marginTiers.map((tier) => ({
      lowerBound: tier.lowerBound,
      maxLeverage: tier.maxLeverage,
      maintenanceRate: tier.maintenanceRate,
      maintenanceDeduction: tier.maintenanceDeduction,
    })),
  }
}

function marginAssumptions(
  input: NormalizedPerpMarginPosition | undefined,
  completion: TraceCompletion,
): readonly Assumption[] {
  if (completion.status !== 'complete' || input === undefined) return []
  return [
    { kind: 'frozen-input', path: '/position/markPrice', value: input.markPrice },
    {
      kind: 'frozen-input',
      path: '/position/marginTiers',
      value: 'caller-provided-complete-tier-rules',
    },
  ]
}

function accountAssumptions(
  input: NormalizedEvaluatePerpAccountMarginInput | undefined,
  completion: TraceCompletion,
): readonly Assumption[] {
  if (completion.status !== 'complete' || input === undefined) return []
  return [
    {
      kind: 'frozen-input',
      path: '/crossAccountValue',
      value: 'same-snapshot-cross-account-value',
    },
    { kind: 'frozen-input', path: '/positions/*/markPrice', value: 'same-snapshot-mark-prices' },
    {
      kind: 'frozen-input',
      path: '/positions/*/marginTiers',
      value: 'caller-provided-complete-tier-rules',
    },
  ]
}

function unifiedAccountAssumptions(
  input: NormalizedCalculateUnifiedAccountRatioInput | undefined,
  completion: TraceCompletion,
): readonly Assumption[] {
  if (completion.status !== 'complete' || input === undefined) return []
  return [
    {
      kind: 'frozen-input',
      path: '/dexes',
      value: 'caller-established-unified-mode-and-complete-relevant-dex-set',
    },
    {
      kind: 'frozen-input',
      path: '/dexes',
      value: 'same-snapshot-per-dex-margin-usage',
    },
    {
      kind: 'frozen-input',
      path: '/spotBalances',
      value: 'same-snapshot-spot-trading-balances',
    },
  ]
}

export function initialMarginTrace(
  input: NormalizedPerpMarginPosition | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
  rounding: readonly RoundingDecision[] = [],
): CalculationTrace {
  return finalizeTrace({
    formulaId: 'hl.margin.initial.calculate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'stable',
    completion,
    normalizedInputs: normalizedPosition(input),
    intermediates,
    rounding,
    assumptions: marginAssumptions(input, completion),
    sourceRefs: ['HLM.SPEC.MARGIN.INITIAL.V1', ...officialSourceRefs, decimalSource],
  })
}

export function maintenanceMarginTrace(
  input: NormalizedPerpMarginPosition | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
): CalculationTrace {
  return finalizeTrace({
    formulaId: 'hl.margin.maintenance.calculate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'stable',
    completion,
    normalizedInputs: normalizedPosition(input),
    intermediates,
    rounding: [],
    assumptions: marginAssumptions(input, completion),
    sourceRefs: ['HLM.SPEC.MARGIN.MAINTENANCE.V1', ...officialSourceRefs, decimalSource],
  })
}

export function accountMarginTrace(
  input: NormalizedEvaluatePerpAccountMarginInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
): CalculationTrace {
  return finalizeTrace({
    formulaId: 'hl.margin.account.evaluate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'stable',
    completion,
    normalizedInputs:
      input === undefined
        ? {}
        : {
            crossAccountValue: input.crossAccountValue,
            positions: input.positions.map((position) => normalizedPosition(position)),
          },
    intermediates,
    rounding: [],
    assumptions: accountAssumptions(input, completion),
    sourceRefs: [
      'HLM.SPEC.MARGIN.ACCOUNT_EVALUATE.V1',
      ...officialSourceRefs,
      'HL.DOC.LIQUIDATIONS.2026-07-19',
      decimalSource,
    ],
  })
}

export function unifiedAccountRatioTrace(
  input: NormalizedCalculateUnifiedAccountRatioInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
  rounding: readonly RoundingDecision[] = [],
): CalculationTrace {
  return finalizeTrace({
    formulaId: 'hl.margin.unified-account-ratio.calculate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'experimental',
    completion,
    normalizedInputs:
      input === undefined
        ? {}
        : {
            dexes: input.dexes.map((dex) => ({
              dexIndex: dex.dexIndex,
              collateralToken: dex.collateralToken,
              crossMaintenanceMarginUsed: dex.crossMaintenanceMarginUsed,
              isolatedMarginUsed: dex.isolatedMarginUsed,
            })),
            spotBalances: input.spotBalances.map((spot) => ({
              token: spot.token,
              total: spot.total,
            })),
          },
    intermediates,
    rounding,
    assumptions: unifiedAccountAssumptions(input, completion),
    sourceRefs: [
      'HLM.SPEC.MARGIN.UNIFIED_ACCOUNT_RATIO.V1',
      'HL.DOC.ACCOUNT_ABSTRACTION.2026-07-30',
      'HL.DOC.INFO.PERP_META.2026-07-30',
      'HL.DOC.INFO.PERP_ACCOUNT.2026-07-30',
      'HL.DOC.INFO.SPOT_BALANCES.2026-07-30',
      decimalSource,
    ],
  })
}
