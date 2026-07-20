import {
  exactPlainObject,
  issue,
  normalizeDecimalAt,
  ownDataValue,
  reason,
} from '../core/validation.js'
import type { MathIssue, MathReason } from '../model/index.js'
import type {
  NormalizedAnnualizeFundingRateInput,
  NormalizedFundingPaymentInput,
  NormalizedFundingPremiumIndexInput,
  NormalizedFundingRateInput,
  NormalizedFundingRateRules,
} from './types.js'

export { reason }

type NormalizedResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: MathIssue }

function invalidRoot<T>(input: unknown, keys: readonly string[]): NormalizedResult<T> {
  const root = exactPlainObject(input, keys, '')
  if (!root.ok) return { ok: false, issue: root.issue }
  return { ok: true, value: root.object as T }
}

export function normalizeFundingPremiumIndexInput(
  input: unknown,
): NormalizedResult<NormalizedFundingPremiumIndexInput> {
  const root = invalidRoot<Record<PropertyKey, unknown>>(input, [
    'impactBidPrice',
    'impactAskPrice',
    'oraclePrice',
  ])
  if (!root.ok) return root

  const impactBidPrice = normalizeDecimalAt(
    ownDataValue(root.value, 'impactBidPrice'),
    '/impactBidPrice',
    'positive',
  )
  if (!impactBidPrice.ok) return { ok: false, issue: impactBidPrice.issue }

  const impactAskPrice = normalizeDecimalAt(
    ownDataValue(root.value, 'impactAskPrice'),
    '/impactAskPrice',
    'positive',
  )
  if (!impactAskPrice.ok) return { ok: false, issue: impactAskPrice.issue }

  const oraclePrice = normalizeDecimalAt(
    ownDataValue(root.value, 'oraclePrice'),
    '/oraclePrice',
    'positive',
  )
  if (!oraclePrice.ok) return { ok: false, issue: oraclePrice.issue }

  return {
    ok: true,
    value: {
      impactBidPrice: impactBidPrice.value,
      impactBidPriceDecimal: impactBidPrice.decimal,
      impactAskPrice: impactAskPrice.value,
      impactAskPriceDecimal: impactAskPrice.decimal,
      oraclePrice: oraclePrice.value,
      oraclePriceDecimal: oraclePrice.decimal,
    },
  }
}

function normalizeFundingRateRules(input: unknown): NormalizedResult<NormalizedFundingRateRules> {
  const rules = exactPlainObject(
    input,
    ['interestRate', 'clampLower', 'clampUpper', 'baseIntervalHours', 'hourlyCap'],
    '/rules',
  )
  if (!rules.ok) return { ok: false, issue: rules.issue }

  const interestRate = normalizeDecimalAt(
    ownDataValue(rules.object, 'interestRate'),
    '/rules/interestRate',
    'signed',
  )
  if (!interestRate.ok) return { ok: false, issue: interestRate.issue }

  const clampLower = normalizeDecimalAt(
    ownDataValue(rules.object, 'clampLower'),
    '/rules/clampLower',
    'signed',
  )
  if (!clampLower.ok) return { ok: false, issue: clampLower.issue }

  const clampUpper = normalizeDecimalAt(
    ownDataValue(rules.object, 'clampUpper'),
    '/rules/clampUpper',
    'signed',
  )
  if (!clampUpper.ok) return { ok: false, issue: clampUpper.issue }

  if (clampLower.decimal.gt(0)) {
    return {
      ok: false,
      issue: issue('invalid-funding-rate-rules', '/rules/clampLower', clampLower.value, '<= 0'),
    }
  }
  if (clampUpper.decimal.lt(0)) {
    return {
      ok: false,
      issue: issue('invalid-funding-rate-rules', '/rules/clampUpper', clampUpper.value, '>= 0'),
    }
  }
  const baseIntervalHours = ownDataValue(rules.object, 'baseIntervalHours')
  if (
    typeof baseIntervalHours !== 'number' ||
    !Number.isSafeInteger(baseIntervalHours) ||
    baseIntervalHours <= 0 ||
    baseIntervalHours > 24
  ) {
    return {
      ok: false,
      issue: issue(
        'invalid-base-interval-hours',
        '/rules/baseIntervalHours',
        baseIntervalHours,
        'positive safe integer no greater than 24',
      ),
    }
  }

  const hourlyCap = normalizeDecimalAt(
    ownDataValue(rules.object, 'hourlyCap'),
    '/rules/hourlyCap',
    'non-negative',
  )
  if (!hourlyCap.ok) return { ok: false, issue: hourlyCap.issue }

  return {
    ok: true,
    value: {
      interestRate: interestRate.value,
      interestRateDecimal: interestRate.decimal,
      clampLower: clampLower.value,
      clampLowerDecimal: clampLower.decimal,
      clampUpper: clampUpper.value,
      clampUpperDecimal: clampUpper.decimal,
      baseIntervalHours,
      hourlyCap: hourlyCap.value,
      hourlyCapDecimal: hourlyCap.decimal,
    },
  }
}

export function normalizeFundingRateInput(
  input: unknown,
): NormalizedResult<NormalizedFundingRateInput> {
  const root = invalidRoot<Record<PropertyKey, unknown>>(input, ['averagePremiumIndex', 'rules'])
  if (!root.ok) return root

  const averagePremiumIndex = normalizeDecimalAt(
    ownDataValue(root.value, 'averagePremiumIndex'),
    '/averagePremiumIndex',
    'signed',
  )
  if (!averagePremiumIndex.ok) return { ok: false, issue: averagePremiumIndex.issue }

  const rules = normalizeFundingRateRules(ownDataValue(root.value, 'rules'))
  if (!rules.ok) return rules

  return {
    ok: true,
    value: {
      averagePremiumIndex: averagePremiumIndex.value,
      averagePremiumIndexDecimal: averagePremiumIndex.decimal,
      rules: rules.value,
    },
  }
}

export function normalizeFundingPaymentInput(
  input: unknown,
): NormalizedResult<NormalizedFundingPaymentInput> {
  const root = invalidRoot<Record<PropertyKey, unknown>>(input, [
    'signedPositionSize',
    'oraclePrice',
    'fundingRate',
  ])
  if (!root.ok) return root

  const signedPositionSize = normalizeDecimalAt(
    ownDataValue(root.value, 'signedPositionSize'),
    '/signedPositionSize',
    'signed',
  )
  if (!signedPositionSize.ok) return { ok: false, issue: signedPositionSize.issue }

  const oraclePrice = normalizeDecimalAt(
    ownDataValue(root.value, 'oraclePrice'),
    '/oraclePrice',
    'positive',
  )
  if (!oraclePrice.ok) return { ok: false, issue: oraclePrice.issue }

  const fundingRate = normalizeDecimalAt(
    ownDataValue(root.value, 'fundingRate'),
    '/fundingRate',
    'signed',
  )
  if (!fundingRate.ok) return { ok: false, issue: fundingRate.issue }

  return {
    ok: true,
    value: {
      signedPositionSize: signedPositionSize.value,
      signedPositionSizeDecimal: signedPositionSize.decimal,
      oraclePrice: oraclePrice.value,
      oraclePriceDecimal: oraclePrice.decimal,
      fundingRate: fundingRate.value,
      fundingRateDecimal: fundingRate.decimal,
    },
  }
}

export function normalizeAnnualizeFundingRateInput(
  input: unknown,
): NormalizedResult<NormalizedAnnualizeFundingRateInput> {
  const root = invalidRoot<Record<PropertyKey, unknown>>(input, [
    'periodicRate',
    'periodsPerYear',
    'convention',
  ])
  if (!root.ok) return root

  const periodicRate = normalizeDecimalAt(
    ownDataValue(root.value, 'periodicRate'),
    '/periodicRate',
    'signed',
  )
  if (!periodicRate.ok) return { ok: false, issue: periodicRate.issue }

  const periodsPerYear = ownDataValue(root.value, 'periodsPerYear')
  if (
    typeof periodsPerYear !== 'number' ||
    !Number.isSafeInteger(periodsPerYear) ||
    periodsPerYear <= 0 ||
    periodsPerYear > 100000
  ) {
    return {
      ok: false,
      issue: issue(
        'invalid-periods-per-year',
        '/periodsPerYear',
        periodsPerYear,
        'positive safe integer no greater than 100000',
      ),
    }
  }

  const convention = ownDataValue(root.value, 'convention')
  if (convention !== 'simple' && convention !== 'compound') {
    return {
      ok: false,
      issue: issue(
        'invalid-annualization-convention',
        '/convention',
        convention,
        'simple or compound',
      ),
    }
  }

  return {
    ok: true,
    value: {
      periodicRate: periodicRate.value,
      periodicRateDecimal: periodicRate.decimal,
      periodsPerYear,
      convention,
    },
  }
}

export function invalidReason(issueValue: MathIssue): MathReason {
  return reason(issueValue.code, issueValue.path ?? '')
}
