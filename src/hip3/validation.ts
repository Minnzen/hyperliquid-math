import { exactPlainObject, issue, normalizeDecimalAt, ownDataValue } from '../core/validation.js'
import type { MathIssue, MathReason } from '../model/index.js'
import type {
  Hip3AccountAbstractionMode,
  Hip3AssetMarginMode,
  Hip3RequestedMarginMode,
  NormalizedCalculateHip3FeeRatesInput,
  NormalizedEvaluateHip3MarginModeInput,
  NormalizedResolveHip3CollateralSourceInput,
} from './types.js'

const unpairedSurrogatePattern = /[\uD800-\uDFFF]/u

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index)
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true
  }
  return false
}

export function reason(code: string, path: string): MathReason {
  return { code, path }
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
): { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issue: MathIssue } {
  if (typeof value === 'string' && (values as readonly string[]).includes(value)) {
    return { ok: true, value: value as T }
  }
  return {
    ok: false,
    issue: issue('invalid-enum-value', path, value, values.join('|')),
  }
}

function booleanValue(
  value: unknown,
  path: string,
):
  | { readonly ok: true; readonly value: boolean }
  | { readonly ok: false; readonly issue: MathIssue } {
  if (typeof value === 'boolean') return { ok: true, value }
  return { ok: false, issue: issue('invalid-boolean', path, value, 'boolean') }
}

function tokenIndex(
  value: unknown,
  path: string,
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly issue: MathIssue } {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return { ok: true, value }
  }
  return {
    ok: false,
    issue: issue('invalid-token-index', path, value, 'non-negative safe integer token index'),
  }
}

export function normalizeResolveHip3CollateralSourceInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: NormalizedResolveHip3CollateralSourceInput }
  | { readonly ok: false; readonly issue: MathIssue } {
  const root = exactPlainObject(
    input,
    ['accountAbstractionMode', 'dex', 'collateralTokenIndex', 'validatorPerpUsdcTokenIndex'],
    '',
  )
  if (!root.ok) return { ok: false, issue: root.issue }

  const accountAbstractionMode = enumValue<Hip3AccountAbstractionMode>(
    ownDataValue(root.object, 'accountAbstractionMode'),
    ['standard', 'unified', 'portfolio', 'dex-abstraction-deprecated'],
    '/accountAbstractionMode',
  )
  if (!accountAbstractionMode.ok) return { ok: false, issue: accountAbstractionMode.issue }

  const dex = ownDataValue(root.object, 'dex')
  if (
    typeof dex !== 'string' ||
    dex.length === 0 ||
    dex.normalize('NFC') !== dex ||
    unpairedSurrogatePattern.test(dex) ||
    hasControlCharacter(dex)
  ) {
    return {
      ok: false,
      issue: issue(
        'invalid-dex',
        '/dex',
        dex,
        'non-empty NFC string with well-formed Unicode and no C0/C1 control characters',
      ),
    }
  }

  const collateralTokenIndex = tokenIndex(
    ownDataValue(root.object, 'collateralTokenIndex'),
    '/collateralTokenIndex',
  )
  if (!collateralTokenIndex.ok) return { ok: false, issue: collateralTokenIndex.issue }
  const validatorPerpUsdcTokenIndex = tokenIndex(
    ownDataValue(root.object, 'validatorPerpUsdcTokenIndex'),
    '/validatorPerpUsdcTokenIndex',
  )
  if (!validatorPerpUsdcTokenIndex.ok) {
    return { ok: false, issue: validatorPerpUsdcTokenIndex.issue }
  }

  return {
    ok: true,
    value: {
      accountAbstractionMode: accountAbstractionMode.value,
      dex,
      collateralTokenIndex: collateralTokenIndex.value,
      validatorPerpUsdcTokenIndex: validatorPerpUsdcTokenIndex.value,
    },
  }
}

export function normalizeEvaluateHip3MarginModeInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: NormalizedEvaluateHip3MarginModeInput }
  | { readonly ok: false; readonly issue: MathIssue } {
  const root = exactPlainObject(input, ['assetMarginMode', 'requestedMode'], '')
  if (!root.ok) return { ok: false, issue: root.issue }

  const assetMarginMode = enumValue<Hip3AssetMarginMode>(
    ownDataValue(root.object, 'assetMarginMode'),
    ['normal', 'noCross', 'strictIsolated'],
    '/assetMarginMode',
  )
  if (!assetMarginMode.ok) return { ok: false, issue: assetMarginMode.issue }

  const requestedMode = enumValue<Hip3RequestedMarginMode>(
    ownDataValue(root.object, 'requestedMode'),
    ['cross', 'isolated'],
    '/requestedMode',
  )
  if (!requestedMode.ok) return { ok: false, issue: requestedMode.issue }

  return {
    ok: true,
    value: { assetMarginMode: assetMarginMode.value, requestedMode: requestedMode.value },
  }
}

export function normalizeCalculateHip3FeeRatesInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: NormalizedCalculateHip3FeeRatesInput }
  | { readonly ok: false; readonly issue: MathIssue } {
  const root = exactPlainObject(
    input,
    [
      'makerRate',
      'takerRate',
      'activeReferralDiscount',
      'isAlignedQuoteToken',
      'deployerFeeScale',
      'growthMode',
    ],
    '',
  )
  if (!root.ok) return { ok: false, issue: root.issue }

  const makerRate = normalizeDecimalAt(
    ownDataValue(root.object, 'makerRate'),
    '/makerRate',
    'signed',
  )
  if (!makerRate.ok) return { ok: false, issue: makerRate.issue }
  const takerRate = normalizeDecimalAt(
    ownDataValue(root.object, 'takerRate'),
    '/takerRate',
    'signed',
  )
  if (!takerRate.ok) return { ok: false, issue: takerRate.issue }
  const activeReferralDiscount = normalizeDecimalAt(
    ownDataValue(root.object, 'activeReferralDiscount'),
    '/activeReferralDiscount',
    'signed',
  )
  if (!activeReferralDiscount.ok) return { ok: false, issue: activeReferralDiscount.issue }
  if (activeReferralDiscount.decimal.lt(0) || activeReferralDiscount.decimal.gt(1)) {
    return {
      ok: false,
      issue: issue(
        'invalid-referral-discount',
        '/activeReferralDiscount',
        activeReferralDiscount.value,
        'decimal in [0,1]',
      ),
    }
  }

  const isAlignedQuoteToken = booleanValue(
    ownDataValue(root.object, 'isAlignedQuoteToken'),
    '/isAlignedQuoteToken',
  )
  if (!isAlignedQuoteToken.ok) return { ok: false, issue: isAlignedQuoteToken.issue }
  const deployerFeeScale = normalizeDecimalAt(
    ownDataValue(root.object, 'deployerFeeScale'),
    '/deployerFeeScale',
    'non-negative',
  )
  if (!deployerFeeScale.ok) return { ok: false, issue: deployerFeeScale.issue }
  const growthMode = booleanValue(ownDataValue(root.object, 'growthMode'), '/growthMode')
  if (!growthMode.ok) return { ok: false, issue: growthMode.issue }

  const invalidScale = growthMode.value
    ? deployerFeeScale.decimal.gte(10)
    : deployerFeeScale.decimal.gt(3)
  if (invalidScale) {
    return {
      ok: false,
      issue: issue(
        'invalid-deployer-fee-scale',
        '/deployerFeeScale',
        deployerFeeScale.value,
        growthMode.value ? 'decimal in [0,10) when growthMode is true' : 'decimal in [0,3]',
      ),
    }
  }

  return {
    ok: true,
    value: {
      makerRate: makerRate.value,
      makerRateDecimal: makerRate.decimal,
      takerRate: takerRate.value,
      takerRateDecimal: takerRate.decimal,
      activeReferralDiscount: activeReferralDiscount.value,
      activeReferralDiscountDecimal: activeReferralDiscount.decimal,
      isAlignedQuoteToken: isAlignedQuoteToken.value,
      deployerFeeScale: deployerFeeScale.value,
      deployerFeeScaleDecimal: deployerFeeScale.decimal,
      growthMode: growthMode.value,
    },
  }
}
