import type { Decimal40 } from '../core/decimal.js'

export type DecimalValue = InstanceType<typeof Decimal40>

/** @public */
export interface FundingPremiumIndexInput {
  /** Average execution price for the impact notional on the bid side (official `impactPxs[0]`). */
  readonly impactBidPrice: string
  /** Average execution price for the impact notional on the ask side (official `impactPxs[1]`). */
  readonly impactAskPrice: string
  /** Official `assetCtx.oraclePx` — the validator oracle price, not the mark. */
  readonly oraclePrice: string
}

/** @public */
export interface FundingPremiumIndex {
  readonly bidPremium: string
  readonly askDiscount: string
  readonly impactPriceDifference: string
  readonly premiumIndex: string
}

/**
 * Versioned funding-rate rules; nothing is hardcoded. Documented standard-perp values:
 * `interestRate: "0.0001"`, `clampLower: "-0.0005"`, `clampUpper: "0.0005"`,
 * `baseIntervalHours: 8`, `hourlyCap: "0.04"` — all decimal fractions, never percent or bps.
 *
 * @public
 */
export interface FundingRateRules {
  /** Base-interval interest rate as a decimal fraction (`0.0001` = 0.01% per interval). */
  readonly interestRate: string
  /** Lower clamp on `interestRate - premium`, `<= 0`, decimal fraction. */
  readonly clampLower: string
  /** Upper clamp on `interestRate - premium`, `>= 0`, decimal fraction. */
  readonly clampUpper: string
  /** Hours in the base rate interval (official default 8), positive integer `<= 24`. */
  readonly baseIntervalHours: number
  /** Non-negative cap on the absolute hourly rate (`0.04` = 4%/hour). */
  readonly hourlyCap: string
}

/** @public */
export interface FundingRateInput {
  /** Average premium index over the base interval, in the same base-interval convention as `rules`. */
  readonly averagePremiumIndex: string
  readonly rules: FundingRateRules
}

/** @public */
export interface FundingRate {
  readonly averagePremiumIndex: string
  readonly interestRate: string
  readonly clampedDifference: string
  readonly baseIntervalRate: string
  readonly uncappedHourlyRate: string
  readonly hourlyRate: string
  readonly hourlyCap: string
  readonly capped: boolean
}

/** @public */
export interface FundingPaymentInput {
  /** Official `position.szi` unchanged: positive = long, negative = short. */
  readonly signedPositionSize: string
  /** Official `oraclePx` — funding settles on oracle, not mark, price. */
  readonly oraclePrice: string
  /** Rate for the actual settlement interval as a decimal fraction. `assetCtx.funding` (already hourly) passes directly — do not rescale. */
  readonly fundingRate: string
}

/** @public */
export interface FundingPayment {
  readonly signedPositionSize: string
  readonly oraclePrice: string
  readonly fundingRate: string
  readonly notional: string
  /** `signedPositionSize * oraclePrice * fundingRate`; positive = position pays funding. */
  readonly payment: string
  /** `-payment`. */
  readonly accountValueDelta: string
}

/** @public */
export type FundingAnnualizationConvention = 'simple' | 'compound'

/** @public */
export interface AnnualizeFundingRateInput {
  /** Periodic decimal fraction; compound fixed-point output is limited to 4096 integer digits. */
  readonly periodicRate: string
  /** Settlement periods per year (hourly funding: 8760), positive integer `<= 100000`. */
  readonly periodsPerYear: number
  /** Analytical assumption only — `compound` does not claim funding receipts are reinvested. */
  readonly convention: FundingAnnualizationConvention
}

/** @public */
export interface AnnualizedFundingRate {
  readonly periodicRate: string
  readonly periodsPerYear: number
  readonly convention: FundingAnnualizationConvention
  readonly annualizedRate: string
}

export interface NormalizedFundingPremiumIndexInput {
  readonly impactBidPrice: string
  readonly impactBidPriceDecimal: DecimalValue
  readonly impactAskPrice: string
  readonly impactAskPriceDecimal: DecimalValue
  readonly oraclePrice: string
  readonly oraclePriceDecimal: DecimalValue
}

export interface NormalizedFundingRateRules {
  readonly interestRate: string
  readonly interestRateDecimal: DecimalValue
  readonly clampLower: string
  readonly clampLowerDecimal: DecimalValue
  readonly clampUpper: string
  readonly clampUpperDecimal: DecimalValue
  readonly baseIntervalHours: number
  readonly hourlyCap: string
  readonly hourlyCapDecimal: DecimalValue
}

export interface NormalizedFundingRateInput {
  readonly averagePremiumIndex: string
  readonly averagePremiumIndexDecimal: DecimalValue
  readonly rules: NormalizedFundingRateRules
}

export interface NormalizedFundingPaymentInput {
  readonly signedPositionSize: string
  readonly signedPositionSizeDecimal: DecimalValue
  readonly oraclePrice: string
  readonly oraclePriceDecimal: DecimalValue
  readonly fundingRate: string
  readonly fundingRateDecimal: DecimalValue
}

export interface NormalizedAnnualizeFundingRateInput {
  readonly periodicRate: string
  readonly periodicRateDecimal: DecimalValue
  readonly periodsPerYear: number
  readonly convention: FundingAnnualizationConvention
}
