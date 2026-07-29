import type { Decimal40 } from '../core/decimal.js'

type DecimalValue = InstanceType<typeof Decimal40>

/** @public */
export interface CalculateOutcomeDualPriceInput {
  readonly price: string
}

/** @public */
export interface OutcomeDualPrice {
  readonly dualPrice: string
}

/** @public */
export type OutcomeTokenSide = 'yes' | 'no'

/** @public */
export interface CalculateOutcomeSettlementInput {
  readonly tokenSide: OutcomeTokenSide
  readonly settleFraction: string
  readonly size: string
  readonly entryPrice: string
}

/** @public */
export interface OutcomeSettlement {
  readonly payoutFraction: string
  readonly settlementValue: string
  readonly entryNotional: string
  readonly grossPnl: string
}

/** @public */
export interface EvaluatePriceBinaryOutcomeInput {
  readonly class: 'priceBinary'
  readonly markPrice0: string
  readonly t0: number
  readonly markPrice1: string
  readonly t1: number
  readonly settlementTime: number
  readonly targetPrice: string
}

/** @public */
export interface EvaluatePriceBucketOutcomeInput {
  readonly class: 'priceBucket'
  readonly markPrice0: string
  readonly t0: number
  readonly markPrice1: string
  readonly t1: number
  readonly settlementTime: number
  readonly priceThresholds: readonly [string, string]
}

/** @public */
export type EvaluateRecurringOutcomeInput =
  | EvaluatePriceBinaryOutcomeInput
  | EvaluatePriceBucketOutcomeInput

/** @public */
export interface EvaluatedPriceBinaryOutcome {
  readonly class: 'priceBinary'
  readonly interpolatedMarkPrice: string
  readonly settlesTo: OutcomeTokenSide
  readonly settleFraction: '0' | '1'
}

/** @public */
export interface EvaluatedPriceBucketOutcome {
  readonly class: 'priceBucket'
  readonly interpolatedMarkPrice: string
  readonly settledBucket: 0 | 1 | 2
  readonly settleFractions: readonly ['0' | '1', '0' | '1', '0' | '1']
}

/** @public */
export type EvaluatedRecurringOutcome = EvaluatedPriceBinaryOutcome | EvaluatedPriceBucketOutcome

export interface NormalizedCalculateOutcomeDualPriceInput {
  readonly price: string
  readonly priceDecimal: DecimalValue
}

export interface NormalizedCalculateOutcomeSettlementInput {
  readonly tokenSide: OutcomeTokenSide
  readonly settleFraction: string
  readonly settleFractionDecimal: DecimalValue
  readonly size: string
  readonly sizeDecimal: DecimalValue
  readonly entryPrice: string
  readonly entryPriceDecimal: DecimalValue
}

interface NormalizedRecurringOutcomeBase {
  readonly markPrice0: string
  readonly markPrice0Decimal: DecimalValue
  readonly t0: number
  readonly markPrice1: string
  readonly markPrice1Decimal: DecimalValue
  readonly t1: number
  readonly settlementTime: number
}

export interface NormalizedEvaluatePriceBinaryOutcomeInput extends NormalizedRecurringOutcomeBase {
  readonly class: 'priceBinary'
  readonly targetPrice: string
  readonly targetPriceDecimal: DecimalValue
}

export interface NormalizedEvaluatePriceBucketOutcomeInput extends NormalizedRecurringOutcomeBase {
  readonly class: 'priceBucket'
  readonly priceThresholds: readonly [string, string]
  readonly priceThresholdDecimals: readonly [DecimalValue, DecimalValue]
}

export type NormalizedEvaluateRecurringOutcomeInput =
  | NormalizedEvaluatePriceBinaryOutcomeInput
  | NormalizedEvaluatePriceBucketOutcomeInput
