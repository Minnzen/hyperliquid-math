import type { CalculationTrace, MathReason, RoundingDecision, TraceStep } from '../model/index.js'
import type {
  NormalizedAnnualizeFundingRateInput,
  NormalizedFundingPaymentInput,
  NormalizedFundingPremiumIndexInput,
  NormalizedFundingRateInput,
} from './types.js'

type TraceCompletion =
  | { readonly status: 'complete' }
  | { readonly status: 'incomplete'; readonly reason: MathReason }

const decimalSource = 'DECIMALJS.10.6.0'

function normalizedRateRules(input: NormalizedFundingRateInput | undefined) {
  if (input === undefined) return {}
  return {
    averagePremiumIndex: input.averagePremiumIndex,
    rules: {
      interestRate: input.rules.interestRate,
      clampLower: input.rules.clampLower,
      clampUpper: input.rules.clampUpper,
      baseIntervalHours: input.rules.baseIntervalHours,
      hourlyCap: input.rules.hourlyCap,
    },
  }
}

export function premiumIndexTrace(
  input: NormalizedFundingPremiumIndexInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
  rounding: readonly RoundingDecision[] = [],
): CalculationTrace {
  return {
    formulaId: 'hl.funding.premium-index.calculate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'stable',
    completion,
    normalizedInputs:
      input === undefined
        ? {}
        : {
            impactBidPrice: input.impactBidPrice,
            impactAskPrice: input.impactAskPrice,
            oraclePrice: input.oraclePrice,
          },
    intermediates,
    rounding,
    assumptions:
      completion.status === 'complete' && input !== undefined
        ? [{ kind: 'frozen-input', path: '', value: 'caller-provided-impact-and-oracle-prices' }]
        : [],
    sourceRefs: ['HLM.SPEC.FUNDING.PREMIUM_INDEX.V1', 'HL.DOC.FUNDING.2026-07-19', decimalSource],
  }
}

export function fundingRateTrace(
  input: NormalizedFundingRateInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
  rounding: readonly RoundingDecision[] = [],
): CalculationTrace {
  return {
    formulaId: 'hl.funding.rate.calculate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'stable',
    completion,
    normalizedInputs: normalizedRateRules(input),
    intermediates,
    rounding,
    assumptions:
      completion.status === 'complete' && input !== undefined
        ? [{ kind: 'frozen-input', path: '/rules', value: 'caller-provided-versioned-rate-rules' }]
        : [],
    sourceRefs: ['HLM.SPEC.FUNDING.RATE.V1', 'HL.DOC.FUNDING.2026-07-19', decimalSource],
  }
}

export function fundingPaymentTrace(
  input: NormalizedFundingPaymentInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
): CalculationTrace {
  return {
    formulaId: 'hl.funding.payment.calculate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'stable',
    completion,
    normalizedInputs:
      input === undefined
        ? {}
        : {
            signedPositionSize: input.signedPositionSize,
            oraclePrice: input.oraclePrice,
            fundingRate: input.fundingRate,
          },
    intermediates,
    rounding: [],
    assumptions:
      completion.status === 'complete' && input !== undefined
        ? [{ kind: 'frozen-input', path: '', value: 'caller-provided-settlement-inputs' }]
        : [],
    sourceRefs: [
      'HLM.SPEC.FUNDING.PAYMENT.V1',
      'HL.DOC.FUNDING.2026-07-19',
      'HL.DOC.INFO.PERP.2026-07-19',
      decimalSource,
    ],
  }
}

export function annualizeFundingRateTrace(
  input: NormalizedAnnualizeFundingRateInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
  rounding: readonly RoundingDecision[] = [],
): CalculationTrace {
  return {
    formulaId: 'hl.funding.rate.annualize',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'stable',
    completion,
    normalizedInputs:
      input === undefined
        ? {}
        : {
            periodicRate: input.periodicRate,
            periodsPerYear: input.periodsPerYear,
            convention: input.convention,
          },
    intermediates,
    rounding,
    assumptions:
      completion.status === 'complete' && input !== undefined
        ? [
            {
              kind: 'frozen-input',
              path: '/convention',
              value: 'analytical-annualization-convention',
            },
          ]
        : [],
    sourceRefs: ['HLM.SPEC.FUNDING.ANNUALIZE.V1', decimalSource],
  }
}
