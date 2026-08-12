import type { Decimal40 } from '../core/decimal.js'
import type { ConstraintCheck, MathReason } from '../model/index.js'

export type DecimalValue = InstanceType<typeof Decimal40>

/** @public */
export type PerpOrderSide = 'buy' | 'sell'

/**
 * Availability wrapper for a mutable protocol rule. `not-applicable` yields a not-applicable
 * check; `not-supported` yields a not-evaluated check with the supplied reason — a missing rule is
 * never silently treated as satisfied (or as infinity).
 *
 * @public
 */
export type AvailableRule<T> =
  | { readonly kind: 'available'; readonly value: T }
  | { readonly kind: 'not-applicable'; readonly reason: MathReason }
  | { readonly kind: 'not-supported'; readonly reason: MathReason }

/** @public */
export interface PerpOrderPriceBand {
  readonly lowerBound: string
  readonly upperBound: string
}

/** @public */
export interface ValidatePerpOrderInput {
  readonly price: string
  readonly size: string
  /** Official `meta.universe[].szDecimals`, safe integer 0-6 for perps. */
  readonly szDecimals: number
  readonly minimumNotional: AvailableRule<string>
  readonly priceBand: AvailableRule<PerpOrderPriceBand>
}

/** @public */
export interface ValidatedPerpOrder {
  /** `price * size`. */
  readonly notional: string
  /** Objective facts; may contain violated or not-evaluated checks even on `ok` — blocking is caller policy. */
  readonly checks: readonly ConstraintCheck[]
}

/** @public */
export interface CalculatePerpMaxOrderSizeInput {
  /** Non-negative collateral the caller deems spendable for this order. */
  readonly availableCollateral: string
  /** User leverage setting (official `position.leverage.value` via `String()`), positive. */
  readonly leverage: string
  /** Caller-chosen price basis for converting collateral to size; never fetched or inferred. */
  readonly referencePrice: string
  /** Official `position.szi` unchanged: positive = long, negative = short, `0` when flat. */
  readonly currentSignedSize: string
  readonly side: PerpOrderSide
  readonly reduceOnly: boolean
  readonly szDecimals: number
  readonly orderValueLimit: AvailableRule<string>
}

/** @public */
export interface PerpMaxOrderSize {
  /** `availableCollateral * leverage / referencePrice`. */
  readonly openingCapacitySize: string
  /** `abs(currentSignedSize)` when the order side opposes the position, else `0`. */
  readonly reducibleSize: string
  readonly collateralBoundSize: string
  /** `orderValueLimit / referencePrice`; `null` when the limit rule is unavailable. */
  readonly orderValueBoundSize: string | null
  /** Minimum of all available local bounds, quantized down to `szDecimals` — not the server-accepted max. */
  readonly localUpperBoundSize: string
  readonly checks: readonly ConstraintCheck[]
}

/** @public */
export interface EvaluatePerpReduceOnlyInput {
  /** Official `position.szi` unchanged: positive = long, negative = short, `0` when flat. */
  readonly currentSignedSize: string
  readonly side: PerpOrderSide
  /** Positive unsigned requested order size. */
  readonly requestedSize: string
}

/** @public */
export type PerpReduceOnlyEffect = 'reduce' | 'close' | 'would-flip' | 'would-increase'

/** @public */
export interface PerpReduceOnlyEvaluation {
  readonly requestedEffect: PerpReduceOnlyEffect
  readonly reducibleSize: string
  readonly acceptedTransitionSize: string | null
  readonly check: ConstraintCheck
}

/** @public */
export interface CalculatePerpSlippagePriceInput {
  readonly side: PerpOrderSide
  /** Caller-chosen and caller-proven baseline (BBO/mid/mark/oracle are never fetched). */
  readonly referencePrice: string
  /** Non-negative tolerance in basis points as a decimal string (`"50"` = 0.50%). */
  readonly slippageBps: string
  readonly szDecimals: number
}

/** @public */
export interface PerpSlippagePrice {
  /** `reference * (1 +/- slippageBps / 10000)` before protocol quantization. */
  readonly rawPrice: string
  /** Protocol-quantized boundary, rounded conservatively: buys down, sells up. */
  readonly protectionPrice: string
  readonly rounding: 'down' | 'up'
}

/** @public */
export type PerpPositionSide = 'long' | 'short'

/** @public */
export interface ClassifyPerpTriggerInput {
  readonly positionSide: PerpPositionSide
  readonly orderSide: PerpOrderSide
  /** TP/SL triggers compare against mark price (official `markPx`), not last trade. */
  readonly markPrice: string
  readonly triggerPrice: string
}

/** @public */
export type PerpTriggerRelation = 'above-mark' | 'below-mark' | 'at-mark'

/** @public */
export type PerpTriggerClassification = 'take-profit' | 'stop-loss' | 'at-mark'

/** @public */
export interface PerpTriggerClassificationResult {
  readonly relation: PerpTriggerRelation
  readonly classification: PerpTriggerClassification
  readonly expectedClosingSide: PerpOrderSide
  readonly checks: readonly ConstraintCheck[]
}

/** @public */
export type OpenPerpTriggerPosition = {
  readonly kind: 'open'
  readonly signedSize: string
  readonly entryPrice: string
}

/**
 * Profit target: an absolute net PnL amount, or an ROE ratio (decimal fraction, `0.5` = 50%)
 * against the initial-margin basis `abs(size) * entryPrice / leverage`.
 *
 * @public
 */
export type PerpTriggerTarget =
  | { readonly kind: 'pnl'; readonly amount: string }
  | { readonly kind: 'roe'; readonly ratio: string; readonly leverage: string }

/** @public */
export interface DerivePerpTriggerPriceInput {
  readonly position: OpenPerpTriggerPosition
  readonly target: PerpTriggerTarget
  /** Non-negative fees/funding the target must additionally recover, chosen by the caller. */
  readonly cumulativeCost: string
}

/** @public */
export interface DerivedPerpTriggerPrice {
  readonly targetNetPnl: string
  readonly cumulativeCost: string
  readonly targetGrossPnl: string
  /** `abs(size) * entryPrice / leverage` for ROE targets; `null` for PnL targets. */
  readonly initialMarginBasis: string | null
  /** `entryPrice + targetGrossPnl / signedSize`; not protocol-quantized — validate or quantize before order use. */
  readonly triggerPrice: string
}

/** @public */
export type PerpScaleDistribution = 'linear' | 'geometric'

/** @public */
export interface BuildPerpScaleLadderInput {
  readonly side: PerpOrderSide
  /** Must be strictly below `upperPrice`. */
  readonly lowerPrice: string
  readonly upperPrice: string
  /** Must already be valid at `szDecimals`. */
  readonly totalSize: string
  /** Number of limit legs, safe integer 2-100. */
  readonly legCount: number
  readonly distribution: PerpScaleDistribution
  readonly szDecimals: number
}

/** @public */
export interface PerpScaleLeg {
  readonly index: number
  readonly rawPrice: string
  readonly price: string
  readonly size: string
}

/** @public */
export interface PerpScaleLadder {
  readonly totalAllocatedSize: string
  readonly legs: readonly PerpScaleLeg[]
}

/** @public */
export interface CalculatePerpTwapExecutionTargetInput {
  readonly totalSize: string
  /** Caller-provided TWAP duration in milliseconds; positive safe integer. */
  readonly durationMs: number
  /** Elapsed milliseconds in the inclusive range `[0, durationMs]`. */
  readonly elapsedMs: number
}

/** @public */
export interface PerpTwapExecutionTarget {
  /** `totalSize * elapsedMs / durationMs`. */
  readonly cumulativeTargetSize: string
}
