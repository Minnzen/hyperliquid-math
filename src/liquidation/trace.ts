import { finalizeTrace } from '../core/finalize-trace.js'
import type { CalculationTrace, MathReason, TraceStep } from '../model/index.js'
import type { LiquidationCandidateTrace, NormalizedLiquidationInput } from './types.js'

type TraceCompletion =
  | { readonly status: 'complete' }
  | { readonly status: 'incomplete'; readonly reason: MathReason }

export const liquidationSourceRefs = [
  'HLM.SPEC.LIQUIDATION.PRICE.V1',
  'HL.DOC.LIQUIDATIONS.2026-07-19',
  'HL.DOC.MARGINING.2026-07-19',
  'HL.DOC.MARGIN_TIERS.2026-07-19',
  'DECIMALJS.10.6.0',
] as const

function normalizedInputs(input: NormalizedLiquidationInput | undefined) {
  if (input === undefined) return {}

  return {
    targetAssetKey: input.targetAssetKey,
    crossAccountValue: input.crossAccountValue,
    positions: input.positions.map((position) => ({
      assetKey: position.assetKey,
      signedSize: position.signedSize,
      entryPrice: position.entryPrice,
      markPrice: position.markPrice,
      marginMode:
        position.marginMode.kind === 'cross'
          ? { kind: 'cross' }
          : {
              kind: 'isolated',
              isolatedMarginValue: position.marginMode.isolatedMarginValue,
              marginRemoval: position.marginMode.marginRemoval,
            },
      marginTiers: position.marginTiers.map((tier, index) => ({
        index,
        lowerBound: tier.lowerBound,
        nextLowerBound: position.marginTiers[index + 1]?.lowerBound ?? null,
        maxLeverage: tier.maxLeverage,
        maintenanceRate: tier.maintenanceRate,
        deduction: tier.maintenanceDeduction,
      })),
    })),
  }
}

export function liquidationTrace(
  input: NormalizedLiquidationInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
): CalculationTrace {
  const assumptions =
    completion.status === 'complete' && input !== undefined
      ? input.positions.flatMap((position, index) => {
          const common = [
            {
              kind: 'frozen-input' as const,
              path: `/positions/${index}/markPrice`,
              value: position.markPrice,
            },
          ]
          if (position.marginMode.kind === 'cross') return common

          return [
            ...common,
            {
              kind: 'frozen-input' as const,
              path: `/positions/${index}/marginMode/isolatedMarginValue`,
              value: position.marginMode.isolatedMarginValue,
            },
          ]
        })
      : []

  return finalizeTrace({
    formulaId: 'hl.liquidation-price.calculate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'stable',
    completion,
    normalizedInputs: normalizedInputs(input),
    intermediates,
    rounding: [],
    assumptions,
    sourceRefs: liquidationSourceRefs,
  })
}

export function candidateRootsStep(candidates: readonly LiquidationCandidateTrace[]): TraceStep {
  return {
    stepId: 'candidate-roots',
    output: candidates.map((candidate) => ({
      tierIndex: candidate.tierIndex,
      price: candidate.price,
      notional: candidate.notional,
      accepted: candidate.accepted,
      rejectedReason: candidate.rejectedReason,
    })),
  }
}
