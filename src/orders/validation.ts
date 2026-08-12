import { Decimal40 } from '../core/decimal.js'
import {
  exactPlainObject,
  issue,
  normalizeDecimalAt,
  normalizeMathReason,
  ownDataValue,
} from '../core/validation.js'
import type { MathIssue, MathReason } from '../model/index.js'
import type {
  BuildPerpScaleLadderInput,
  CalculatePerpMaxOrderSizeInput,
  CalculatePerpSlippagePriceInput,
  CalculatePerpTwapExecutionTargetInput,
  ClassifyPerpTriggerInput,
  DecimalValue,
  DerivePerpTriggerPriceInput,
  EvaluatePerpReduceOnlyInput,
  PerpOrderSide,
  PerpPositionSide,
  PerpScaleDistribution,
  ValidatePerpOrderInput,
} from './types.js'

export type NormalizedResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: MathIssue }

export interface NormalizedRuleAvailable<T> {
  readonly kind: 'available'
  readonly value: T
}

export type NormalizedRule<T> =
  | NormalizedRuleAvailable<T>
  | { readonly kind: 'not-applicable'; readonly reason: MathReason }
  | { readonly kind: 'not-supported'; readonly reason: MathReason }

export interface DecimalText {
  readonly value: string
  readonly decimal: DecimalValue
}

export interface NormalizedValidatePerpOrderInput {
  readonly price: string
  readonly priceDecimal: DecimalValue
  readonly size: string
  readonly sizeDecimal: DecimalValue
  readonly szDecimals: number
  readonly minimumNotional: NormalizedRule<DecimalText>
  readonly priceBand: NormalizedRule<{
    readonly lowerBound: string
    readonly lowerBoundDecimal: DecimalValue
    readonly upperBound: string
    readonly upperBoundDecimal: DecimalValue
  }>
}

export interface NormalizedCalculatePerpMaxOrderSizeInput {
  readonly availableCollateral: string
  readonly availableCollateralDecimal: DecimalValue
  readonly leverage: string
  readonly leverageDecimal: DecimalValue
  readonly referencePrice: string
  readonly referencePriceDecimal: DecimalValue
  readonly currentSignedSize: string
  readonly currentSignedSizeDecimal: DecimalValue
  readonly side: PerpOrderSide
  readonly reduceOnly: boolean
  readonly szDecimals: number
  readonly orderValueLimit: NormalizedRule<DecimalText>
}

export interface NormalizedEvaluatePerpReduceOnlyInput {
  readonly currentSignedSize: string
  readonly currentSignedSizeDecimal: DecimalValue
  readonly side: PerpOrderSide
  readonly requestedSize: string
  readonly requestedSizeDecimal: DecimalValue
}

export interface NormalizedCalculatePerpSlippagePriceInput {
  readonly side: PerpOrderSide
  readonly referencePrice: string
  readonly referencePriceDecimal: DecimalValue
  readonly slippageBps: string
  readonly slippageBpsDecimal: DecimalValue
  readonly szDecimals: number
}

export interface NormalizedClassifyPerpTriggerInput {
  readonly positionSide: PerpPositionSide
  readonly orderSide: PerpOrderSide
  readonly markPrice: string
  readonly markPriceDecimal: DecimalValue
  readonly triggerPrice: string
  readonly triggerPriceDecimal: DecimalValue
}

export interface NormalizedDerivePerpTriggerPriceInput {
  readonly position: {
    readonly signedSize: string
    readonly signedSizeDecimal: DecimalValue
    readonly entryPrice: string
    readonly entryPriceDecimal: DecimalValue
  }
  readonly target:
    | { readonly kind: 'pnl'; readonly amount: string; readonly amountDecimal: DecimalValue }
    | {
        readonly kind: 'roe'
        readonly ratio: string
        readonly ratioDecimal: DecimalValue
        readonly leverage: string
        readonly leverageDecimal: DecimalValue
      }
  readonly cumulativeCost: string
  readonly cumulativeCostDecimal: DecimalValue
}

export interface NormalizedBuildPerpScaleLadderInput {
  readonly side: PerpOrderSide
  readonly lowerPrice: string
  readonly lowerPriceDecimal: DecimalValue
  readonly upperPrice: string
  readonly upperPriceDecimal: DecimalValue
  readonly totalSize: string
  readonly totalSizeDecimal: DecimalValue
  readonly legCount: number
  readonly distribution: PerpScaleDistribution
  readonly szDecimals: number
}

export interface NormalizedCalculatePerpTwapExecutionTargetInput {
  readonly totalSize: string
  readonly totalSizeDecimal: DecimalValue
  readonly durationMs: number
  readonly elapsedMs: number
}

function root(
  input: unknown,
  keys: readonly string[],
): NormalizedResult<Record<PropertyKey, unknown>> {
  const object = exactPlainObject(input, keys, '')
  if (!object.ok) return { ok: false, issue: object.issue }
  return { ok: true, value: object.object }
}

function decimal(
  input: unknown,
  path: string,
  mode: 'signed' | 'non-negative' | 'positive',
): NormalizedResult<DecimalText> {
  const value = normalizeDecimalAt(input, path, mode)
  if (!value.ok) return { ok: false, issue: value.issue }
  return { ok: true, value: { value: value.value, decimal: value.decimal } }
}

function szDecimals(input: unknown, path: string): NormalizedResult<number> {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0 || input > 6) {
    return {
      ok: false,
      issue: issue('invalid-sz-decimals', path, input, 'safe integer between 0 and 6'),
    }
  }
  return { ok: true, value: input }
}

function side(input: unknown, path: string): NormalizedResult<PerpOrderSide> {
  if (input !== 'buy' && input !== 'sell') {
    return { ok: false, issue: issue('invalid-order-side', path, input, 'buy or sell') }
  }
  return { ok: true, value: input }
}

function rule<T>(
  input: unknown,
  path: string,
  normalizeAvailable: (value: unknown, valuePath: string) => NormalizedResult<T>,
): NormalizedResult<NormalizedRule<T>> {
  const object = exactPlainObject(input, ['kind', 'value'], path)
  if (object.ok) {
    const kind = ownDataValue(object.object, 'kind')
    if (kind !== 'available')
      return { ok: false, issue: issue('invalid-rule-kind', `${path}/kind`, kind, 'available') }
    const value = normalizeAvailable(ownDataValue(object.object, 'value'), `${path}/value`)
    if (!value.ok) return value
    return { ok: true, value: { kind, value: value.value } }
  }

  const unavailable = exactPlainObject(input, ['kind', 'reason'], path)
  if (!unavailable.ok) return { ok: false, issue: object.issue }
  const kind = ownDataValue(unavailable.object, 'kind')
  if (kind === 'not-applicable') {
    const reasonValue = normalizeMathReason(
      ownDataValue(unavailable.object, 'reason'),
      `${path}/reason`,
    )
    if (!reasonValue.ok) return reasonValue
    return { ok: true, value: { kind, reason: reasonValue.reason } }
  }
  if (kind === 'not-supported') {
    const reasonValue = normalizeMathReason(
      ownDataValue(unavailable.object, 'reason'),
      `${path}/reason`,
    )
    if (!reasonValue.ok) return reasonValue as NormalizedResult<NormalizedRule<T>>
    return { ok: true, value: { kind, reason: reasonValue.reason } }
  }
  return {
    ok: false,
    issue: issue(
      'invalid-rule-kind',
      `${path}/kind`,
      kind,
      'available, not-applicable, or not-supported',
    ),
  }
}

function priceBand(
  input: unknown,
  path: string,
): NormalizedResult<
  NormalizedValidatePerpOrderInput['priceBand'] extends NormalizedRule<infer T> ? T : never
> {
  const object = exactPlainObject(input, ['lowerBound', 'upperBound'], path)
  if (!object.ok) return { ok: false, issue: object.issue }
  const lower = decimal(ownDataValue(object.object, 'lowerBound'), `${path}/lowerBound`, 'positive')
  if (!lower.ok) return lower
  const upper = decimal(ownDataValue(object.object, 'upperBound'), `${path}/upperBound`, 'positive')
  if (!upper.ok) return upper
  if (lower.value.decimal.gt(upper.value.decimal)) {
    return {
      ok: false,
      issue: issue(
        'invalid-price-band',
        path,
        `${lower.value.value}..${upper.value.value}`,
        'lowerBound <= upperBound',
      ),
    }
  }
  return {
    ok: true,
    value: {
      lowerBound: lower.value.value,
      lowerBoundDecimal: lower.value.decimal,
      upperBound: upper.value.value,
      upperBoundDecimal: upper.value.decimal,
    },
  }
}

export function normalizeValidatePerpOrderInput(
  input: ValidatePerpOrderInput,
): NormalizedResult<NormalizedValidatePerpOrderInput> {
  const object = root(input, ['price', 'size', 'szDecimals', 'minimumNotional', 'priceBand'])
  if (!object.ok) return object
  const price = decimal(ownDataValue(object.value, 'price'), '/price', 'positive')
  if (!price.ok) return price
  const size = decimal(ownDataValue(object.value, 'size'), '/size', 'positive')
  if (!size.ok) return size
  const decimals = szDecimals(ownDataValue(object.value, 'szDecimals'), '/szDecimals')
  if (!decimals.ok) return decimals
  const minimumNotional = rule(
    ownDataValue(object.value, 'minimumNotional'),
    '/minimumNotional',
    (value, path) => decimal(value, path, 'positive'),
  )
  if (!minimumNotional.ok) return minimumNotional
  const band = rule(ownDataValue(object.value, 'priceBand'), '/priceBand', priceBand)
  if (!band.ok) return band
  return {
    ok: true,
    value: {
      price: price.value.value,
      priceDecimal: price.value.decimal,
      size: size.value.value,
      sizeDecimal: size.value.decimal,
      szDecimals: decimals.value,
      minimumNotional: minimumNotional.value,
      priceBand: band.value,
    },
  }
}

export function normalizeCalculatePerpMaxOrderSizeInput(
  input: CalculatePerpMaxOrderSizeInput,
): NormalizedResult<NormalizedCalculatePerpMaxOrderSizeInput> {
  const object = root(input, [
    'availableCollateral',
    'leverage',
    'referencePrice',
    'currentSignedSize',
    'side',
    'reduceOnly',
    'szDecimals',
    'orderValueLimit',
  ])
  if (!object.ok) return object
  const availableCollateral = decimal(
    ownDataValue(object.value, 'availableCollateral'),
    '/availableCollateral',
    'non-negative',
  )
  if (!availableCollateral.ok) return availableCollateral
  const leverage = decimal(ownDataValue(object.value, 'leverage'), '/leverage', 'positive')
  if (!leverage.ok) return leverage
  const referencePrice = decimal(
    ownDataValue(object.value, 'referencePrice'),
    '/referencePrice',
    'positive',
  )
  if (!referencePrice.ok) return referencePrice
  const currentSignedSize = decimal(
    ownDataValue(object.value, 'currentSignedSize'),
    '/currentSignedSize',
    'signed',
  )
  if (!currentSignedSize.ok) return currentSignedSize
  const orderSide = side(ownDataValue(object.value, 'side'), '/side')
  if (!orderSide.ok) return orderSide
  const reduceOnly = ownDataValue(object.value, 'reduceOnly')
  if (typeof reduceOnly !== 'boolean') {
    return { ok: false, issue: issue('invalid-reduce-only', '/reduceOnly', reduceOnly, 'boolean') }
  }
  const decimals = szDecimals(ownDataValue(object.value, 'szDecimals'), '/szDecimals')
  if (!decimals.ok) return decimals
  const orderValueLimit = rule(
    ownDataValue(object.value, 'orderValueLimit'),
    '/orderValueLimit',
    (value, path) => decimal(value, path, 'positive'),
  )
  if (!orderValueLimit.ok) return orderValueLimit
  return {
    ok: true,
    value: {
      availableCollateral: availableCollateral.value.value,
      availableCollateralDecimal: availableCollateral.value.decimal,
      leverage: leverage.value.value,
      leverageDecimal: leverage.value.decimal,
      referencePrice: referencePrice.value.value,
      referencePriceDecimal: referencePrice.value.decimal,
      currentSignedSize: currentSignedSize.value.value,
      currentSignedSizeDecimal: currentSignedSize.value.decimal,
      side: orderSide.value,
      reduceOnly,
      szDecimals: decimals.value,
      orderValueLimit: orderValueLimit.value,
    },
  }
}

export function normalizeEvaluatePerpReduceOnlyInput(
  input: EvaluatePerpReduceOnlyInput,
): NormalizedResult<NormalizedEvaluatePerpReduceOnlyInput> {
  const object = root(input, ['currentSignedSize', 'side', 'requestedSize'])
  if (!object.ok) return object
  const currentSignedSize = decimal(
    ownDataValue(object.value, 'currentSignedSize'),
    '/currentSignedSize',
    'signed',
  )
  if (!currentSignedSize.ok) return currentSignedSize
  const orderSide = side(ownDataValue(object.value, 'side'), '/side')
  if (!orderSide.ok) return orderSide
  const requestedSize = decimal(
    ownDataValue(object.value, 'requestedSize'),
    '/requestedSize',
    'positive',
  )
  if (!requestedSize.ok) return requestedSize
  return {
    ok: true,
    value: {
      currentSignedSize: currentSignedSize.value.value,
      currentSignedSizeDecimal: currentSignedSize.value.decimal,
      side: orderSide.value,
      requestedSize: requestedSize.value.value,
      requestedSizeDecimal: requestedSize.value.decimal,
    },
  }
}

export function normalizeCalculatePerpSlippagePriceInput(
  input: CalculatePerpSlippagePriceInput,
): NormalizedResult<NormalizedCalculatePerpSlippagePriceInput> {
  const object = root(input, ['side', 'referencePrice', 'slippageBps', 'szDecimals'])
  if (!object.ok) return object
  const orderSide = side(ownDataValue(object.value, 'side'), '/side')
  if (!orderSide.ok) return orderSide
  const referencePrice = decimal(
    ownDataValue(object.value, 'referencePrice'),
    '/referencePrice',
    'positive',
  )
  if (!referencePrice.ok) return referencePrice
  const slippageBps = decimal(
    ownDataValue(object.value, 'slippageBps'),
    '/slippageBps',
    'non-negative',
  )
  if (!slippageBps.ok) return slippageBps
  const decimals = szDecimals(ownDataValue(object.value, 'szDecimals'), '/szDecimals')
  if (!decimals.ok) return decimals
  return {
    ok: true,
    value: {
      side: orderSide.value,
      referencePrice: referencePrice.value.value,
      referencePriceDecimal: referencePrice.value.decimal,
      slippageBps: slippageBps.value.value,
      slippageBpsDecimal: slippageBps.value.decimal,
      szDecimals: decimals.value,
    },
  }
}

export function normalizeClassifyPerpTriggerInput(
  input: ClassifyPerpTriggerInput,
): NormalizedResult<NormalizedClassifyPerpTriggerInput> {
  const object = root(input, ['positionSide', 'orderSide', 'markPrice', 'triggerPrice'])
  if (!object.ok) return object
  const positionSide = ownDataValue(object.value, 'positionSide')
  if (positionSide !== 'long' && positionSide !== 'short') {
    return {
      ok: false,
      issue: issue('invalid-position-side', '/positionSide', positionSide, 'long or short'),
    }
  }
  const orderSide = side(ownDataValue(object.value, 'orderSide'), '/orderSide')
  if (!orderSide.ok) return orderSide
  const markPrice = decimal(ownDataValue(object.value, 'markPrice'), '/markPrice', 'positive')
  if (!markPrice.ok) return markPrice
  const triggerPrice = decimal(
    ownDataValue(object.value, 'triggerPrice'),
    '/triggerPrice',
    'positive',
  )
  if (!triggerPrice.ok) return triggerPrice
  return {
    ok: true,
    value: {
      positionSide,
      orderSide: orderSide.value,
      markPrice: markPrice.value.value,
      markPriceDecimal: markPrice.value.decimal,
      triggerPrice: triggerPrice.value.value,
      triggerPriceDecimal: triggerPrice.value.decimal,
    },
  }
}

function normalizeOpenPosition(
  input: unknown,
): NormalizedResult<NormalizedDerivePerpTriggerPriceInput['position']> {
  const object = exactPlainObject(input, ['kind', 'signedSize', 'entryPrice'], '/position')
  if (!object.ok) return { ok: false, issue: object.issue }
  const kind = ownDataValue(object.object, 'kind')
  if (kind !== 'open')
    return { ok: false, issue: issue('invalid-position-kind', '/position/kind', kind, 'open') }
  const signedSize = decimal(
    ownDataValue(object.object, 'signedSize'),
    '/position/signedSize',
    'signed',
  )
  if (!signedSize.ok) return signedSize
  if (signedSize.value.decimal.isZero()) {
    return {
      ok: false,
      issue: issue(
        'invalid-position-size',
        '/position/signedSize',
        signedSize.value.value,
        'non-zero signed decimal',
      ),
    }
  }
  const entryPrice = decimal(
    ownDataValue(object.object, 'entryPrice'),
    '/position/entryPrice',
    'positive',
  )
  if (!entryPrice.ok) return entryPrice
  return {
    ok: true,
    value: {
      signedSize: signedSize.value.value,
      signedSizeDecimal: signedSize.value.decimal,
      entryPrice: entryPrice.value.value,
      entryPriceDecimal: entryPrice.value.decimal,
    },
  }
}

function normalizeTarget(
  input: unknown,
): NormalizedResult<NormalizedDerivePerpTriggerPriceInput['target']> {
  const pnl = exactPlainObject(input, ['kind', 'amount'], '/target')
  if (pnl.ok) {
    const kind = ownDataValue(pnl.object, 'kind')
    if (kind !== 'pnl')
      return { ok: false, issue: issue('invalid-target-kind', '/target/kind', kind, 'pnl') }
    const amount = decimal(ownDataValue(pnl.object, 'amount'), '/target/amount', 'signed')
    if (!amount.ok) return amount
    return {
      ok: true,
      value: { kind, amount: amount.value.value, amountDecimal: amount.value.decimal },
    }
  }
  const roe = exactPlainObject(input, ['kind', 'ratio', 'leverage'], '/target')
  if (!roe.ok) return { ok: false, issue: pnl.issue }
  const kind = ownDataValue(roe.object, 'kind')
  if (kind !== 'roe')
    return { ok: false, issue: issue('invalid-target-kind', '/target/kind', kind, 'pnl or roe') }
  const ratio = decimal(ownDataValue(roe.object, 'ratio'), '/target/ratio', 'signed')
  if (!ratio.ok) return ratio
  const leverage = decimal(ownDataValue(roe.object, 'leverage'), '/target/leverage', 'positive')
  if (!leverage.ok) return leverage
  return {
    ok: true,
    value: {
      kind,
      ratio: ratio.value.value,
      ratioDecimal: ratio.value.decimal,
      leverage: leverage.value.value,
      leverageDecimal: leverage.value.decimal,
    },
  }
}

export function normalizeDerivePerpTriggerPriceInput(
  input: DerivePerpTriggerPriceInput,
): NormalizedResult<NormalizedDerivePerpTriggerPriceInput> {
  const object = root(input, ['position', 'target', 'cumulativeCost'])
  if (!object.ok) return object
  const position = normalizeOpenPosition(ownDataValue(object.value, 'position'))
  if (!position.ok) return position
  const target = normalizeTarget(ownDataValue(object.value, 'target'))
  if (!target.ok) return target
  const cumulativeCost = decimal(
    ownDataValue(object.value, 'cumulativeCost'),
    '/cumulativeCost',
    'non-negative',
  )
  if (!cumulativeCost.ok) return cumulativeCost
  return {
    ok: true,
    value: {
      position: position.value,
      target: target.value,
      cumulativeCost: cumulativeCost.value.value,
      cumulativeCostDecimal: cumulativeCost.value.decimal,
    },
  }
}

export function normalizeBuildPerpScaleLadderInput(
  input: BuildPerpScaleLadderInput,
): NormalizedResult<NormalizedBuildPerpScaleLadderInput> {
  const object = root(input, [
    'side',
    'lowerPrice',
    'upperPrice',
    'totalSize',
    'legCount',
    'distribution',
    'szDecimals',
  ])
  if (!object.ok) return object
  const orderSide = side(ownDataValue(object.value, 'side'), '/side')
  if (!orderSide.ok) return orderSide
  const lowerPrice = decimal(ownDataValue(object.value, 'lowerPrice'), '/lowerPrice', 'positive')
  if (!lowerPrice.ok) return lowerPrice
  const upperPrice = decimal(ownDataValue(object.value, 'upperPrice'), '/upperPrice', 'positive')
  if (!upperPrice.ok) return upperPrice
  if (!lowerPrice.value.decimal.lt(upperPrice.value.decimal)) {
    return {
      ok: false,
      issue: issue(
        'invalid-price-range',
        '',
        `${lowerPrice.value.value}..${upperPrice.value.value}`,
        'lowerPrice < upperPrice',
      ),
    }
  }
  const totalSize = decimal(ownDataValue(object.value, 'totalSize'), '/totalSize', 'positive')
  if (!totalSize.ok) return totalSize
  const legCount = ownDataValue(object.value, 'legCount')
  if (
    typeof legCount !== 'number' ||
    !Number.isSafeInteger(legCount) ||
    legCount < 2 ||
    legCount > 100
  ) {
    return {
      ok: false,
      issue: issue('invalid-leg-count', '/legCount', legCount, 'safe integer between 2 and 100'),
    }
  }
  const distribution = ownDataValue(object.value, 'distribution')
  if (distribution !== 'linear' && distribution !== 'geometric') {
    return {
      ok: false,
      issue: issue('invalid-distribution', '/distribution', distribution, 'linear or geometric'),
    }
  }
  const decimals = szDecimals(ownDataValue(object.value, 'szDecimals'), '/szDecimals')
  if (!decimals.ok) return decimals
  const rounded = totalSize.value.decimal.toDecimalPlaces(decimals.value, Decimal40.ROUND_DOWN)
  if (!rounded.eq(totalSize.value.decimal)) {
    return {
      ok: false,
      issue: issue(
        'invalid-total-size-precision',
        '/totalSize',
        totalSize.value.value,
        rounded.toFixed(),
      ),
    }
  }
  return {
    ok: true,
    value: {
      side: orderSide.value,
      lowerPrice: lowerPrice.value.value,
      lowerPriceDecimal: lowerPrice.value.decimal,
      upperPrice: upperPrice.value.value,
      upperPriceDecimal: upperPrice.value.decimal,
      totalSize: totalSize.value.value,
      totalSizeDecimal: totalSize.value.decimal,
      legCount,
      distribution,
      szDecimals: decimals.value,
    },
  }
}

export function normalizeCalculatePerpTwapExecutionTargetInput(
  input: CalculatePerpTwapExecutionTargetInput,
): NormalizedResult<NormalizedCalculatePerpTwapExecutionTargetInput> {
  const object = root(input, ['totalSize', 'durationMs', 'elapsedMs'])
  if (!object.ok) return object
  const totalSize = decimal(ownDataValue(object.value, 'totalSize'), '/totalSize', 'positive')
  if (!totalSize.ok) return totalSize
  const durationMs = ownDataValue(object.value, 'durationMs')
  if (typeof durationMs !== 'number' || !Number.isSafeInteger(durationMs) || durationMs <= 0) {
    return {
      ok: false,
      issue: issue('invalid-duration-ms', '/durationMs', durationMs, 'positive safe integer'),
    }
  }
  const elapsedMs = ownDataValue(object.value, 'elapsedMs')
  if (typeof elapsedMs !== 'number' || !Number.isSafeInteger(elapsedMs) || elapsedMs < 0) {
    return {
      ok: false,
      issue: issue('invalid-elapsed-ms', '/elapsedMs', elapsedMs, 'non-negative safe integer'),
    }
  }
  if (elapsedMs > durationMs) {
    return {
      ok: false,
      issue: issue('invalid-elapsed-ms', '/elapsedMs', elapsedMs, 'at most durationMs'),
    }
  }
  return {
    ok: true,
    value: {
      totalSize: totalSize.value.value,
      totalSizeDecimal: totalSize.value.decimal,
      durationMs,
      elapsedMs,
    },
  }
}

export function reasonPath(reasonValue: MathReason): string | undefined {
  return 'path' in reasonValue ? reasonValue.path : undefined
}
