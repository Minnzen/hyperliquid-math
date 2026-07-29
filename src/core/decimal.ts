import { Decimal } from 'decimal.js'
import type { MathIssue } from '../model/index.js'

export const Decimal40 = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
})

export const MAX_DECIMAL_STRING_LENGTH = 256
export const MAX_DECIMAL_OUTPUT_INTEGER_DIGITS = 4096

declare const normalizedDecimalStringBrand: unique symbol

export type NormalizedDecimalString = string & {
  readonly [normalizedDecimalStringBrand]: true
}

export type NormalizeDecimalStringResult =
  | {
      readonly ok: true
      readonly value: NormalizedDecimalString
      readonly decimal: Decimal
    }
  | { readonly ok: false; readonly issue: MathIssue }

const plainDecimalPattern = /^-?\d+(?:\.\d+)?$/

export function normalizeDecimalString(input: string): NormalizeDecimalStringResult {
  if (input.length > MAX_DECIMAL_STRING_LENGTH) {
    return {
      ok: false,
      issue: {
        code: 'decimal-string-too-long',
        path: '/value',
        actual: `string-length:${input.length}`,
        expected: `plain decimal string no longer than ${MAX_DECIMAL_STRING_LENGTH} characters`,
      },
    }
  }

  if (!plainDecimalPattern.test(input)) {
    return {
      ok: false,
      issue: {
        code: 'invalid-decimal-string',
        path: '/value',
        actual: input,
        expected: 'plain decimal string without exponent, sign +, or whitespace',
      },
    }
  }

  const decimal = new Decimal40(input)
  const value = (decimal.isZero() ? '0' : decimal.toFixed()) as NormalizedDecimalString
  return { ok: true, value, decimal }
}
