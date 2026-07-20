import { Decimal } from 'decimal.js'
import type { MathIssue } from '../model/index.js'

export const Decimal40 = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
})

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
