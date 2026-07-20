import type { Decimal40 } from '../core/decimal.js'
import type { CanonicalAssetRef, NormalizedPerpMarginTier } from '../margin/types.js'

type DecimalValue = InstanceType<typeof Decimal40>

/** @public */
export type PerpLiquidationMarginMode =
  | { readonly kind: 'cross' }
  | {
      readonly kind: 'isolated'
      /** The isolated position's own account value at its mark, unrealized PnL included; signed (may be negative). */
      readonly isolatedMarginValue: string
      /** Official `universe[].marginMode === "strictIsolated"` maps to `strict`; every other perp is `allowed`. */
      readonly marginRemoval: 'allowed' | 'strict'
    }

/** @public */
export interface PerpLiquidationTier {
  /** Tier's notional lower bound (official `lowerBound`); intervals are half-open `[lowerBound, next)`. */
  readonly lowerBound: string
  /** Official `maxLeverage` (a JSON number) converted with `String()`; positive integer decimal string. */
  readonly maxLeverage: string
}

/** @public */
export interface PerpLiquidationPosition {
  readonly asset: CanonicalAssetRef
  /** Official `position.szi` unchanged: positive = long, negative = short, never zero here. */
  readonly signedSize: string
  readonly entryPrice: string
  readonly markPrice: string
  readonly marginMode: PerpLiquidationMarginMode
  /** Tiers from `meta.marginTables` joined via the market's `marginTableId`, in official order. */
  readonly marginTiers: readonly PerpLiquidationTier[]
}

/** @public */
export interface PerpLiquidationInput {
  /** Must match exactly one entry in `positions` after canonical key derivation. */
  readonly targetAsset: CanonicalAssetRef
  /** From `crossMarginSummary.accountValue` (not `marginSummary`); signed — a liquidatable snapshot can be below zero. */
  readonly crossAccountValue: string
  /** Complete frozen account snapshot; non-target marks stay fixed while solving. */
  readonly positions: readonly PerpLiquidationPosition[]
}

/** @public */
export interface PerpLiquidationSelectedTier {
  readonly index: number
  readonly lowerBound: string
  readonly nextLowerBound: string | null
  readonly maxLeverage: string
  readonly maintenanceRate: string
  readonly deduction: string
}

/** @public */
export interface PerpLiquidationPrice {
  readonly assetKey: string
  readonly marginMode:
    | { readonly kind: 'cross' }
    | { readonly kind: 'isolated'; readonly marginRemoval: 'allowed' | 'strict' }
  /** Tier-consistent root of `accountValue(x) = maintenanceMargin(x)` for the frozen snapshot. */
  readonly liquidationPrice: string
  readonly liquidationNotional: string
  readonly selectedTier: PerpLiquidationSelectedTier
  readonly accountEquityAtLiquidation: string
  readonly targetMaintenanceMargin: string
  readonly totalAccountMaintenanceMargin: string
  /** `side * (markPrice - liquidationPrice)`, side = 1 long / -1 short; non-positive means the mark is at or beyond the boundary. */
  readonly adverseDistance: string
  /** `adverseDistance / markPrice`. */
  readonly adverseDistanceRatio: string
  /** Margin test evaluated at the frozen input mark, not at the root. */
  readonly currentlyAtOrBelowMaintenance: boolean
  /** Root solved from `accountValue = (2/3) * totalMaintenanceMargin`; `null` when no positive tier-consistent root exists. */
  readonly backstopPrice: string | null
  readonly backstopMaintenanceThreshold: string | null
  readonly backstopAdverseDistance: string | null
}

export interface NormalizedLiquidationPosition {
  readonly asset: CanonicalAssetRef
  readonly assetKey: string
  readonly signedSize: string
  readonly signedSizeDecimal: DecimalValue
  readonly entryPrice: string
  readonly markPrice: string
  readonly markPriceDecimal: DecimalValue
  readonly marginMode:
    | { readonly kind: 'cross' }
    | {
        readonly kind: 'isolated'
        readonly isolatedMarginValue: string
        readonly isolatedMarginValueDecimal: DecimalValue
        readonly marginRemoval: 'allowed' | 'strict'
      }
  readonly marginTiers: readonly NormalizedPerpMarginTier[]
}

export interface NormalizedLiquidationInput {
  readonly targetAsset: CanonicalAssetRef
  readonly targetAssetKey: string
  readonly crossAccountValue: string
  readonly crossAccountValueDecimal: DecimalValue
  readonly positions: readonly NormalizedLiquidationPosition[]
  readonly targetPositionIndex: number
}

export interface LiquidationCandidateTrace {
  readonly tierIndex: number
  readonly price: string | null
  readonly notional: string | null
  readonly accepted: boolean
  readonly rejectedReason: string | null
}
