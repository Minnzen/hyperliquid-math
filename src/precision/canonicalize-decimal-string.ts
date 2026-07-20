import { normalizeDecimalString } from '../core/decimal.js'
import { describePlainValue } from '../core/plain-data.js'
import { invalidInputResult, okResult } from '../core/result.js'
import { createCanonicalDecimalTrace, incompleteReason } from '../core/trace.js'
import type { MathIssue, MathResult } from '../model/index.js'

/** @public */
export interface CanonicalizeDecimalStringInput {
  /** Plain decimal string matching `^-?\d+(?:\.\d+)?$`; exponent notation, `+`, `.5`, `1.` rejected. */
  readonly value: string
}

type InputShapeResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly issue: MathIssue }

function invalidInputShape(actual: string): InputShapeResult {
  return {
    ok: false,
    issue: {
      code: 'invalid-input-shape',
      path: '',
      actual,
      expected: 'plain object with exactly one own string data field named value',
    },
  }
}

function normalizeInputShape(input: unknown): InputShapeResult {
  if (typeof input !== 'object' || input === null) {
    return invalidInputShape(describePlainValue(input))
  }

  try {
    if (Array.isArray(input)) return invalidInputShape('array')

    const prototype = Object.getPrototypeOf(input) as object | null
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidInputShape('non-plain-object')
    }

    const ownKeys = Reflect.ownKeys(input)
    if (ownKeys.length !== 1 || ownKeys[0] !== 'value') {
      return invalidInputShape(
        ownKeys
          .map((key) => String(key))
          .sort()
          .join(','),
      )
    }

    const descriptor = Reflect.getOwnPropertyDescriptor(input, 'value')
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      descriptor.enumerable !== true ||
      typeof descriptor.value !== 'string'
    ) {
      return invalidInputShape('value')
    }

    return { ok: true, value: descriptor.value }
  } catch {
    return invalidInputShape('uninspectable-object')
  }
}

/**
 * Canonicalizes a plain decimal string to this package's exact serialization: leading integer
 * zeroes and insignificant fractional zeroes removed, no exponent, every signed zero mapped to `0`.
 * Purely lexical — no protocol rounding occurs, so the numeric value is always preserved.
 *
 * @public
 */
export function canonicalizeDecimalString(
  input: CanonicalizeDecimalStringInput,
): MathResult<string> {
  const shape = normalizeInputShape(input)
  if (!shape.ok) {
    return invalidInputResult(
      [shape.issue],
      createCanonicalDecimalTrace({
        completion: {
          status: 'incomplete',
          reason: incompleteReason(shape.issue.code, ''),
        },
        normalizedInputs: {},
      }),
    )
  }

  const rawValue = shape.value
  const normalized = normalizeDecimalString(rawValue)
  if (!normalized.ok) {
    return invalidInputResult(
      [normalized.issue],
      createCanonicalDecimalTrace({
        completion: {
          status: 'incomplete',
          reason: incompleteReason(normalized.issue.code, '/value'),
        },
        normalizedInputs: { value: rawValue },
      }),
    )
  }

  return okResult(
    normalized.value,
    createCanonicalDecimalTrace({
      completion: { status: 'complete' },
      normalizedInputs: { value: normalized.value },
      intermediates: [
        {
          stepId: 'canonicalize-decimal',
          inputs: { value: rawValue },
          output: normalized.value,
        },
      ],
    }),
  )
}
