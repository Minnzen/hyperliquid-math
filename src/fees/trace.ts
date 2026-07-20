import type { CalculationTrace, MathReason, TraceStep } from '../model/index.js'
import type {
  NormalizedSelectFeeTierInput,
  NormalizedTradeFeeInput,
  NormalizedWeightedFeeVolumeInput,
} from './types.js'

type TraceCompletion =
  | { readonly status: 'complete' }
  | { readonly status: 'incomplete'; readonly reason: MathReason }

const decimalSource = 'DECIMALJS.10.6.0'

export function tradeFeeTrace(
  input: NormalizedTradeFeeInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
): CalculationTrace {
  return {
    formulaId: 'hl.fees.trade-fee.calculate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'stable',
    completion,
    normalizedInputs:
      input === undefined
        ? {}
        : {
            price: input.price,
            size: input.size,
            rate: input.rate,
          },
    intermediates,
    rounding: [],
    assumptions:
      completion.status === 'complete' && input !== undefined
        ? [{ kind: 'frozen-input', path: '', value: 'caller-provided-trade-fee-input' }]
        : [],
    sourceRefs: [
      'HLM.SPEC.FEES.TRADE_FEE.V1',
      'HL.DOC.FEES.2026-07-19',
      'HL.DOC.INFO.USER_FEES.2026-07-19',
      decimalSource,
    ],
  }
}

export function weightedFeeVolumeTrace(
  input: NormalizedWeightedFeeVolumeInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
): CalculationTrace {
  return {
    formulaId: 'hl.fees.weighted-volume.calculate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'stable',
    completion,
    normalizedInputs:
      input === undefined
        ? {}
        : {
            perpsVolume: input.perpsVolume,
            spotVolume: input.spotVolume,
          },
    intermediates,
    rounding: [],
    assumptions:
      completion.status === 'complete' && input !== undefined
        ? [{ kind: 'frozen-input', path: '', value: 'caller-provided-fee-volume-input' }]
        : [],
    sourceRefs: [
      'HLM.SPEC.FEES.WEIGHTED_VOLUME.V1',
      'HL.DOC.FEES.2026-07-19',
      'HL.DOC.INFO.USER_FEES.2026-07-19',
      decimalSource,
    ],
  }
}

export function feeTierTrace(
  input: NormalizedSelectFeeTierInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
): CalculationTrace {
  return {
    formulaId: 'hl.fees.tier.select',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'stable',
    completion,
    normalizedInputs:
      input === undefined
        ? {}
        : {
            weightedVolume: input.weightedVolume,
            baseRates: {
              makerRate: input.baseRates.makerRate,
              takerRate: input.baseRates.takerRate,
            },
            tierCount: input.tiers.length,
          },
    intermediates,
    rounding: [],
    assumptions:
      completion.status === 'complete' && input !== undefined
        ? [{ kind: 'frozen-input', path: '', value: 'caller-provided-fee-schedule' }]
        : [],
    sourceRefs: [
      'HLM.SPEC.FEES.TIER_SELECT.V1',
      'HL.DOC.FEES.2026-07-19',
      'HL.DOC.INFO.USER_FEES.2026-07-19',
      decimalSource,
    ],
  }
}
