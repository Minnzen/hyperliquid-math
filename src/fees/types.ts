import type { Decimal40 } from '../core/decimal.js'

export type DecimalValue = InstanceType<typeof Decimal40>

/** @public */
export interface CalculateTradeFeeInput {
  readonly price: string
  readonly size: string
  /** Signed decimal fraction (`0.00045` = 4.5 bps); positive = charge, negative = rebate. `userFees.userCrossRate`/`userAddRate` pass directly. */
  readonly rate: string
}

/** @public */
export interface TradeFee {
  /** `price * size`. */
  readonly notional: string
  /** `notional * rate`, signed user cost: positive = charge, negative = rebate. */
  readonly feeAmount: string
  /** `-feeAmount` — the fee's effect on account value. */
  readonly accountValueDelta: string
}

/** @public */
export interface CalculateWeightedFeeVolumeInput {
  readonly perpsVolume: string
  readonly spotVolume: string
}

/** @public */
export interface WeightedFeeVolume {
  readonly weightedVolume: string
}

/**
 * Maker/taker rate pair as signed decimal fractions (`0.00045` = 4.5 bps). Official
 * `feeSchedule` naming: `add` is the maker rate, `cross` is the taker rate.
 *
 * @public
 */
export interface FeeRates {
  readonly makerRate: string
  readonly takerRate: string
}

/** @public */
export interface FeeTier extends FeeRates {
  /** Activation threshold (official `tiers.vip[].ntlCutoff`); the tier activates only when weightedVolume is strictly greater. */
  readonly minimumWeightedVolume: string
}

/** @public */
export interface SelectFeeTierInput {
  /** Rolling-14-day weighted volume, e.g. from `calculateWeightedFeeVolume`. */
  readonly weightedVolume: string
  /** Official `feeSchedule.base` mapped as `{ makerRate: add, takerRate: cross }`. */
  readonly baseRates: FeeRates
  /** VIP tiers with strictly increasing thresholds; `mm[]` maker-fraction tiers are not expressible here. */
  readonly tiers: readonly FeeTier[]
}

/** @public */
export type FeeTierSelection =
  | { readonly kind: 'base' }
  | {
      readonly kind: 'volume'
      readonly index: number
      readonly minimumWeightedVolume: string
    }

/** @public */
export interface SelectedFeeTier extends FeeRates {
  readonly selection: FeeTierSelection
}

export interface NormalizedTradeFeeInput {
  readonly price: string
  readonly priceDecimal: DecimalValue
  readonly size: string
  readonly sizeDecimal: DecimalValue
  readonly rate: string
  readonly rateDecimal: DecimalValue
}

export interface NormalizedWeightedFeeVolumeInput {
  readonly perpsVolume: string
  readonly perpsVolumeDecimal: DecimalValue
  readonly spotVolume: string
  readonly spotVolumeDecimal: DecimalValue
}

export interface NormalizedFeeRates {
  readonly makerRate: string
  readonly makerRateDecimal: DecimalValue
  readonly takerRate: string
  readonly takerRateDecimal: DecimalValue
}

export interface NormalizedFeeTier extends NormalizedFeeRates {
  readonly minimumWeightedVolume: string
  readonly minimumWeightedVolumeDecimal: DecimalValue
}

export interface NormalizedSelectFeeTierInput {
  readonly weightedVolume: string
  readonly weightedVolumeDecimal: DecimalValue
  readonly baseRates: NormalizedFeeRates
  readonly tiers: readonly NormalizedFeeTier[]
}
