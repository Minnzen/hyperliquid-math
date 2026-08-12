import type { Decimal40 } from '../core/decimal.js'
import type { ConstraintCheck } from '../model/index.js'

export type DecimalValue = InstanceType<typeof Decimal40>

/**
 * Officially documented account-abstraction states. No info-API field returns this enum — the
 * caller derives the account's mode from the official docs and asserts it as an explicit fact.
 *
 * @public
 */
export type Hip3AccountAbstractionMode =
  | 'standard'
  | 'unified'
  | 'portfolio'
  | 'dex-abstraction-deprecated'

/** @public */
export interface ResolveHip3CollateralSourceInput {
  readonly accountAbstractionMode: Hip3AccountAbstractionMode
  /** Non-empty official builder-dex name from `perpDexs`; HIP-3 deployments always have one (`null` invalid here). */
  readonly dex: string
  /** The DEX's collateral token index in the same dated metadata snapshot, non-negative integer. */
  readonly collateralTokenIndex: number
  /** USDC's token index in that same snapshot; USDC is never identified from a display symbol. */
  readonly validatorPerpUsdcTokenIndex: number
}

/** @public */
export type Hip3CollateralSourceRoute =
  | {
      readonly kind: 'per-dex-balance'
      readonly dex: string
      readonly collateralTokenIndex: number
    }
  | { readonly kind: 'unified-spot-balance'; readonly collateralTokenIndex: number }
  | { readonly kind: 'portfolio-margin'; readonly collateralTokenIndex: number }
  | { readonly kind: 'validator-perp-usdc-balance' }
  | { readonly kind: 'spot-balance'; readonly collateralTokenIndex: number }

/** @public */
export interface Hip3CollateralSource {
  readonly route: Hip3CollateralSourceRoute
  readonly checks: readonly ConstraintCheck[]
}

export interface NormalizedResolveHip3CollateralSourceInput
  extends ResolveHip3CollateralSourceInput {}

/**
 * Official `universe[].marginMode`: `normal` may allow cross and isolated; `noCross` is
 * isolated-only with removal allowed; `strictIsolated` is isolated-only with removal blocked.
 *
 * @public
 */
export type Hip3AssetMarginMode = 'normal' | 'noCross' | 'strictIsolated'

/** @public */
export type Hip3RequestedMarginMode = 'cross' | 'isolated'

/** @public */
export interface EvaluateHip3MarginModeInput {
  readonly assetMarginMode: Hip3AssetMarginMode
  readonly requestedMode: Hip3RequestedMarginMode
}

/** @public */
export interface Hip3MarginModeEvaluation {
  readonly supportedLocally: boolean
  /** The mode that would apply locally; `null` when the request is unsupported. */
  readonly effectiveMarginMode: Hip3RequestedMarginMode | null
  /** Feeds the M3 margin/liquidation `marginRemoval` field: `strictIsolated` isolated = `strict`, `noCross`/`normal` isolated = `allowed`. */
  readonly marginRemoval: 'allowed' | 'strict' | 'not-applicable'
  readonly checks: readonly ConstraintCheck[]
}

export interface NormalizedEvaluateHip3MarginModeInput extends EvaluateHip3MarginModeInput {}

/** @public */
export interface CalculateHip3FeeRatesInput {
  /** Base maker rate from frozen `userFees` evidence (official `add`), signed decimal fraction; negative = rebate. */
  readonly makerRate: string
  /** Base taker rate from frozen `userFees` evidence (official `cross`), signed decimal fraction. */
  readonly takerRate: string
  /** Referral discount as a decimal fraction in `[0, 1]`, explicit `userFees` evidence. */
  readonly activeReferralDiscount: string
  /** Whether the DEX quote token is aligned; explicit caller evidence, never inferred. */
  readonly isAlignedQuoteToken: boolean
  /** Deployer fee scale in `[0, 3]`, or `[0, 10)` in growth mode; growth values above 1 are source-conflicted. */
  readonly deployerFeeScale: string
  /** Growth mode applies a 0.1 multiplier to base rates before scaling. */
  readonly growthMode: boolean
}

/** @public */
export interface Hip3EffectiveFeeRates {
  /** Effective maker rate, directly usable as `rate` in `calculateTradeFee`. */
  readonly effectiveMakerRate: string
  /** Effective taker rate, directly usable as `rate` in `calculateTradeFee`. */
  readonly effectiveTakerRate: string
  /** `scale < 1 ? scale + 1 : scale * 2` (so `deployerFeeScale = 1` uses the doubling branch). */
  readonly hip3Scale: string
  /** `scale < 1 ? scale / (1 + scale) : 0.5`. */
  readonly deployerShare: string
  /** `0.1` in growth mode, otherwise `1`. */
  readonly growthMultiplier: string
  readonly alignedMakerScale: string
  readonly alignedTakerScale: string
  readonly checks: readonly ConstraintCheck[]
}

export interface NormalizedCalculateHip3FeeRatesInput {
  readonly makerRate: string
  readonly makerRateDecimal: DecimalValue
  readonly takerRate: string
  readonly takerRateDecimal: DecimalValue
  readonly activeReferralDiscount: string
  readonly activeReferralDiscountDecimal: DecimalValue
  readonly isAlignedQuoteToken: boolean
  readonly deployerFeeScale: string
  readonly deployerFeeScaleDecimal: DecimalValue
  readonly growthMode: boolean
}
