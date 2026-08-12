import { Decimal40 } from '../core/decimal.js'
import { invalidInputResult } from '../core/result.js'
import type {
  Assumption,
  ConstraintCheck,
  JsonObject,
  JsonValue,
  MathIssue,
  MathReason,
  MathResult,
  RoundingDecision,
  TraceStep,
} from '../model/index.js'
import { quantizeProtocolPrice, quantizeProtocolSize } from '../precision/internal.js'
import {
  maxSizeAssumptions,
  ordersReason,
  ordersTrace,
  reduceOnlyAssumptions,
  scaleAssumptions,
  slippageAssumptions,
  triggerClassificationAssumptions,
  triggerDerivationAssumptions,
  twapAssumptions,
  validationAssumptions,
} from './trace.js'
import type {
  BuildPerpScaleLadderInput,
  CalculatePerpMaxOrderSizeInput,
  CalculatePerpSlippagePriceInput,
  CalculatePerpTwapExecutionTargetInput,
  ClassifyPerpTriggerInput,
  DecimalValue,
  DerivedPerpTriggerPrice,
  DerivePerpTriggerPriceInput,
  EvaluatePerpReduceOnlyInput,
  PerpMaxOrderSize,
  PerpOrderSide,
  PerpReduceOnlyEvaluation,
  PerpScaleLadder,
  PerpScaleLeg,
  PerpSlippagePrice,
  PerpTriggerClassification,
  PerpTriggerClassificationResult,
  PerpTriggerRelation,
  PerpTwapExecutionTarget,
  ValidatedPerpOrder,
  ValidatePerpOrderInput,
} from './types.js'
import {
  type NormalizedRule,
  normalizeBuildPerpScaleLadderInput,
  normalizeCalculatePerpMaxOrderSizeInput,
  normalizeCalculatePerpSlippagePriceInput,
  normalizeCalculatePerpTwapExecutionTargetInput,
  normalizeClassifyPerpTriggerInput,
  normalizeDerivePerpTriggerPriceInput,
  normalizeEvaluatePerpReduceOnlyInput,
  normalizeValidatePerpOrderInput,
  reasonPath,
} from './validation.js'

export type {
  AvailableRule,
  BuildPerpScaleLadderInput,
  CalculatePerpMaxOrderSizeInput,
  CalculatePerpSlippagePriceInput,
  CalculatePerpTwapExecutionTargetInput,
  ClassifyPerpTriggerInput,
  DerivedPerpTriggerPrice,
  DerivePerpTriggerPriceInput,
  EvaluatePerpReduceOnlyInput,
  OpenPerpTriggerPosition,
  PerpMaxOrderSize,
  PerpOrderPriceBand,
  PerpOrderSide,
  PerpPositionSide,
  PerpReduceOnlyEffect,
  PerpReduceOnlyEvaluation,
  PerpScaleDistribution,
  PerpScaleLadder,
  PerpScaleLeg,
  PerpSlippagePrice,
  PerpTriggerClassification,
  PerpTriggerClassificationResult,
  PerpTriggerRelation,
  PerpTriggerTarget,
  PerpTwapExecutionTarget,
  ValidatedPerpOrder,
  ValidatePerpOrderInput,
} from './types.js'

const decimalZero = new Decimal40(0)
const decimalOne = new Decimal40(1)
const decimalTenThousand = new Decimal40(10000)

function fixed(decimal: DecimalValue): string {
  return decimal.isZero() ? '0' : decimal.toFixed()
}

function invalid<T>(formulaId: string, issue: MathIssue): MathResult<T> {
  return invalidInputResult(
    [issue],
    ordersTrace({
      formulaId,
      completion: {
        status: 'incomplete',
        reason: ordersReason(issue.code, issue.path as string),
      },
    }),
  )
}

function ok<T>(
  formulaId: string,
  data: T,
  normalizedInputs: JsonObject,
  intermediates: readonly TraceStep[] = [],
  rounding: readonly RoundingDecision[] = [],
  assumptions: readonly Assumption[] = [],
): MathResult<T> {
  return {
    value: { status: 'ok', data },
    trace: ordersTrace({
      formulaId,
      completion: { status: 'complete' },
      normalizedInputs,
      intermediates,
      rounding,
      assumptions,
    }),
  }
}

function traceReason(reason: MathReason): JsonObject {
  const output: Record<string, JsonValue> = { code: reason.code }
  if (reason.path !== undefined) output.path = reason.path
  if (reason.details !== undefined) output.details = reason.details
  if (reason.sourceRefs !== undefined) output.sourceRefs = reason.sourceRefs
  return output
}

function traceRule<T>(
  rule: NormalizedRule<T>,
  availableValue: (value: T) => JsonValue,
): JsonObject {
  return rule.kind === 'available'
    ? { kind: rule.kind, value: availableValue(rule.value) }
    : { kind: rule.kind, reason: traceReason(rule.reason) }
}

function priceRound(
  value: DecimalValue,
  szDecimals: number,
  rounding: 'down' | 'up',
): DecimalValue {
  return quantizeProtocolPrice(value, 6, szDecimals, rounding).value
}

function sizeRound(value: DecimalValue, szDecimals: number): DecimalValue {
  return quantizeProtocolSize(value, szDecimals)
}

function satisfied(ruleId: string): ConstraintCheck {
  return { status: 'satisfied', ruleId }
}

function violated(ruleId: string, code: string, actual: string, limit: string): ConstraintCheck {
  return {
    status: 'violated',
    ruleId,
    violation: {
      ruleId,
      code,
      actual,
      limit,
    },
  }
}

function unavailableCheck(
  ruleId: string,
  rule: Exclude<NormalizedRule<unknown>, { kind: 'available' }>,
): ConstraintCheck {
  if (rule.kind === 'not-applicable') {
    return { status: 'not-applicable', ruleId, reason: rule.reason }
  }
  const path = reasonPath(rule.reason)
  const check: ConstraintCheck = {
    status: 'not-evaluated',
    ruleId,
    reason: rule.reason,
  }
  return path === undefined ? check : { ...check, missing: [path] }
}

function closingSide(positionSide: 'long' | 'short'): PerpOrderSide {
  return positionSide === 'long' ? 'sell' : 'buy'
}

function reducibleSize(currentSignedSize: DecimalValue, side: PerpOrderSide): DecimalValue {
  if (currentSignedSize.gt(0) && side === 'sell') return currentSignedSize.abs()
  if (currentSignedSize.lt(0) && side === 'buy') return currentSignedSize.abs()
  return decimalZero
}

/**
 * Checks one perp order's objective protocol constraints: price/size already at protocol
 * precision, `notional = price * size` against an available minimum-notional rule, and price
 * within an available band. Returns `ok` with the checks even when some are violated or not
 * evaluated — blocking is caller policy; server margin, open interest, and final acceptance are
 * outside this result.
 *
 * @public
 */
export function validatePerpOrder(input: ValidatePerpOrderInput): MathResult<ValidatedPerpOrder> {
  const normalized = normalizeValidatePerpOrderInput(input)
  const formulaId = 'hl.orders.perp.validate'
  if (!normalized.ok) return invalid(formulaId, normalized.issue)

  const value = normalized.value
  const roundedPrice = priceRound(value.priceDecimal, value.szDecimals, 'down')
  const roundedSize = sizeRound(value.sizeDecimal, value.szDecimals)
  const notional = value.priceDecimal.mul(value.sizeDecimal)
  const checks: ConstraintCheck[] = [
    roundedPrice.eq(value.priceDecimal)
      ? satisfied('hl.orders.perp.price-precision')
      : violated(
          'hl.orders.perp.price-precision',
          'price-precision-exceeded',
          value.price,
          fixed(roundedPrice),
        ),
    roundedSize.eq(value.sizeDecimal)
      ? satisfied('hl.orders.perp.size-precision')
      : violated(
          'hl.orders.perp.size-precision',
          'size-precision-exceeded',
          value.size,
          fixed(roundedSize),
        ),
  ]

  if (value.minimumNotional.kind === 'available') {
    checks.push(
      notional.gte(value.minimumNotional.value.decimal)
        ? satisfied('hl.orders.perp.minimum-notional')
        : violated(
            'hl.orders.perp.minimum-notional',
            'below-minimum-notional',
            fixed(notional),
            value.minimumNotional.value.value,
          ),
    )
  } else {
    checks.push(unavailableCheck('hl.orders.perp.minimum-notional', value.minimumNotional))
  }

  if (value.priceBand.kind === 'available') {
    checks.push(
      value.priceDecimal.gte(value.priceBand.value.lowerBoundDecimal) &&
        value.priceDecimal.lte(value.priceBand.value.upperBoundDecimal)
        ? satisfied('hl.orders.perp.price-band')
        : violated(
            'hl.orders.perp.price-band',
            'outside-price-band',
            value.price,
            `${value.priceBand.value.lowerBound}..${value.priceBand.value.upperBound}`,
          ),
    )
  } else {
    checks.push(unavailableCheck('hl.orders.perp.price-band', value.priceBand))
  }

  return ok(
    formulaId,
    { notional: fixed(notional), checks },
    {
      price: value.price,
      size: value.size,
      szDecimals: value.szDecimals,
      minimumNotional: traceRule(value.minimumNotional, (minimum) => minimum.value),
      priceBand: traceRule(value.priceBand, (band) => ({
        lowerBound: band.lowerBound,
        upperBound: band.upperBound,
      })),
    },
    [],
    [],
    validationAssumptions,
  )
}

/**
 * Computes a deterministic local upper bound on order size: opening capacity
 * `availableCollateral * leverage / referencePrice`, plus the reducible quantity when the side
 * opposes the position (reduce-only uses the reducible quantity alone), capped by an available
 * `orderValueLimit / referencePrice`, then quantized down to `szDecimals`.
 * A local bound only — margin tiers, open interest, resting orders, and liquidity remain
 * server-authoritative.
 *
 * @public
 */
export function calculatePerpMaxOrderSize(
  input: CalculatePerpMaxOrderSizeInput,
): MathResult<PerpMaxOrderSize> {
  const normalized = normalizeCalculatePerpMaxOrderSizeInput(input)
  const formulaId = 'hl.orders.perp.max-size.calculate'
  if (!normalized.ok) return invalid(formulaId, normalized.issue)

  const value = normalized.value
  const openingCapacity = value.availableCollateralDecimal
    .mul(value.leverageDecimal)
    .div(value.referencePriceDecimal)
  const reducible = reducibleSize(value.currentSignedSizeDecimal, value.side)
  const collateralBound = value.reduceOnly ? reducible : reducible.plus(openingCapacity)
  const checks: ConstraintCheck[] = []
  let orderValueBound: DecimalValue | null = null
  if (value.orderValueLimit.kind === 'available') {
    orderValueBound = value.orderValueLimit.value.decimal.div(value.referencePriceDecimal)
    checks.push(satisfied('hl.orders.perp.order-value-limit-available'))
  } else {
    checks.push(
      unavailableCheck('hl.orders.perp.order-value-limit-available', value.orderValueLimit),
    )
  }
  const rawUpperBound =
    orderValueBound === null ? collateralBound : Decimal40.min(collateralBound, orderValueBound)
  const localUpperBound = sizeRound(rawUpperBound, value.szDecimals)

  return ok(
    formulaId,
    {
      openingCapacitySize: fixed(openingCapacity),
      reducibleSize: fixed(reducible),
      collateralBoundSize: fixed(collateralBound),
      orderValueBoundSize: orderValueBound === null ? null : fixed(orderValueBound),
      localUpperBoundSize: fixed(localUpperBound),
      checks,
    },
    {
      availableCollateral: value.availableCollateral,
      leverage: value.leverage,
      referencePrice: value.referencePrice,
      currentSignedSize: value.currentSignedSize,
      side: value.side,
      reduceOnly: value.reduceOnly,
      szDecimals: value.szDecimals,
      orderValueLimit: traceRule(value.orderValueLimit, (limit) => limit.value),
    },
    [],
    [],
    maxSizeAssumptions,
  )
}

/**
 * Classifies a reduce-only request against the current position as `reduce`, `close`,
 * `would-flip`, or `would-increase` (long reduces only by sell, short only by buy; flat is never
 * reducible). Oversized requests are reported as `would-flip` with a violated check — the request
 * is never silently clamped.
 *
 * @public
 */
export function evaluatePerpReduceOnly(
  input: EvaluatePerpReduceOnlyInput,
): MathResult<PerpReduceOnlyEvaluation> {
  const normalized = normalizeEvaluatePerpReduceOnlyInput(input)
  const formulaId = 'hl.orders.perp.reduce-only.evaluate'
  if (!normalized.ok) return invalid(formulaId, normalized.issue)

  const value = normalized.value
  const reducible = reducibleSize(value.currentSignedSizeDecimal, value.side)
  let requestedEffect: PerpReduceOnlyEvaluation['requestedEffect'] = 'would-increase'
  if (reducible.gt(0)) {
    if (value.requestedSizeDecimal.lt(reducible)) requestedEffect = 'reduce'
    else if (value.requestedSizeDecimal.eq(reducible)) requestedEffect = 'close'
    else requestedEffect = 'would-flip'
  }
  const acceptedTransitionSize =
    requestedEffect === 'reduce' || requestedEffect === 'close' ? value.requestedSize : null
  const check =
    acceptedTransitionSize === null
      ? violated(
          'hl.orders.perp.reduce-only',
          requestedEffect,
          value.requestedSize,
          fixed(reducible),
        )
      : satisfied('hl.orders.perp.reduce-only')

  return ok(
    formulaId,
    {
      requestedEffect,
      reducibleSize: fixed(reducible),
      acceptedTransitionSize,
      check,
    },
    {
      currentSignedSize: value.currentSignedSize,
      side: value.side,
      requestedSize: value.requestedSize,
    },
    [],
    [],
    reduceOnlyAssumptions,
  )
}

/**
 * Computes a slippage protection price `referencePrice * (1 +/- slippageBps / 10000)` (plus for
 * buys, minus for sells), then quantizes it conservatively under the perp price rule: buys down,
 * sells up. A boundary that would collapse to zero is `invalid-input` — zero is never emitted as
 * an order price.
 *
 * @public
 */
export function calculatePerpSlippagePrice(
  input: CalculatePerpSlippagePriceInput,
): MathResult<PerpSlippagePrice> {
  const normalized = normalizeCalculatePerpSlippagePriceInput(input)
  const formulaId = 'hl.orders.perp.slippage-price.calculate'
  if (!normalized.ok) return invalid(formulaId, normalized.issue)

  const value = normalized.value
  const offset = value.slippageBpsDecimal.div(decimalTenThousand)
  const factor = value.side === 'buy' ? decimalOne.plus(offset) : decimalOne.minus(offset)
  const rawPrice = value.referencePriceDecimal.mul(factor)
  if (!rawPrice.gt(0)) {
    return invalid(formulaId, {
      code: 'non-positive-sell-boundary',
      path: '/slippageBps',
      actual: fixed(rawPrice),
      expected: 'positive protection price',
    })
  }
  const rounding = value.side === 'buy' ? 'down' : 'up'
  const protectionPrice = priceRound(rawPrice, value.szDecimals, rounding)
  if (!protectionPrice.gt(0)) {
    return invalid(formulaId, {
      code: 'rounded-to-zero',
      path: '/referencePrice',
      actual: fixed(rawPrice),
      expected: 'positive protocol price',
    })
  }
  const crossesReference =
    value.side === 'buy'
      ? protectionPrice.lt(value.referencePriceDecimal)
      : protectionPrice.gt(value.referencePriceDecimal)
  if (crossesReference) {
    return invalid(formulaId, {
      code: 'no-valid-protection-price',
      path: '/referencePrice',
      actual: fixed(protectionPrice),
      expected:
        value.side === 'buy'
          ? 'valid protocol price at or above reference price'
          : 'valid protocol price at or below reference price',
    })
  }
  return ok(
    formulaId,
    {
      rawPrice: fixed(rawPrice),
      protectionPrice: fixed(protectionPrice),
      rounding,
    },
    {
      side: value.side,
      referencePrice: value.referencePrice,
      slippageBps: value.slippageBps,
      szDecimals: value.szDecimals,
    },
    [],
    protectionPrice.eq(rawPrice)
      ? []
      : [
          {
            path: '/value/data/protectionPrice',
            input: fixed(rawPrice),
            output: fixed(protectionPrice),
            mode: rounding,
            reasonCode: 'perp-price-precision',
          },
        ],
    slippageAssumptions,
  )
}

/**
 * Classifies a trigger price relative to mark as take-profit or stop-loss for the position side
 * (long: above mark = TP, below = SL; short: inverted) and reports the expected closing side
 * (sell for long, buy for short). Equality is `at-mark` and violates the trigger-direction check;
 * a non-closing order side violates the closing-side check — both are facts on an `ok` result.
 *
 * @public
 */
export function classifyPerpTrigger(
  input: ClassifyPerpTriggerInput,
): MathResult<PerpTriggerClassificationResult> {
  const normalized = normalizeClassifyPerpTriggerInput(input)
  const formulaId = 'hl.orders.perp.trigger.classify'
  if (!normalized.ok) return invalid(formulaId, normalized.issue)

  const value = normalized.value
  const expectedClosingSide = closingSide(value.positionSide)
  const relation: PerpTriggerRelation = value.triggerPriceDecimal.eq(value.markPriceDecimal)
    ? 'at-mark'
    : value.triggerPriceDecimal.gt(value.markPriceDecimal)
      ? 'above-mark'
      : 'below-mark'
  let classification: PerpTriggerClassification = 'at-mark'
  if (relation !== 'at-mark') {
    classification =
      (value.positionSide === 'long' && relation === 'above-mark') ||
      (value.positionSide === 'short' && relation === 'below-mark')
        ? 'take-profit'
        : 'stop-loss'
  }
  const checks: ConstraintCheck[] = [
    value.orderSide === expectedClosingSide
      ? satisfied('hl.orders.perp.trigger-closing-side')
      : violated(
          'hl.orders.perp.trigger-closing-side',
          'non-closing-order-side',
          value.orderSide,
          expectedClosingSide,
        ),
    relation === 'at-mark'
      ? violated(
          'hl.orders.perp.trigger-direction',
          'trigger-at-mark',
          value.triggerPrice,
          value.markPrice,
        )
      : satisfied('hl.orders.perp.trigger-direction'),
  ]
  return ok(
    formulaId,
    { relation, classification, expectedClosingSide, checks },
    {
      positionSide: value.positionSide,
      orderSide: value.orderSide,
      markPrice: value.markPrice,
      triggerPrice: value.triggerPrice,
    },
    [],
    [],
    triggerClassificationAssumptions,
  )
}

/**
 * Derives the trigger price hitting a PnL or ROE target:
 * `triggerPrice = entryPrice + (targetNetPnl + cumulativeCost) / signedSize`, where an ROE
 * target's net PnL is `ratio * abs(size) * entryPrice / leverage`. The output is not
 * protocol-quantized; a non-positive derived price returns `indeterminate`.
 *
 * @public
 */
export function derivePerpTriggerPrice(
  input: DerivePerpTriggerPriceInput,
): MathResult<DerivedPerpTriggerPrice> {
  const normalized = normalizeDerivePerpTriggerPriceInput(input)
  const formulaId = 'hl.orders.perp.trigger-price.derive'
  if (!normalized.ok) return invalid(formulaId, normalized.issue)

  const value = normalized.value
  let initialMarginBasis: DecimalValue | null = null
  const targetNetPnl =
    value.target.kind === 'pnl'
      ? value.target.amountDecimal
      : (() => {
          initialMarginBasis = value.position.signedSizeDecimal
            .abs()
            .mul(value.position.entryPriceDecimal)
            .div(value.target.leverageDecimal)
          return value.target.ratioDecimal.mul(initialMarginBasis)
        })()
  const targetGrossPnl = targetNetPnl.plus(value.cumulativeCostDecimal)
  const triggerPrice = value.position.entryPriceDecimal.plus(
    targetGrossPnl.div(value.position.signedSizeDecimal),
  )
  if (!triggerPrice.gt(0)) {
    const reasonValue = ordersReason('no-positive-trigger-price-under-assumptions', '/target')
    return {
      value: { status: 'indeterminate', reason: reasonValue },
      trace: ordersTrace({
        formulaId,
        completion: { status: 'incomplete', reason: reasonValue },
        normalizedInputs: {
          position: {
            kind: 'open',
            signedSize: value.position.signedSize,
            entryPrice: value.position.entryPrice,
          },
          target:
            value.target.kind === 'pnl'
              ? { kind: value.target.kind, amount: value.target.amount }
              : {
                  kind: value.target.kind,
                  ratio: value.target.ratio,
                  leverage: value.target.leverage,
                },
          cumulativeCost: value.cumulativeCost,
        },
      }),
    }
  }
  return ok(
    formulaId,
    {
      targetNetPnl: fixed(targetNetPnl),
      cumulativeCost: value.cumulativeCost,
      targetGrossPnl: fixed(targetGrossPnl),
      initialMarginBasis: initialMarginBasis === null ? null : fixed(initialMarginBasis),
      triggerPrice: fixed(triggerPrice),
    },
    {
      position: {
        kind: 'open',
        signedSize: value.position.signedSize,
        entryPrice: value.position.entryPrice,
      },
      target:
        value.target.kind === 'pnl'
          ? { kind: value.target.kind, amount: value.target.amount }
          : {
              kind: value.target.kind,
              ratio: value.target.ratio,
              leverage: value.target.leverage,
            },
      cumulativeCost: value.cumulativeCost,
    },
    [],
    [],
    triggerDerivationAssumptions,
  )
}

/**
 * Builds a deterministic scale-order ladder of 2-100 limit legs across `[lowerPrice, upperPrice]`
 * with linear or geometric raw prices, quantized conservatively (buys down, sells up; levels must
 * stay strictly increasing). The first `n-1` legs get `floor(totalSize / n)` at `szDecimals` and
 * the last leg the exact remainder, so allocated size equals total size. This is the local ladder
 * contract, ascending by price — not a hidden server split algorithm or a fill forecast.
 *
 * @public
 */
export function buildPerpScaleLadder(
  input: BuildPerpScaleLadderInput,
): MathResult<PerpScaleLadder> {
  const normalized = normalizeBuildPerpScaleLadderInput(input)
  const formulaId = 'hl.orders.perp.scale.build'
  if (!normalized.ok) return invalid(formulaId, normalized.issue)

  const value = normalized.value
  const legs: PerpScaleLeg[] = []
  const rounding = value.side === 'buy' ? 'down' : 'up'
  const intervalCount = value.legCount - 1
  let previousPrice: DecimalValue | undefined
  const baseSize = sizeRound(value.totalSizeDecimal.div(value.legCount), value.szDecimals)
  if (!baseSize.gt(0)) {
    return invalid(formulaId, {
      code: 'zero-scale-leg-size',
      path: '/totalSize',
      actual: fixed(baseSize),
      expected: 'positive size for every leg',
    })
  }

  for (let index = 0; index < value.legCount; index += 1) {
    const ratio = new Decimal40(index).div(intervalCount)
    const rawPrice =
      value.distribution === 'linear'
        ? value.lowerPriceDecimal.plus(
            value.upperPriceDecimal.minus(value.lowerPriceDecimal).mul(ratio),
          )
        : value.lowerPriceDecimal.mul(
            value.upperPriceDecimal.div(value.lowerPriceDecimal).pow(ratio),
          )
    const price = priceRound(rawPrice, value.szDecimals, rounding)
    if (!price.gt(0)) {
      return invalid(formulaId, {
        code: 'rounded-to-zero',
        path: '/lowerPrice',
        actual: fixed(rawPrice),
        expected: 'positive protocol price',
      })
    }
    if (previousPrice !== undefined && !price.gt(previousPrice)) {
      return invalid(formulaId, {
        code: 'precision-collapsed-price-levels',
        path: '/lowerPrice',
        actual: fixed(price),
        expected: 'strictly increasing quantized prices',
      })
    }
    previousPrice = price
    const allocatedBeforeLast = baseSize.mul(value.legCount - 1)
    const size =
      index === value.legCount - 1 ? value.totalSizeDecimal.minus(allocatedBeforeLast) : baseSize
    legs.push({ index, rawPrice: fixed(rawPrice), price: fixed(price), size: fixed(size) })
  }

  const totalAllocatedSize = legs.reduce((total, leg) => total.plus(leg.size), decimalZero)
  return ok(
    formulaId,
    { totalAllocatedSize: fixed(totalAllocatedSize), legs },
    {
      side: value.side,
      lowerPrice: value.lowerPrice,
      upperPrice: value.upperPrice,
      totalSize: value.totalSize,
      legCount: value.legCount,
      distribution: value.distribution,
      szDecimals: value.szDecimals,
    },
    [],
    [],
    scaleAssumptions,
  )
}

/**
 * Computes the continuous TWAP execution target `totalSize * elapsedMs / durationMs` at one
 * caller-selected elapsed time. It does not model or infer the server's child count, interval,
 * rounding, randomization, catch-up decisions, scheduling, or fills.
 *
 * @public
 */
export function calculatePerpTwapExecutionTarget(
  input: CalculatePerpTwapExecutionTargetInput,
): MathResult<PerpTwapExecutionTarget> {
  const normalized = normalizeCalculatePerpTwapExecutionTargetInput(input)
  const formulaId = 'hl.orders.perp.twap-execution-target.calculate'
  if (!normalized.ok) return invalid(formulaId, normalized.issue)

  const value = normalized.value
  const cumulativeTargetSize = value.totalSizeDecimal.mul(value.elapsedMs).div(value.durationMs)
  return ok(
    formulaId,
    { cumulativeTargetSize: fixed(cumulativeTargetSize) },
    {
      totalSize: value.totalSize,
      durationMs: value.durationMs,
      elapsedMs: value.elapsedMs,
    },
    [
      {
        stepId: 'execution-target',
        inputs: {
          totalSize: value.totalSize,
          durationMs: value.durationMs,
          elapsedMs: value.elapsedMs,
        },
        output: fixed(cumulativeTargetSize),
      },
    ],
    [
      {
        path: '/value/data/cumulativeTargetSize',
        input: `${value.totalSize}*${value.elapsedMs}/${value.durationMs}`,
        output: fixed(cumulativeTargetSize),
        mode: 'half-even',
        reasonCode: 'decimal40-division',
      },
    ],
    twapAssumptions,
  )
}
