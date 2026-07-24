import { finalizeTrace } from '../core/finalize-trace.js'
import type {
  Assumption,
  CalculationTrace,
  JsonObject,
  MathReason,
  TraceStep,
} from '../model/index.js'

const decimalSource = 'DECIMALJS.10.6.0'

export const replaySourceRefs = [
  'HLM.SPEC.RECONCILIATION.REPLAY.V1',
  'HLM.SPEC.POSITIONS.FILL_PROJECT.V1',
  'HL.DOC.INFO.ORDERS_FILLS.2026-07-19',
  'HL.DOC.WS.USER_FILLS.2026-07-19',
  'HL.DOC.ENTRY_PNL.2026-07-19',
  decimalSource,
] as const

export const reconcileSourceRefs = [
  'HLM.SPEC.RECONCILIATION.RECONCILE.V1',
  'HL.DOC.INFO.ORDERS_FILLS.2026-07-19',
  'HL.DOC.WS.USER_FILLS.2026-07-19',
  decimalSource,
] as const

export const replayAssumptions = [
  { kind: 'frozen-input', path: '/snapshot', value: 'caller-provided-initial-snapshot' },
  { kind: 'frozen-input', path: '/events', value: 'caller-provided-ordered-complete-events' },
  {
    kind: 'frozen-input',
    path: '/events/*/serverFillEvidence',
    value: 'caller-provided-normalized-raw-fill-evidence-when-present',
  },
] as const satisfies readonly Assumption[]

export const reconcileAssumptions = [
  { kind: 'frozen-input', path: '/projected', value: 'caller-provided-projected-snapshot' },
  { kind: 'frozen-input', path: '/observed', value: 'caller-provided-current-server-snapshot' },
  { kind: 'frozen-input', path: '/evidence', value: 'caller-provided-completeness-evidence' },
  { kind: 'frozen-input', path: '/tolerances', value: 'caller-provided-numeric-tolerances' },
] as const satisfies readonly Assumption[]

export function reconciliationReason(code: string, path: string): MathReason {
  return { code, path }
}

interface ReconciliationTraceInput {
  readonly formulaId: string
  readonly authority: CalculationTrace['authority']
  readonly completion: CalculationTrace['completion']
  readonly normalizedInputs: JsonObject
  readonly sourceRefs: readonly string[]
  readonly intermediates?: readonly TraceStep[]
  readonly assumptions?: readonly Assumption[]
}

export function reconciliationTrace(input: ReconciliationTraceInput): CalculationTrace {
  return finalizeTrace({
    formulaId: input.formulaId,
    formulaVersion: 1,
    authority: input.authority,
    maturity: 'stable',
    completion: input.completion,
    normalizedInputs: input.normalizedInputs,
    intermediates: input.intermediates ?? [],
    rounding: [],
    assumptions: input.assumptions ?? [],
    sourceRefs: input.sourceRefs,
  })
}
