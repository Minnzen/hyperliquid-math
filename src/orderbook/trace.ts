import type { CalculationTrace, MathReason, RoundingDecision, TraceStep } from '../model/index.js'
import type { FillSide, NormalizedAmount, NormalizedBook } from './types.js'

const sourceRefs = [
  'HLM.SPEC.ORDERBOOK.METRICS.V1',
  'HL.DOC.INFO.L2BOOK.2026-07-19',
  'HL.DOC.WS.L2BOOK.2026-07-19',
  'DECIMALJS.10.6.0',
] as const

const fillSourceRefs = [
  'HLM.SPEC.ORDERBOOK.FILL.V1',
  'HL.DOC.INFO.L2BOOK.2026-07-19',
  'HL.DOC.WS.L2BOOK.2026-07-19',
  'DECIMALJS.10.6.0',
] as const

type TraceCompletion =
  | { readonly status: 'complete' }
  | { readonly status: 'incomplete'; readonly reason: MathReason }

export function metricsTrace(
  book: NormalizedBook | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
  rounding: readonly RoundingDecision[] = [],
): CalculationTrace {
  const bids = book?.levels[0] ?? []
  const asks = book?.levels[1] ?? []
  return {
    formulaId: 'hl.orderbook.metrics',
    formulaVersion: 1,
    authority: 'local-exact' as const,
    maturity: 'stable' as const,
    completion,
    normalizedInputs: {
      bidCount: bids.length,
      askCount: asks.length,
      ...(bids[0] !== undefined ? { bestBid: bids[0].px } : {}),
      ...(asks[0] !== undefined ? { bestAsk: asks[0].px } : {}),
    },
    intermediates,
    rounding,
    assumptions: [
      { kind: 'frozen-input' as const, path: '/levels', value: 'caller-provided-l2-snapshot' },
    ],
    sourceRefs,
  }
}

export function fillTrace(
  book: NormalizedBook | undefined,
  side: FillSide | undefined,
  amount: NormalizedAmount | undefined,
  referencePrice: string | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
  rounding: readonly RoundingDecision[] = [],
): CalculationTrace {
  const bids = book?.levels[0] ?? []
  const asks = book?.levels[1] ?? []
  return {
    formulaId: 'hl.orderbook.fill.simulate',
    formulaVersion: 1,
    authority: 'local-exact' as const,
    maturity: 'stable' as const,
    completion,
    normalizedInputs: {
      bidCount: bids.length,
      askCount: asks.length,
      ...(side !== undefined ? { side } : {}),
      ...(amount !== undefined ? { amountKind: amount.kind, amount: amount.value } : {}),
      ...(referencePrice !== undefined ? { referencePrice } : {}),
    },
    intermediates,
    rounding,
    assumptions: [
      { kind: 'frozen-input' as const, path: '/levels', value: 'caller-provided-l2-snapshot' },
      {
        kind: 'fill-model' as const,
        model: 'book-vwap' as const,
        parameters: { queue: 'ignored' },
      },
    ],
    sourceRefs: fillSourceRefs,
  }
}
