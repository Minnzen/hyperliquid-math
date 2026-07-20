import type { CalculationTrace, JsonObject, MathReason, TraceStep } from '../model/index.js'

interface TraceInput {
  readonly completion: CalculationTrace['completion']
  readonly normalizedInputs: JsonObject
  readonly intermediates?: readonly TraceStep[]
}

const sourceRefs = ['HLM.SPEC.PRECISION.CANONICAL_DECIMAL.V1', 'DECIMALJS.10.6.0'] as const

export function createCanonicalDecimalTrace(input: TraceInput): CalculationTrace {
  return {
    formulaId: 'hl.precision.decimal.canonicalize',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'stable',
    completion: input.completion,
    normalizedInputs: input.normalizedInputs,
    intermediates: input.intermediates ?? [],
    rounding: [],
    assumptions: [],
    sourceRefs,
  }
}

export function incompleteReason(code: string, path: string): MathReason {
  return { code, path }
}
