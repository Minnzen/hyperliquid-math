import { Decimal40, MAX_DECIMAL_STRING_LENGTH } from '../core/decimal.js'
import { exactPlainObject, issue, ownDataValue, type ValidationIssue } from '../core/validation.js'
import type {
  DecimalValue,
  NormalizedHip1AnchorGenesisEligibilityInput,
  NormalizedHip1DeploymentInput,
} from './types.js'

const deploymentKeys = [
  'name',
  'weiDecimals',
  'szDecimals',
  'maxSupplyWei',
  'userGenesisWei',
  'anchorGenesisWei',
] as const

const anchorGenesisKeys = ['holderBalanceWei', 'anchorTokenMaxSupplyWei'] as const

export type NormalizeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: ValidationIssue }

function canonicalizeIntegerString(
  input: unknown,
  path: string,
): NormalizeResult<{ value: string; decimal: DecimalValue }> {
  if (typeof input !== 'string') {
    return {
      ok: false,
      issue: issue('invalid-integer-string', path, input, 'non-negative integer decimal string'),
    }
  }
  if (input.length > MAX_DECIMAL_STRING_LENGTH) {
    return {
      ok: false,
      issue: issue(
        'decimal-string-too-long',
        path,
        `string-length:${input.length}`,
        `plain decimal string no longer than ${MAX_DECIMAL_STRING_LENGTH} characters`,
      ),
    }
  }
  if (!/^\d+$/.test(input)) {
    return {
      ok: false,
      issue: issue('invalid-integer-string', path, input, 'non-negative integer decimal string'),
    }
  }

  const value = input.replace(/^0+(?=\d)/, '')
  const significantDigits = value === '0' ? 1 : value.length
  if (significantDigits > 40) {
    return {
      ok: false,
      issue: issue(
        'integer-overflow',
        path,
        value,
        'integer string with at most 40 significant digits',
      ),
    }
  }

  return { ok: true, value: { value, decimal: new Decimal40(value) } }
}

function validateDecimals(input: unknown, path: string): NormalizeResult<number> {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0 || input > 255) {
    return {
      ok: false,
      issue: issue('invalid-decimal-count', path, input, 'safe integer in range 0..255'),
    }
  }
  return { ok: true, value: input }
}

function hasUnpairedSurrogate(input: string): boolean {
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

function validateName(input: unknown): NormalizeResult<string> {
  if (typeof input !== 'string') {
    return { ok: false, issue: issue('invalid-token-name', '/name', input, 'string') }
  }
  if (hasUnpairedSurrogate(input)) {
    return {
      ok: false,
      issue: issue('invalid-token-name', '/name', input, 'valid ECMAScript Unicode scalar text'),
    }
  }
  return { ok: true, value: input }
}

export function countCodePoints(input: string): number {
  return [...input].length
}

export function significantDigitCount(value: string): number {
  const trimmed = value.replace('-', '').replace('.', '').replace(/^0+/, '')
  return trimmed.length === 0 ? 1 : trimmed.length
}

export function assertDecimalStringSignificantDigitGuard(
  value: string,
  path: string,
): NormalizeResult<string> {
  if (significantDigitCount(value) > 40) {
    return {
      ok: false,
      issue: issue(
        'integer-overflow',
        path,
        value,
        'decimal arithmetic result within 40 significant digits',
      ),
    }
  }
  return { ok: true, value }
}

export function assertDecimalArithmeticGuard(
  value: DecimalValue,
  path: string,
): NormalizeResult<string> {
  const output = value.isZero() ? '0' : value.toFixed()
  return assertDecimalStringSignificantDigitGuard(output, path)
}

export function normalizeHip1DeploymentInput(
  input: unknown,
): NormalizeResult<NormalizedHip1DeploymentInput> {
  const shape = exactPlainObject(input, deploymentKeys, '')
  if (!shape.ok) return shape

  const name = validateName(ownDataValue(shape.object, 'name'))
  if (!name.ok) return name
  const weiDecimals = validateDecimals(ownDataValue(shape.object, 'weiDecimals'), '/weiDecimals')
  if (!weiDecimals.ok) return weiDecimals
  const szDecimals = validateDecimals(ownDataValue(shape.object, 'szDecimals'), '/szDecimals')
  if (!szDecimals.ok) return szDecimals
  const maxSupplyWei = canonicalizeIntegerString(
    ownDataValue(shape.object, 'maxSupplyWei'),
    '/maxSupplyWei',
  )
  if (!maxSupplyWei.ok) return maxSupplyWei
  const userGenesisWei = canonicalizeIntegerString(
    ownDataValue(shape.object, 'userGenesisWei'),
    '/userGenesisWei',
  )
  if (!userGenesisWei.ok) return userGenesisWei
  const anchorGenesisWei = canonicalizeIntegerString(
    ownDataValue(shape.object, 'anchorGenesisWei'),
    '/anchorGenesisWei',
  )
  if (!anchorGenesisWei.ok) return anchorGenesisWei

  return {
    ok: true,
    value: {
      name: name.value,
      weiDecimals: weiDecimals.value,
      szDecimals: szDecimals.value,
      maxSupplyWei: maxSupplyWei.value.value,
      userGenesisWei: userGenesisWei.value.value,
      anchorGenesisWei: anchorGenesisWei.value.value,
      maxSupplyWeiDecimal: maxSupplyWei.value.decimal,
      userGenesisWeiDecimal: userGenesisWei.value.decimal,
      anchorGenesisWeiDecimal: anchorGenesisWei.value.decimal,
    },
  }
}

export function normalizeHip1AnchorGenesisEligibilityInput(
  input: unknown,
): NormalizeResult<NormalizedHip1AnchorGenesisEligibilityInput> {
  const shape = exactPlainObject(input, anchorGenesisKeys, '')
  if (!shape.ok) return shape

  const holderBalanceWei = canonicalizeIntegerString(
    ownDataValue(shape.object, 'holderBalanceWei'),
    '/holderBalanceWei',
  )
  if (!holderBalanceWei.ok) return holderBalanceWei
  const anchorTokenMaxSupplyWei = canonicalizeIntegerString(
    ownDataValue(shape.object, 'anchorTokenMaxSupplyWei'),
    '/anchorTokenMaxSupplyWei',
  )
  if (!anchorTokenMaxSupplyWei.ok) return anchorTokenMaxSupplyWei

  return {
    ok: true,
    value: {
      holderBalanceWei: holderBalanceWei.value.value,
      anchorTokenMaxSupplyWei: anchorTokenMaxSupplyWei.value.value,
      holderBalanceWeiDecimal: holderBalanceWei.value.decimal,
      anchorTokenMaxSupplyWeiDecimal: anchorTokenMaxSupplyWei.value.decimal,
    },
  }
}
