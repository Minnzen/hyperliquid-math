import type { JsonObject, JsonValue } from './json.js'
import type { MathReason } from './reason.js'

/**
 * How authoritative the value is; `local-exact` = exact arithmetic over the supplied frozen inputs.
 *
 * @public
 */
export type CalculationAuthority = 'local-exact' | 'local-estimate' | 'server-authoritative'
/** @public */
export type CalculationMaturity = 'stable' | 'experimental'
/** @public */
export type RoundingMode = 'down' | 'up' | 'floor' | 'ceil' | 'half-even'

/** @public */
export type Assumption =
  | { readonly kind: 'frozen-input'; readonly path: string; readonly value: JsonValue }
  | {
      readonly kind: 'fill-model'
      readonly model:
        | 'full-at-limit'
        | 'book-vwap'
        | 'explicit-partial'
        | 'worst-price-within-slippage'
        | 'explicit-sequence'
      readonly parameters: JsonObject
    }
  | {
      readonly kind: 'counterfactual-action'
      readonly actionIndex: number
      readonly protocolSupport: 'verified' | 'unverified' | 'known-unsupported'
      readonly basis: MathReason
    }

/** @public */
export interface TraceStep {
  readonly stepId: string
  readonly formulaId?: string
  readonly inputs?: JsonObject
  readonly output: JsonValue
}

/** @public */
export interface RoundingDecision {
  readonly path: string
  readonly input: string
  readonly output: string
  readonly mode: RoundingMode
  readonly reasonCode: string
}

/**
 * Provenance attached to every result: formula/version, authority, maturity, completion,
 * normalized inputs, intermediate steps, rounding decisions, evidence-boundary assumptions, and
 * the official/spec source IDs the arithmetic relied on.
 *
 * @public
 */
export interface CalculationTrace {
  readonly formulaId: string
  readonly formulaVersion: number
  readonly authority: CalculationAuthority
  readonly maturity: CalculationMaturity
  readonly completion:
    | { readonly status: 'complete' }
    | { readonly status: 'incomplete'; readonly actionIndex?: number; readonly reason: MathReason }
  readonly normalizedInputs: JsonObject
  /** Named intermediate values in calculation order. */
  readonly intermediates: readonly TraceStep[]
  /** Every value-changing (or precision-bounded) rounding, with direction and reason code. */
  readonly rounding: readonly RoundingDecision[]
  /** Explicit evidence boundaries (frozen inputs, fill model, counterfactual protocol support). */
  readonly assumptions: readonly Assumption[]
  readonly sourceRefs: readonly string[]
}
