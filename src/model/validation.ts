import type { MathReason } from './reason.js'

/** @public */
export interface ConstraintViolation {
  readonly ruleId: string
  readonly code: string
  readonly path?: string
  readonly actual?: string
  readonly limit?: string
}

/** @public */
export type NonViolatedConstraintCheck =
  | { readonly status: 'satisfied'; readonly ruleId: string }
  | { readonly status: 'not-applicable'; readonly ruleId: string; readonly reason: MathReason }
  | {
      readonly status: 'not-evaluated'
      readonly ruleId: string
      readonly reason: MathReason
      readonly missing?: readonly string[]
    }

/** @public */
export interface ViolatedConstraintCheck {
  readonly status: 'violated'
  readonly ruleId: string
  readonly violation: ConstraintViolation
}

/**
 * Objective protocol-constraint fact: `satisfied`, `violated`, `not-applicable`, or
 * `not-evaluated` (rule unavailable — never silently treated as satisfied). Checks carry no
 * severity or blocking policy; that belongs to the caller.
 *
 * @public
 */
export type ConstraintCheck = NonViolatedConstraintCheck | ViolatedConstraintCheck

/**
 * Scenario check whose violation additionally states whether the projection still proceeds
 * (`preserves-transition`) or the scenario becomes `indeterminate` (`blocks-transition`).
 *
 * @public
 */
export type ScenarioConstraintCheck =
  | NonViolatedConstraintCheck
  | (ViolatedConstraintCheck & {
      readonly transitionEffect: 'preserves-transition' | 'blocks-transition'
    })

/** @public */
export interface ValidationReport {
  readonly checks: readonly ConstraintCheck[]
}
