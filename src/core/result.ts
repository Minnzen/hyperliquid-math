import type { CalculationTrace, MathIssue, MathResult } from '../model/index.js'

export function okResult<T>(data: T, trace: CalculationTrace): MathResult<T> {
  return { value: { status: 'ok', data }, trace }
}

export function invalidInputResult<T>(
  issues: readonly MathIssue[],
  trace: CalculationTrace,
): MathResult<T> {
  return { value: { status: 'invalid-input', issues }, trace }
}
