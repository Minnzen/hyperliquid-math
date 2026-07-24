import { finalizeTrace } from '../core/finalize-trace.js'
import { invalidInputResult } from '../core/result.js'
import type { ValidationIssue } from '../core/validation.js'
import type {
  Assumption,
  CalculationTrace,
  JsonObject,
  MathReason,
  MathResult,
} from '../model/index.js'
import { scenarioFormulaId, scenarioSourceRefs } from './constants.js'
import type { DecimalValue } from './types.js'

export function decimalString(value: DecimalValue): string {
  return value.isZero() ? '0' : value.toFixed()
}

export function scenarioReason(code: string, path: string): MathReason {
  return { code, path }
}

export function scenarioTrace(
  completion: CalculationTrace['completion'],
  normalizedInputs: JsonObject,
  assumptions: readonly Assumption[] = [],
): CalculationTrace {
  return finalizeTrace({
    formulaId: scenarioFormulaId,
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'experimental',
    completion,
    normalizedInputs,
    intermediates: [],
    rounding: [],
    assumptions,
    sourceRefs: scenarioSourceRefs,
  })
}

export function invalidScenarioInput<T>(issueValue: ValidationIssue): MathResult<T> {
  return invalidInputResult(
    [issueValue],
    scenarioTrace(
      { status: 'incomplete', reason: scenarioReason(issueValue.code, issueValue.path) },
      {},
    ),
  )
}

export function indeterminateScenario<T>(
  reasonValue: MathReason,
  actionIndex: number,
): MathResult<T> {
  return {
    value: { status: 'indeterminate', reason: reasonValue },
    trace: scenarioTrace({ status: 'incomplete', actionIndex, reason: reasonValue }, {}),
  }
}
