import type { Decimal40 } from '../core/decimal.js'
import {
  exactPlainArray,
  exactPlainObject,
  issue,
  normalizeDecimalAt,
  ownDataValue,
  reason,
} from '../core/validation.js'
import type { MathIssue } from '../model/index.js'
import type {
  NormalizedCalculateOutcomeDualPriceInput,
  NormalizedCalculateOutcomeSettlementInput,
  NormalizedEvaluatePriceBinaryOutcomeInput,
  NormalizedEvaluatePriceBucketOutcomeInput,
  NormalizedEvaluateRecurringOutcomeInput,
} from './types.js'

export { reason }

type NormalizedResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: MathIssue }

type DecimalValue = InstanceType<typeof Decimal40>

function normalizeUnitIntervalDecimal(
  input: unknown,
  path: string,
): ReturnType<typeof normalizeDecimalAt> {
  const normalized = normalizeDecimalAt(input, path, 'non-negative')
  if (!normalized.ok) return normalized
  if (normalized.decimal.gt(1)) {
    return {
      ok: false,
      issue: issue('decimal-out-of-range', path, normalized.value, 'decimal string in [0, 1]'),
    }
  }
  return normalized
}

function normalizeSafeInteger(input: unknown, path: string): NormalizedResult<number> {
  if (typeof input !== 'number' || !Number.isSafeInteger(input)) {
    return {
      ok: false,
      issue: issue('invalid-integer', path, input, 'safe integer'),
    }
  }
  return { ok: true, value: input }
}

export function normalizeCalculateOutcomeDualPriceInput(
  input: unknown,
): NormalizedResult<NormalizedCalculateOutcomeDualPriceInput> {
  const root = exactPlainObject(input, ['price'], '')
  if (!root.ok) return root
  const price = normalizeUnitIntervalDecimal(ownDataValue(root.object, 'price'), '/price')
  if (!price.ok) return price

  return {
    ok: true,
    value: {
      price: price.value,
      priceDecimal: price.decimal,
    },
  }
}

export function normalizeCalculateOutcomeSettlementInput(
  input: unknown,
): NormalizedResult<NormalizedCalculateOutcomeSettlementInput> {
  const root = exactPlainObject(input, ['tokenSide', 'settleFraction', 'size', 'entryPrice'], '')
  if (!root.ok) return root

  const tokenSide = ownDataValue(root.object, 'tokenSide')
  if (tokenSide !== 'yes' && tokenSide !== 'no') {
    return {
      ok: false,
      issue: issue('invalid-token-side', '/tokenSide', tokenSide, 'yes or no'),
    }
  }
  const settleFraction = normalizeUnitIntervalDecimal(
    ownDataValue(root.object, 'settleFraction'),
    '/settleFraction',
  )
  if (!settleFraction.ok) return settleFraction
  const size = normalizeDecimalAt(ownDataValue(root.object, 'size'), '/size', 'non-negative')
  if (!size.ok) return size
  const entryPrice = normalizeUnitIntervalDecimal(
    ownDataValue(root.object, 'entryPrice'),
    '/entryPrice',
  )
  if (!entryPrice.ok) return entryPrice

  return {
    ok: true,
    value: {
      tokenSide,
      settleFraction: settleFraction.value,
      settleFractionDecimal: settleFraction.decimal,
      size: size.value,
      sizeDecimal: size.decimal,
      entryPrice: entryPrice.value,
      entryPriceDecimal: entryPrice.decimal,
    },
  }
}

function readRecurringClass(input: unknown): NormalizedResult<unknown> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return {
        ok: false,
        issue: issue('invalid-input-shape', '', input, 'plain recurring outcome input'),
      }
    }
    const prototype = Object.getPrototypeOf(input) as object | null
    if (prototype !== Object.prototype && prototype !== null) {
      return {
        ok: false,
        issue: issue('invalid-input-shape', '', input, 'plain recurring outcome input'),
      }
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(input, 'class')
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      descriptor.enumerable !== true
    ) {
      return {
        ok: false,
        issue: issue('invalid-input-shape', '/class', 'class', 'enumerable own data field'),
      }
    }
    return { ok: true, value: descriptor.value }
  } catch {
    return {
      ok: false,
      issue: issue(
        'invalid-input-shape',
        '',
        'uninspectable-object',
        'plain recurring outcome input',
      ),
    }
  }
}

function normalizeRecurringBase(object: Record<PropertyKey, unknown>): NormalizedResult<{
  readonly markPrice0: string
  readonly markPrice0Decimal: DecimalValue
  readonly t0: number
  readonly markPrice1: string
  readonly markPrice1Decimal: DecimalValue
  readonly t1: number
  readonly settlementTime: number
}> {
  const markPrice0 = normalizeDecimalAt(
    ownDataValue(object, 'markPrice0'),
    '/markPrice0',
    'positive',
  )
  if (!markPrice0.ok) return markPrice0
  const t0 = normalizeSafeInteger(ownDataValue(object, 't0'), '/t0')
  if (!t0.ok) return t0
  const markPrice1 = normalizeDecimalAt(
    ownDataValue(object, 'markPrice1'),
    '/markPrice1',
    'positive',
  )
  if (!markPrice1.ok) return markPrice1
  const t1 = normalizeSafeInteger(ownDataValue(object, 't1'), '/t1')
  if (!t1.ok) return t1
  const settlementTime = normalizeSafeInteger(
    ownDataValue(object, 'settlementTime'),
    '/settlementTime',
  )
  if (!settlementTime.ok) return settlementTime

  if (t0.value >= t1.value) {
    return {
      ok: false,
      issue: issue('invalid-time-interval', '/t1', t1.value, 'safe integer greater than t0'),
    }
  }
  if (settlementTime.value < t0.value || settlementTime.value > t1.value) {
    return {
      ok: false,
      issue: issue(
        'settlement-time-out-of-range',
        '/settlementTime',
        settlementTime.value,
        'safe integer in [t0, t1]',
      ),
    }
  }

  return {
    ok: true,
    value: {
      markPrice0: markPrice0.value,
      markPrice0Decimal: markPrice0.decimal,
      t0: t0.value,
      markPrice1: markPrice1.value,
      markPrice1Decimal: markPrice1.decimal,
      t1: t1.value,
      settlementTime: settlementTime.value,
    },
  }
}

function normalizePriceBinaryInput(
  input: unknown,
): NormalizedResult<NormalizedEvaluatePriceBinaryOutcomeInput> {
  const root = exactPlainObject(
    input,
    ['class', 'markPrice0', 't0', 'markPrice1', 't1', 'settlementTime', 'targetPrice'],
    '',
  )
  if (!root.ok) return root
  const base = normalizeRecurringBase(root.object)
  if (!base.ok) return base
  const targetPrice = normalizeDecimalAt(
    ownDataValue(root.object, 'targetPrice'),
    '/targetPrice',
    'positive',
  )
  if (!targetPrice.ok) return targetPrice

  return {
    ok: true,
    value: {
      class: 'priceBinary',
      ...base.value,
      targetPrice: targetPrice.value,
      targetPriceDecimal: targetPrice.decimal,
    },
  }
}

function normalizePriceBucketInput(
  input: unknown,
): NormalizedResult<NormalizedEvaluatePriceBucketOutcomeInput> {
  const root = exactPlainObject(
    input,
    ['class', 'markPrice0', 't0', 'markPrice1', 't1', 'settlementTime', 'priceThresholds'],
    '',
  )
  if (!root.ok) return root
  const base = normalizeRecurringBase(root.object)
  if (!base.ok) return base

  const thresholds = exactPlainArray(
    ownDataValue(root.object, 'priceThresholds'),
    '/priceThresholds',
    { exactLength: 2, maxLength: 2 },
  )
  if (!thresholds.ok) return thresholds
  const threshold0 = normalizeDecimalAt(thresholds.values[0], '/priceThresholds/0', 'positive')
  if (!threshold0.ok) return threshold0
  const threshold1 = normalizeDecimalAt(thresholds.values[1], '/priceThresholds/1', 'positive')
  if (!threshold1.ok) return threshold1
  if (!threshold0.decimal.lt(threshold1.decimal)) {
    return {
      ok: false,
      issue: issue(
        'invalid-price-threshold-order',
        '/priceThresholds/1',
        threshold1.value,
        'price threshold greater than priceThresholds[0]',
      ),
    }
  }

  return {
    ok: true,
    value: {
      class: 'priceBucket',
      ...base.value,
      priceThresholds: [threshold0.value, threshold1.value],
      priceThresholdDecimals: [threshold0.decimal, threshold1.decimal],
    },
  }
}

export function normalizeEvaluateRecurringOutcomeInput(
  input: unknown,
): NormalizedResult<NormalizedEvaluateRecurringOutcomeInput> {
  const outcomeClass = readRecurringClass(input)
  if (!outcomeClass.ok) return outcomeClass
  if (outcomeClass.value === 'priceBinary') return normalizePriceBinaryInput(input)
  if (outcomeClass.value === 'priceBucket') return normalizePriceBucketInput(input)
  return {
    ok: false,
    issue: issue(
      'invalid-recurring-outcome-class',
      '/class',
      outcomeClass.value,
      'priceBinary or priceBucket',
    ),
  }
}
