import type { CanonicalPerpAssetRef } from '../core/asset-ref.js'
import type { Decimal40, NormalizedDecimalString } from '../core/decimal.js'
import type { ConstraintCheck } from '../model/index.js'

type Decimal40Value = InstanceType<typeof Decimal40>

/**
 * One official margin tier. Kit joins `universe[].marginTableId` to `meta.marginTables` and maps
 * each entry as `{ lowerBound, maxLeverage: String(maxLeverage) }`, preserving order.
 *
 * @public
 */
export interface PerpMarginTier {
  /** Tier's notional lower bound (official `lowerBound`); intervals are half-open `[lowerBound, next)`. */
  readonly lowerBound: string
  /** Official `maxLeverage` (a JSON number) converted with `String()`; positive integer decimal string. */
  readonly maxLeverage: string
}

/** @public */
export type CanonicalAssetRef = CanonicalPerpAssetRef

/** @public */
export type PerpMarginMode =
  | { readonly kind: 'cross' }
  | {
      readonly kind: 'isolated'
      /** The isolated position's own account value at the supplied mark, unrealized PnL included; never drawn from `crossAccountValue`. */
      readonly isolatedMarginValue: string
      /** Official `universe[].marginMode === "strictIsolated"` maps to `strict`; every other perp is `allowed`. */
      readonly marginRemoval: 'allowed' | 'strict'
    }

/** @public */
export interface PerpMarginPosition {
  readonly asset: CanonicalAssetRef
  /** Official `position.szi` unchanged: positive = long, negative = short. */
  readonly signedSize: string
  readonly markPrice: string
  /** User's leverage setting — official `position.leverage.value` (a JSON number) via `String()`; distinct from tier `maxLeverage`. */
  readonly leverage: string
  readonly marginMode: PerpMarginMode
  /** Tiers from `meta.marginTables` joined via the market's `marginTableId`, in official order. */
  readonly marginTiers: readonly PerpMarginTier[]
}

/** @public */
export type PerpMarginModeOutput =
  | { readonly kind: 'cross' }
  | { readonly kind: 'isolated'; readonly marginRemoval: 'allowed' | 'strict' }

/** @public */
export interface CalculatePerpInitialMarginInput {
  readonly position: PerpMarginPosition
}

/** @public */
export interface PerpInitialMargin {
  readonly positionValue: string
  readonly initialMargin: string
  readonly transferMarginRequirement: string
  readonly tierIndex: number
  readonly maxLeverage: string
  readonly leverageCheck: ConstraintCheck
}

/** @public */
export interface CalculatePerpMaintenanceMarginInput {
  readonly position: PerpMarginPosition
}

/** @public */
export interface PerpMaintenanceMargin {
  readonly positionValue: string
  readonly tierIndex: number
  readonly tierLowerBound: string
  readonly nextTierLowerBound: string | null
  readonly maxLeverage: string
  readonly maintenanceRate: string
  readonly maintenanceDeduction: string
  readonly maintenanceMargin: string
  readonly backstopThreshold: string
}

/** @public */
export interface EvaluatePerpAccountMarginInput {
  /** Cross-only account value from `crossMarginSummary.accountValue` — not `marginSummary.accountValue`; excludes isolated margin/PnL. */
  readonly crossAccountValue: string
  /** All positions under the same frozen marks; duplicate canonical asset keys are rejected. */
  readonly positions: readonly PerpMarginPosition[]
}

/** @public */
export interface PerpAccountMarginPosition {
  readonly asset: CanonicalAssetRef
  readonly assetKey: string
  readonly marginMode: PerpMarginModeOutput
  readonly positionValue: string
  readonly initialMargin: string
  readonly transferMarginRequirement: string
  readonly maintenanceMargin: string
  readonly backstopThreshold: string
  readonly tierIndex: number
  readonly tierLowerBound: string
  readonly nextTierLowerBound: string | null
  readonly maxLeverage: string
  readonly leverageCheck: ConstraintCheck
  readonly maintenanceRate: string
  readonly maintenanceDeduction: string
  readonly marginValue?: string
  readonly maintenanceMarginAvailable?: string
  readonly initialMarginAvailable?: string
  readonly transferMarginAvailable?: string
  readonly maxRemovableMargin?: string
}

/** @public */
export interface PerpCrossAccountMargin {
  readonly accountValue: string
  readonly positionValue: string
  readonly initialMargin: string
  readonly transferMarginRequirement: string
  readonly maintenanceMargin: string
  readonly backstopThreshold: string
  readonly maintenanceMarginAvailable: string
  readonly initialMarginAvailable: string
  readonly transferMarginAvailable: string
  readonly maxRemovableMargin: string
}

/** @public */
export interface PerpAccountMarginTotals {
  readonly crossPositionValue: string
  readonly isolatedPositionValue: string
  readonly totalPositionValue: string
  readonly crossMaintenanceMargin: string
  readonly isolatedMaintenanceMargin: string
  readonly totalMaintenanceMargin: string
  readonly crossInitialMargin: string
  readonly isolatedInitialMargin: string
  readonly totalInitialMargin: string
}

/** @public */
export interface PerpAccountMargin {
  readonly cross: PerpCrossAccountMargin
  readonly positions: readonly PerpAccountMarginPosition[]
  readonly totals: PerpAccountMarginTotals
}

/** One normalized per-DEX contribution to the unified account ratio. @public */
export interface UnifiedAccountDexMargin {
  readonly dexIndex: number
  readonly collateralToken: number
  readonly crossMaintenanceMarginUsed: string
  readonly isolatedMarginUsed: string
}

/** One spot trading balance used as unified collateral. @public */
export interface UnifiedAccountSpotBalance {
  readonly token: number
  readonly total: string
}

/** @public */
export interface CalculateUnifiedAccountRatioInput {
  readonly dexes: readonly UnifiedAccountDexMargin[]
  readonly spotBalances: readonly UnifiedAccountSpotBalance[]
}

/** @public */
export interface UnifiedAccountTokenRatio {
  readonly collateralToken: number
  readonly spotTotal: string
  readonly crossMaintenanceMarginUsed: string
  readonly isolatedMarginUsed: string
  readonly available: string
  readonly ratio: string
}

/** @public */
export interface UnifiedAccountRatio {
  readonly tokens: readonly UnifiedAccountTokenRatio[]
  readonly accountRatio: string
}

export interface NormalizedPerpMarginTier {
  readonly lowerBound: NormalizedDecimalString
  readonly lowerBoundDecimal: Decimal40Value
  readonly maxLeverage: NormalizedDecimalString
  readonly maxLeverageDecimal: Decimal40Value
  readonly maintenanceRate: NormalizedDecimalString
  readonly maintenanceRateDecimal: Decimal40Value
  readonly maintenanceDeduction: NormalizedDecimalString
  readonly maintenanceDeductionDecimal: Decimal40Value
}

export interface SelectedPerpMarginTier extends NormalizedPerpMarginTier {
  readonly tierIndex: number
  readonly nextTierLowerBound: NormalizedDecimalString | null
  readonly nextTierLowerBoundDecimal: Decimal40Value | null
}

export interface NormalizedPerpMarginPosition {
  readonly asset: CanonicalAssetRef
  readonly assetKey: string
  readonly signedSize: NormalizedDecimalString
  readonly signedSizeDecimal: Decimal40Value
  readonly absoluteSizeDecimal: Decimal40Value
  readonly markPrice: NormalizedDecimalString
  readonly markPriceDecimal: Decimal40Value
  readonly leverage: {
    readonly value: NormalizedDecimalString
    readonly valueDecimal: Decimal40Value
  }
  readonly marginMode:
    | { readonly kind: 'cross' }
    | {
        readonly kind: 'isolated'
        readonly isolatedMarginValue: NormalizedDecimalString
        readonly isolatedMarginValueDecimal: Decimal40Value
        readonly marginRemoval: 'allowed' | 'strict'
      }
  readonly marginTiers: readonly NormalizedPerpMarginTier[]
}

export interface NormalizedEvaluatePerpAccountMarginInput {
  readonly crossAccountValue: NormalizedDecimalString
  readonly crossAccountValueDecimal: Decimal40Value
  readonly positions: readonly NormalizedPerpMarginPosition[]
}

export interface NormalizedUnifiedAccountDexMargin {
  readonly dexIndex: number
  readonly collateralToken: number
  readonly crossMaintenanceMarginUsed: NormalizedDecimalString
  readonly crossMaintenanceMarginUsedDecimal: Decimal40Value
  readonly isolatedMarginUsed: NormalizedDecimalString
  readonly isolatedMarginUsedDecimal: Decimal40Value
}

export interface NormalizedUnifiedAccountSpotBalance {
  readonly inputIndex: number
  readonly token: number
  readonly total: NormalizedDecimalString
  readonly totalDecimal: Decimal40Value
}

export interface NormalizedCalculateUnifiedAccountRatioInput {
  readonly dexes: readonly NormalizedUnifiedAccountDexMargin[]
  readonly spotBalances: readonly NormalizedUnifiedAccountSpotBalance[]
}

export interface InitialMarginComputation {
  readonly selectedTier: SelectedPerpMarginTier
  readonly positionValueDecimal: Decimal40Value
  readonly initialMarginDecimal: Decimal40Value
  readonly transferMarginRequirementDecimal: Decimal40Value
  readonly data: PerpInitialMargin
}

export interface MaintenanceMarginComputation {
  readonly selectedTier: SelectedPerpMarginTier
  readonly positionValueDecimal: Decimal40Value
  readonly maintenanceMarginDecimal: Decimal40Value
  readonly backstopThresholdDecimal: Decimal40Value
  readonly data: PerpMaintenanceMargin
}
