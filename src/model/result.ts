import type { MathIssue, MathReason } from './reason.js'
import type { CalculationTrace } from './trace.js'

/**
 * Total result of one calculation: `ok` with data, `invalid-input` with issues (malformed plain
 * data), `not-applicable` (valid input, formula has nothing to compute — e.g. zero size or flat
 * position), or `indeterminate` (a required fact or supported rule is missing; `missing` lists
 * JSON Pointers). Functions never throw on data problems.
 *
 * @public
 */
export type MathValue<T> =
  | { readonly status: 'ok'; readonly data: T }
  | { readonly status: 'invalid-input'; readonly issues: readonly MathIssue[] }
  | { readonly status: 'not-applicable'; readonly reason: MathReason }
  | {
      readonly status: 'indeterminate'
      readonly reason: MathReason
      readonly missing?: readonly string[]
    }

/**
 * Every public function returns `{ value, trace }`: the discriminated outcome plus a
 * `CalculationTrace` proving which formula, sources, inputs, and rounding produced it.
 *
 * @public
 */
export interface MathResult<T> {
  readonly value: MathValue<T>
  readonly trace: CalculationTrace
}
