import { finalizeTrace } from '../core/finalize-trace.js'
import type {
  Assumption,
  CalculationTrace,
  JsonObject,
  MathReason,
  RoundingDecision,
  TraceStep,
} from '../model/index.js'
import type { NormalizedFill, NormalizedPosition } from './types.js'

type TraceCompletion =
  | { readonly status: 'complete' }
  | { readonly status: 'incomplete'; readonly reason: MathReason }

const commonSourceRefs = ['DECIMALJS.10.6.0'] as const

export const unrealizedAssumptions = [
  {
    kind: 'frozen-input',
    path: '/markPrice',
    value: 'caller-provided-frozen-mark-price',
  },
] as const satisfies readonly Assumption[]

export const fillAssumptions = [
  {
    kind: 'fill-model',
    model: 'explicit-partial',
    parameters: {
      source: 'caller-provided-fill',
      feeConvention: 'positive-user-cost',
      serverDisplayFields: 'not-replayed',
    },
  },
] as const satisfies readonly Assumption[]

export const sequenceAssumptions = [
  {
    kind: 'fill-model',
    model: 'explicit-sequence',
    parameters: {
      order: 'caller-provided',
      pagination: 'external',
      truncation: 'none',
    },
  },
] as const satisfies readonly Assumption[]

export const breakEvenAssumptions = [
  { kind: 'frozen-input', path: '/position', value: 'size-and-entry-fixed' },
  {
    kind: 'frozen-input',
    path: '/cumulativeCost',
    value: 'caller-provided-costs-only-future-costs-excluded',
  },
] as const satisfies readonly Assumption[]

export const flatBreakEvenAssumptions = [
  { kind: 'frozen-input', path: '/position', value: 'caller-provided-position-state' },
  breakEvenAssumptions[1],
] as const satisfies readonly Assumption[]

function positionJson(position: NormalizedPosition | undefined): JsonObject | undefined {
  if (position === undefined) return undefined
  if (position.kind === 'flat') return { kind: 'flat' }
  return { kind: 'open', signedSize: position.signedSize, entryPrice: position.entryPrice }
}

function fillJson(fill: NormalizedFill | undefined): JsonObject | undefined {
  if (fill === undefined) return undefined
  return { side: fill.side, size: fill.size, price: fill.price, fee: fill.fee }
}

export function positionTrace(
  formulaId: string,
  sourceRefs: readonly string[],
  normalizedInputs: JsonObject,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
  rounding: readonly RoundingDecision[] = [],
  assumptions: readonly Assumption[] = [],
): CalculationTrace {
  return finalizeTrace({
    formulaId,
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'stable',
    completion,
    normalizedInputs,
    intermediates,
    rounding,
    assumptions,
    sourceRefs: [...sourceRefs, ...commonSourceRefs],
  })
}

export function unrealizedInputs(
  position: NormalizedPosition | undefined,
  markPrice: string | undefined,
): JsonObject {
  const inputs: Record<string, unknown> = {}
  const normalizedPosition = positionJson(position)
  if (normalizedPosition !== undefined) inputs.position = normalizedPosition
  if (markPrice !== undefined) inputs.markPrice = markPrice
  return inputs as JsonObject
}

export function fillInputs(
  position: NormalizedPosition | undefined,
  fill: NormalizedFill | undefined,
): JsonObject {
  const inputs: Record<string, unknown> = {}
  const normalizedPosition = positionJson(position)
  const normalizedFill = fillJson(fill)
  if (normalizedPosition !== undefined) inputs.position = normalizedPosition
  if (normalizedFill !== undefined) inputs.fill = normalizedFill
  return inputs as JsonObject
}

export function sequenceInputs(
  position: NormalizedPosition | undefined,
  fillCount: number | undefined,
): JsonObject {
  const inputs: Record<string, unknown> = {}
  const normalizedPosition = positionJson(position)
  if (normalizedPosition !== undefined) inputs.position = normalizedPosition
  if (fillCount !== undefined) inputs.fillCount = fillCount
  return inputs as JsonObject
}
