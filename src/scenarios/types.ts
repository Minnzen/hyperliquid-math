import type { Decimal40 } from '../core/decimal.js'
import type { CanonicalAssetRef, NormalizedPerpMarginTier } from '../margin/types.js'
import type { Assumption, MathReason, ScenarioConstraintCheck } from '../model/index.js'
import type {
  NormalizedFill,
  NormalizedPosition,
  PerpFill,
  PerpFillProjection,
  PerpPositionState,
} from '../positions/types.js'

export type DecimalValue = InstanceType<typeof Decimal40>

/** @public */
export interface CanonicalPerpScenarioAssetRef extends CanonicalAssetRef {}

/** @public */
export interface PerpScenarioMarginTier {
  /** Tier's notional lower bound (official `lowerBound`); intervals are half-open `[lowerBound, next)`. */
  readonly lowerBound: string
  /** Official `maxLeverage` (a JSON number) converted with `String()`; positive integer decimal string. */
  readonly maxLeverage: string
}

/** @public */
export interface PerpScenarioMarket {
  readonly asset: CanonicalPerpScenarioAssetRef
  /** Frozen mark for the whole scenario; both current and projected views use it. */
  readonly markPrice: string
  /** Market max leverage (official `universe[].maxLeverage` via `String()`), used to validate user leverage. */
  readonly maxLeverage: string
  /** Tiers from `meta.marginTables` joined via the market's `marginTableId`, in official order. */
  readonly marginTiers: readonly PerpScenarioMarginTier[]
}

/** @public */
export type PerpScenarioMarginMode =
  | { readonly kind: 'cross' }
  | {
      readonly kind: 'isolated'
      /** The isolated position's own account value at the input mark, unrealized PnL included; not part of `crossAccountValue`. */
      readonly isolatedMarginValue: string
      /** Official `universe[].marginMode === "strictIsolated"` maps to `strict`; every other perp is `allowed`. */
      readonly marginRemoval: 'allowed' | 'strict'
    }

/** @public */
export type PerpScenarioPosition =
  | {
      readonly kind: 'flat'
      readonly asset: CanonicalPerpScenarioAssetRef
      readonly marginMode:
        | { readonly kind: 'cross' }
        | { readonly kind: 'isolated'; readonly marginRemoval: 'allowed' | 'strict' }
      readonly leverage: string
    }
  | {
      readonly kind: 'open'
      readonly asset: CanonicalPerpScenarioAssetRef
      readonly signedSize: string
      readonly entryPrice: string
      readonly marginMode: PerpScenarioMarginMode
      readonly leverage: string
    }

/** @public */
export interface PerpAccountScenarioSnapshot {
  /** From `crossMarginSummary.accountValue` (not `marginSummary`); cross unrealized PnL included, isolated values excluded. */
  readonly crossAccountValue: string
  readonly positions: readonly PerpScenarioPosition[]
  /** One market row per referenced asset, keyed by canonical asset ref, with frozen marks and tiers. */
  readonly markets: readonly PerpScenarioMarket[]
}

/**
 * How a fill that creates or increases isolated exposure funds its margin:
 * `auto-from-leverage` transfers `max(abs(size) * mark / leverage - isolatedMarginValue, 0)` from
 * cross; `explicit-margin-delta` is a signed cross-to-isolated transfer; `not-applicable` is valid
 * only when no isolated exposure is created, preserved, or increased.
 *
 * @public
 */
export type IsolatedMarginAllocation =
  | { readonly kind: 'not-applicable' }
  | { readonly kind: 'auto-from-leverage' }
  | { readonly kind: 'explicit-margin-delta'; readonly amount: string }
  | { readonly kind: 'not-supported'; readonly reason: MathReason }

/**
 * Margin effect accompanying a `set-leverage` action. Valid combinations: cross-to-cross `none`;
 * isolated-to-isolated `preserve-isolated-margin` / `auto-from-leverage` /
 * `explicit-isolated-margin-delta`; cross-to-isolated `auto-from-leverage` /
 * `explicit-isolated-margin-delta`; isolated-to-cross `release-all-isolated-to-cross`.
 *
 * @public
 */
export type LeverageMarginEffect =
  | { readonly kind: 'none' }
  | { readonly kind: 'preserve-isolated-margin' }
  | { readonly kind: 'auto-from-leverage' }
  | { readonly kind: 'explicit-isolated-margin-delta'; readonly amount: string }
  | { readonly kind: 'release-all-isolated-to-cross' }
  | { readonly kind: 'not-supported'; readonly reason: MathReason }

/**
 * One explicit account action, applied in caller order: a fill fact (not an order intent — no
 * reduce-only, TIF, or server acceptance), a pure cross account-value delta (deposit/withdrawal),
 * a signed isolated-margin transfer, or the official `updateLeverage` shape plus an explicit
 * margin effect.
 *
 * @public
 */
export type ScenarioAction =
  | {
      readonly kind: 'fill'
      readonly asset: CanonicalPerpScenarioAssetRef
      readonly fill: PerpFill
      readonly isolatedMarginAllocation: IsolatedMarginAllocation
    }
  | { readonly kind: 'cross-account-value-delta'; readonly amount: string }
  | {
      readonly kind: 'isolated-margin-delta'
      readonly asset: CanonicalPerpScenarioAssetRef
      readonly amount: string
    }
  | {
      readonly kind: 'set-leverage'
      readonly asset: CanonicalPerpScenarioAssetRef
      readonly targetMode: 'cross' | 'isolated'
      readonly leverage: string
      readonly marginEffect: LeverageMarginEffect
    }

/** @public */
export interface PerpAccountScenarioInput {
  readonly snapshot: PerpAccountScenarioSnapshot
  readonly actions: readonly ScenarioAction[]
}

/** @public */
export interface ScenarioCrossMarginView {
  readonly accountValue: string
  readonly positionValue: string
  readonly initialMargin: string
  readonly transferMarginRequirement: string
  readonly maintenanceMargin: string
  readonly maintenanceMarginAvailable: string
}

/** @public */
export interface ScenarioPositionView {
  readonly asset: CanonicalPerpScenarioAssetRef
  readonly assetKey: string
  readonly state: PerpPositionState
  readonly leverage: string
  readonly marginMode: PerpScenarioMarginMode
  readonly markPrice: string
  readonly positionValue: string
  readonly initialMargin: string
  readonly maintenanceMargin: string
}

/** @public */
export interface ScenarioLiquidationView {
  readonly byAsset: Readonly<Record<string, string | null>>
}

/** @public */
export interface AccountMarginView {
  readonly cross: ScenarioCrossMarginView
  readonly positions: readonly ScenarioPositionView[]
  readonly liquidation: ScenarioLiquidationView
}

/**
 * Exact decimal-string differences (projected minus current), keyed by canonical asset key;
 * liquidation-price deltas are `null` when either side has no applicable root.
 *
 * @public
 */
export interface AccountMarginDelta {
  readonly crossAccountValue: string
  readonly actionsApplied: number
  readonly isolatedMarginValues: Readonly<Record<string, string>>
  readonly positionSizes: Readonly<Record<string, string>>
  readonly marginRequirements: Readonly<Record<string, string>>
  readonly liquidationPrices: Readonly<Record<string, string | null>>
}

/** @public */
export interface ProjectedActionView {
  readonly actionIndex: number
  readonly kind: ScenarioAction['kind']
  readonly assetKey?: string
  readonly accountValueDelta: string
  readonly marginDelta: string
  readonly positionEffect: string
  readonly formulaIds: readonly string[]
  readonly sourceRefs: readonly string[]
}

/** @public */
export interface ProjectedFillView extends PerpFillProjection {
  readonly actionIndex: number
  readonly assetKey: string
}

/** @public */
export interface PositionTransitionView {
  readonly actionIndex: number
  readonly assetKey: string
  readonly previousState: PerpPositionState
  readonly nextState: PerpPositionState
  readonly classification: PerpFillProjection['classification']
}

/** @public */
export interface PerpAccountScenarioResult {
  /** Margin/liquidation view of the input snapshot, before any action. */
  readonly current: AccountMarginView
  /** Same view after all actions, at the same frozen marks. */
  readonly projected: AccountMarginView
  readonly delta: AccountMarginDelta
  readonly actions: readonly ProjectedActionView[]
  readonly fills: readonly ProjectedFillView[]
  readonly positionTransitions: readonly PositionTransitionView[]
  /** Always includes `protocolSupport: "unverified"` — do not present the projection as server-submit parity. */
  readonly assumptions: readonly Assumption[]
  /** Objective facts only; severity, warnings, and blocking policy belong to the caller. */
  readonly constraintChecks: readonly ScenarioConstraintCheck[]
}

export interface NormalizedMarket {
  readonly asset: CanonicalPerpScenarioAssetRef
  readonly assetKey: string
  readonly markPrice: string
  readonly markPriceDecimal: DecimalValue
  readonly maxLeverage: string
  readonly maxLeverageDecimal: DecimalValue
  readonly marginTiers: readonly NormalizedPerpMarginTier[]
}

export interface NormalizedScenarioPosition {
  readonly asset: CanonicalPerpScenarioAssetRef
  readonly assetKey: string
  readonly state: NormalizedPosition
  readonly leverage: string
  readonly leverageDecimal: DecimalValue
  readonly marginMode:
    | { readonly kind: 'cross' }
    | {
        readonly kind: 'isolated'
        readonly isolatedMarginValue: string
        readonly isolatedMarginValueDecimal: DecimalValue
        readonly marginRemoval: 'allowed' | 'strict'
      }
}

export type NormalizedAction =
  | {
      readonly kind: 'fill'
      readonly assetKey: string
      readonly fill: NormalizedFill
      readonly isolatedMarginAllocation: IsolatedMarginAllocation
    }
  | {
      readonly kind: 'cross-account-value-delta'
      readonly amount: string
      readonly decimal: DecimalValue
    }
  | {
      readonly kind: 'isolated-margin-delta'
      readonly assetKey: string
      readonly amount: string
      readonly decimal: DecimalValue
    }
  | {
      readonly kind: 'set-leverage'
      readonly assetKey: string
      readonly targetMode: 'cross' | 'isolated'
      readonly leverage: string
      readonly leverageDecimal: DecimalValue
      readonly marginEffect: LeverageMarginEffect
    }

export interface NormalizedInput {
  readonly crossAccountValue: string
  readonly crossAccountValueDecimal: DecimalValue
  readonly markets: ReadonlyMap<string, NormalizedMarket>
  readonly positions: readonly NormalizedScenarioPosition[]
  readonly actions: readonly NormalizedAction[]
}

export interface WorkingPosition extends NormalizedScenarioPosition {}

export interface WorkingState {
  crossAccountValue: DecimalValue
  positions: Map<string, WorkingPosition>
}
