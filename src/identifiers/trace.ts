import { finalizeTrace } from '../core/finalize-trace.js'
import type { CalculationTrace, JsonObject, MathReason, TraceStep } from '../model/index.js'

interface IdentifierTraceInput {
  readonly formulaId: string
  readonly completion: CalculationTrace['completion']
  readonly normalizedInputs: JsonObject
  readonly sourceRefs: readonly string[]
  readonly maturity?: CalculationTrace['maturity']
  readonly intermediates?: readonly TraceStep[]
}

export const assetKeySourceRefs = ['HLM.SPEC.IDENTIFIERS.CANONICAL_KEY.V1'] as const
export const assetIdSourceRefs = [
  'HLM.SPEC.IDENTIFIERS.ASSET_ID.V1',
  'HL.DOC.ASSET_IDS.2026-07-19',
] as const
export const officialAssetIdSourceRefs = ['HL.DOC.ASSET_IDS.2026-07-19'] as const

export function createIdentifierTrace(input: IdentifierTraceInput): CalculationTrace {
  return finalizeTrace({
    formulaId: input.formulaId,
    formulaVersion: 1,
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

export function reason(code: string, path: string, sourceRefs?: readonly string[]): MathReason {
  return sourceRefs === undefined ? { code, path } : { code, path, sourceRefs }
}
