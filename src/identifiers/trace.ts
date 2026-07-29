import { finalizeTrace } from '../core/finalize-trace.js'
import type { CalculationTrace, JsonObject, MathReason, TraceStep } from '../model/index.js'

interface IdentifierTraceInput {
  readonly formulaId: string
  readonly formulaVersion?: number
  readonly completion: CalculationTrace['completion']
  readonly normalizedInputs: JsonObject
  readonly sourceRefs: readonly string[]
  readonly maturity?: CalculationTrace['maturity']
  readonly intermediates?: readonly TraceStep[]
}

export const assetKeySourceRefs = ['HLM.SPEC.IDENTIFIERS.CANONICAL_KEY.V1'] as const
export const assetIdSourceRefs = [
  'HLM.SPEC.IDENTIFIERS.ASSET_ID.V2',
  'HL.DOC.ASSET_IDS.2026-07-30',
] as const

export function createIdentifierTrace(input: IdentifierTraceInput): CalculationTrace {
  return finalizeTrace({
    formulaId: input.formulaId,
    formulaVersion: input.formulaVersion ?? 1,
    authority: 'local-exact',
    maturity: input.maturity ?? 'stable',
    completion: input.completion,
    normalizedInputs: input.normalizedInputs,
    intermediates: input.intermediates ?? [],
    rounding: [],
    assumptions: [],
    sourceRefs: input.sourceRefs,
  })
}

export function reason(code: string, path: string): MathReason {
  return { code, path }
}
