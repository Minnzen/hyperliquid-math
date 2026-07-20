import type { CalculationTrace, MathReason, RoundingDecision, TraceStep } from '../model/index.js'
import type {
  NormalizedCalculateHip3FeeRatesInput,
  NormalizedEvaluateHip3MarginModeInput,
  NormalizedResolveHip3CollateralSourceInput,
} from './types.js'

type TraceCompletion =
  | { readonly status: 'complete' }
  | { readonly status: 'incomplete'; readonly reason: MathReason }

const decimalSource = 'DECIMALJS.10.6.0'

export function collateralSourceTrace(
  input: NormalizedResolveHip3CollateralSourceInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
): CalculationTrace {
  return {
    formulaId: 'hl.hip3.collateral-source.resolve',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'experimental',
    completion,
    normalizedInputs:
      input === undefined
        ? {}
        : {
            accountAbstractionMode: input.accountAbstractionMode,
            dex: input.dex,
            collateralTokenIndex: input.collateralTokenIndex,
            validatorPerpUsdcTokenIndex: input.validatorPerpUsdcTokenIndex,
          },
    intermediates,
    rounding: [],
    assumptions:
      completion.status === 'complete' && input !== undefined
        ? [
            {
              kind: 'frozen-input',
              path: '/accountAbstractionMode',
              value: 'caller-provided-mode',
            },
            {
              kind: 'frozen-input',
              path: '/dex',
              value: 'caller-provided-dated-dex-snapshot',
            },
            {
              kind: 'frozen-input',
              path: '/collateralTokenIndex',
              value: 'caller-provided-dated-token-index',
            },
            {
              kind: 'frozen-input',
              path: '/validatorPerpUsdcTokenIndex',
              value: 'caller-provided-dated-token-index',
            },
          ]
        : [],
    sourceRefs: [
      'HLM.SPEC.HIP3.COLLATERAL_SOURCE.V1',
      'HL.DOC.HIP3.2026-07-19',
      'HL.DOC.ACCOUNT_ABSTRACTION.2026-07-19',
    ],
  }
}

export function marginModeTrace(
  input: NormalizedEvaluateHip3MarginModeInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
): CalculationTrace {
  return {
    formulaId: 'hl.hip3.margin-mode.evaluate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'experimental',
    completion,
    normalizedInputs:
      input === undefined
        ? {}
        : {
            assetMarginMode: input.assetMarginMode,
            requestedMode: input.requestedMode,
          },
    intermediates,
    rounding: [],
    assumptions:
      completion.status === 'complete' && input !== undefined
        ? [
            {
              kind: 'frozen-input',
              path: '/assetMarginMode',
              value: 'caller-provided-dex-margin-mode',
            },
            {
              kind: 'frozen-input',
              path: '/requestedMode',
              value: 'caller-requested-margin-mode',
            },
          ]
        : [],
    sourceRefs: [
      'HLM.SPEC.HIP3.MARGIN_MODE.V1',
      'HL.DOC.HIP3.2026-07-19',
      'HL.DOC.MARGINING.2026-07-19',
    ],
  }
}

export function feeRatesTrace(
  input: NormalizedCalculateHip3FeeRatesInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
  rounding: readonly RoundingDecision[] = [],
): CalculationTrace {
  return {
    formulaId: 'hl.hip3.fee-rates.calculate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'experimental',
    completion,
    normalizedInputs:
      input === undefined
        ? {}
        : {
            makerRate: input.makerRate,
            takerRate: input.takerRate,
            activeReferralDiscount: input.activeReferralDiscount,
            isAlignedQuoteToken: input.isAlignedQuoteToken,
            deployerFeeScale: input.deployerFeeScale,
            growthMode: input.growthMode,
          },
    intermediates,
    rounding,
    assumptions:
      completion.status === 'complete' && input !== undefined
        ? [
            {
              kind: 'frozen-input',
              path: '/makerRate',
              value: 'caller-provided-user-fees-evidence',
            },
            {
              kind: 'frozen-input',
              path: '/takerRate',
              value: 'caller-provided-user-fees-evidence',
            },
            {
              kind: 'frozen-input',
              path: '/activeReferralDiscount',
              value: 'caller-provided-referral-evidence',
            },
            {
              kind: 'frozen-input',
              path: '/isAlignedQuoteToken',
              value: 'caller-provided-aligned-quote-evidence',
            },
            {
              kind: 'frozen-input',
              path: '/growthMode',
              value: 'caller-provided-growth-mode-evidence',
            },
            {
              kind: 'frozen-input',
              path: '/deployerFeeScale',
              value: 'caller-provided-deployer-fee-scale',
            },
          ]
        : [],
    sourceRefs: [
      'HLM.SPEC.HIP3.FEE_RATES.V1',
      'HL.DOC.HIP3.2026-07-19',
      'HL.DOC.FEES.2026-07-19',
      decimalSource,
    ],
  }
}
