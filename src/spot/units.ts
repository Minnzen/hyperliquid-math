import { issue, type ValidationIssue } from '../core/validation.js'

const nonNegativePlainDecimal = /^\d+(?:\.\d+)?$/
const nonNegativeInteger = /^\d+$/

function trimLeadingZeros(value: string): string {
  return value.replace(/^0+(?=\d)/, '')
}

function trimTrailingFractionZeros(value: string): string {
  const [integerPart, fractionPart] = value.split('.') as [string, string]
  const fraction = fractionPart.replace(/0+$/, '')
  const integer = trimLeadingZeros(integerPart)
  return fraction === '' ? integer : `${integer}.${fraction}`
}

export function humanToMinimalString(
  value: string,
  weiDecimals: number,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  if (!nonNegativePlainDecimal.test(value)) {
    return {
      ok: false,
      issue: value.startsWith('-')
        ? issue('negative-decimal', '/value', value, 'non-negative plain decimal string')
        : issue('invalid-decimal-string', '/value', value, 'plain decimal string'),
    }
  }

  const [integerPart, fractionPart = ''] = value.split('.') as [string, string?]
  if (fractionPart.length > weiDecimals && /[1-9]/.test(fractionPart.slice(weiDecimals))) {
    return {
      ok: false,
      issue: issue('fractional-minimal-units', '/value', value, 'integer minimal-unit amount'),
    }
  }
  const paddedFraction = fractionPart.padEnd(weiDecimals, '0').slice(0, weiDecimals)
  return { ok: true, value: trimLeadingZeros(`${integerPart}${paddedFraction}`) }
}

export function minimalToHumanString(
  value: string,
  weiDecimals: number,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  if (!nonNegativeInteger.test(value)) {
    return {
      ok: false,
      issue: value.startsWith('-')
        ? issue('negative-decimal', '/value', value, 'non-negative integer decimal string')
        : issue('invalid-decimal-string', '/value', value, 'non-negative integer decimal string'),
    }
  }

  const digits = trimLeadingZeros(value)
  if (weiDecimals === 0) return { ok: true, value: digits }
  const padded = digits.padStart(weiDecimals + 1, '0')
  const integer = padded.slice(0, -weiDecimals)
  const fraction = padded.slice(-weiDecimals)
  return { ok: true, value: trimTrailingFractionZeros(`${integer}.${fraction}`) }
}

export function lotSizeWeiString(weiDecimals: number, szDecimals: number): string {
  return `1${'0'.repeat(weiDecimals - szDecimals)}`
}

export function lotSizeHumanString(szDecimals: number): string {
  if (szDecimals === 0) return '1'
  return `0.${'0'.repeat(szDecimals - 1)}1`
}
