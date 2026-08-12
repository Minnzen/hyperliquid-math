import { finalizeTrace } from '../core/finalize-trace.js'
import type {
  Assumption,
  CalculationTrace,
  JsonObject,
  MathReason,
  RoundingDecision,
  TraceStep,
} from '../model/index.js'

export const validationAssumptions = [
  { kind: 'frozen-input', path: '/minimumNotional', value: 'caller-provided-rule' },
  { kind: 'frozen-input', path: '/priceBand', value: 'caller-provided-rule' },
] as const satisfies readonly Assumption[]

export const maxSizeAssumptions = [
  {
    kind: 'frozen-input',
    path: '/availableCollateral',
    value: 'caller-provided-frozen-available-collateral',
  },
  {
    kind: 'frozen-input',
    path: '/referencePrice',
    value: 'caller-provided-reference-price',
  },
] as const satisfies readonly Assumption[]

export const reduceOnlyAssumptions = [
  {
    kind: 'frozen-input',
    path: '/currentSignedSize',
    value: 'caller-provided-frozen-position-size',
  },
] as const satisfies readonly Assumption[]

export const slippageAssumptions = [
  {
    kind: 'frozen-input',
    path: '/referencePrice',
    value: 'caller-provided-reference-price',
  },
] as const satisfies readonly Assumption[]

export const triggerClassificationAssumptions = [
  {
    kind: 'frozen-input',
    path: '/markPrice',
    value: 'caller-provided-frozen-mark-price',
  },
] as const satisfies readonly Assumption[]

export const triggerDerivationAssumptions = [
  { kind: 'frozen-input', path: '/position', value: 'size-and-entry-fixed' },
  {
    kind: 'frozen-input',
    path: '/cumulativeCost',
    value: 'caller-provided-costs-only-future-costs-excluded',
  },
] as const satisfies readonly Assumption[]

export const scaleAssumptions = [
  {
    kind: 'frozen-input',
    path: '/distribution',
    value: 'caller-selected-local-ladder-not-server-scale-algorithm',
  },
] as const satisfies readonly Assumption[]

export const twapAssumptions = [
  {
    kind: 'frozen-input',
    path: '/durationMs',
    value: 'caller-provided-duration-server-schedule-excluded',
  },
] as const satisfies readonly Assumption[]

export const ordersSourceRefs = [
  'HLM.SPEC.ORDERS.VALIDATE.V1',
  'HLM.SPEC.ORDERS.MAX_SIZE.V1',
  'HLM.SPEC.ORDERS.REDUCE_ONLY.V1',
  'HLM.SPEC.ORDERS.SLIPPAGE_PRICE.V1',
  'HLM.SPEC.ORDERS.TRIGGER_CLASSIFY.V1',
  'HLM.SPEC.ORDERS.TRIGGER_DERIVE.V1',
  'HLM.SPEC.ORDERS.SCALE.V1',
  'HLM.SPEC.ORDERS.TWAP_EXECUTION_TARGET.V1',
  'HL.DOC.TICK_LOT.2026-07-19',
  'HL.DOC.ORDER_TYPES.2026-08-12',
  'HL.DOC.TP_SL.2026-07-19',
  'HL.DOC.ORDER_ERRORS.2026-07-19',
  'HL.DOC.CONTRACT_SPECIFICATIONS.2026-07-19',
  'HL.DOC.EXCHANGE.2026-08-12',
  'DECIMALJS.10.6.0',
] as const

export function ordersReason(code: string, path: string): MathReason {
  return { code, path }
}

export function ordersTrace(input: {
  readonly formulaId: string
  readonly completion: CalculationTrace['completion']
  readonly normalizedInputs?: JsonObject
  readonly intermediates?: readonly TraceStep[]
  readonly rounding?: readonly RoundingDecision[]
  readonly assumptions?: readonly Assumption[]
  readonly maturity?: CalculationTrace['maturity']
}): CalculationTrace {
  return finalizeTrace({
    formulaId: input.formulaId,
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: input.maturity ?? 'stable',
    completion: input.completion,
    normalizedInputs: input.normalizedInputs ?? {},
    intermediates: input.intermediates ?? [],
    rounding: input.rounding ?? [],
    assumptions: input.assumptions ?? [],
    sourceRefs: ordersSourceRefs,
  })
}
