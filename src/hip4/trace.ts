import { finalizeTrace } from '../core/finalize-trace.js'
import type { CalculationTrace, MathReason, RoundingDecision, TraceStep } from '../model/index.js'
import type {
  NormalizedCalculateOutcomeDualPriceInput,
  NormalizedCalculateOutcomeSettlementInput,
  NormalizedEvaluateRecurringOutcomeInput,
} from './types.js'

type TraceCompletion =
  | { readonly status: 'complete' }
  | { readonly status: 'incomplete'; readonly reason: MathReason }

const decimalSource = 'DECIMALJS.10.6.0'

export function outcomeDualPriceTrace(
  input: NormalizedCalculateOutcomeDualPriceInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
): CalculationTrace {
  return finalizeTrace({
    formulaId: 'hl.hip4.dual-price.calculate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'experimental',
    completion,
    normalizedInputs: input === undefined ? {} : { price: input.price },
    intermediates,
    rounding: [],
    assumptions:
      completion.status === 'complete' && input !== undefined
        ? [{ kind: 'frozen-input', path: '/price', value: 'caller-provided-outcome-price' }]
        : [],
    sourceRefs: ['HLM.SPEC.HIP4.DUAL_PRICE.V1', 'HL.DOC.HIP4.2026-07-30', decimalSource],
  })
}

export function outcomeSettlementTrace(
  input: NormalizedCalculateOutcomeSettlementInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
): CalculationTrace {
  return finalizeTrace({
    formulaId: 'hl.hip4.settlement.calculate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'experimental',
    completion,
    normalizedInputs:
      input === undefined
        ? {}
        : {
            tokenSide: input.tokenSide,
            settleFraction: input.settleFraction,
            size: input.size,
            entryPrice: input.entryPrice,
          },
    intermediates,
    rounding: [],
    assumptions:
      completion.status === 'complete' && input !== undefined
        ? [
            {
              kind: 'frozen-input',
              path: '/tokenSide',
              value: 'caller-mapped-outcome-token-payout-semantics',
            },
            {
              kind: 'frozen-input',
              path: '/settleFraction',
              value: 'caller-provided-settlement-fraction',
            },
          ]
        : [],
    sourceRefs: [
      'HLM.SPEC.HIP4.SETTLEMENT.V1',
      'HL.DOC.HIP4.2026-07-30',
      'HL.DOC.INFO.SETTLED_OUTCOME.2026-07-30',
      decimalSource,
    ],
  })
}

function normalizedRecurringInput(
  input: NormalizedEvaluateRecurringOutcomeInput | undefined,
): CalculationTrace['normalizedInputs'] {
  if (input === undefined) return {}
  const base = {
    class: input.class,
    markPrice0: input.markPrice0,
    t0: input.t0,
    markPrice1: input.markPrice1,
    t1: input.t1,
    settlementTime: input.settlementTime,
  }
  return input.class === 'priceBinary'
    ? { ...base, targetPrice: input.targetPrice }
    : { ...base, priceThresholds: input.priceThresholds }
}

export function recurringOutcomeTrace(
  input: NormalizedEvaluateRecurringOutcomeInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
  rounding: readonly RoundingDecision[] = [],
): CalculationTrace {
  return finalizeTrace({
    formulaId: 'hl.hip4.recurring-outcome.evaluate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'experimental',
    completion,
    normalizedInputs: normalizedRecurringInput(input),
    intermediates,
    rounding,
    assumptions:
      completion.status === 'complete' && input !== undefined
        ? [
            {
              kind: 'frozen-input',
              path: '/markPrice0',
              value: 'caller-selected-mark-update-before-settlement',
            },
            {
              kind: 'frozen-input',
              path: '/markPrice1',
              value: 'caller-selected-mark-update-after-settlement',
            },
            {
              kind: 'frozen-input',
              path: '/settlementTime',
              value: 'caller-provided-settlement-time',
            },
          ]
        : [],
    sourceRefs: [
      'HLM.SPEC.HIP4.RECURRING_OUTCOME.V1',
      'HL.DOC.CONTRACT_SPECIFICATIONS.2026-07-30',
      decimalSource,
    ],
  })
}
