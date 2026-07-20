import type { CanonicalPerpAssetRef } from '../core/asset-ref.js'
import type { ConstraintCheck, MathReason } from '../model/index.js'
import type { PerpFill, PerpFillProjection, PerpPositionState } from '../positions/types.js'

/** @public */
export type ReconciliationAsset = CanonicalPerpAssetRef

/** @public */
export interface PerpAccountReplayPosition {
  readonly asset: ReconciliationAsset
  readonly state: PerpPositionState
}

/** @public */
export interface PerpAccountReplaySnapshot {
  /** USDC cash ledger excluding unrealized PnL (no same-named official field; recommended: `marginSummary.accountValue - sum(unrealizedPnl)`). Apply the same convention to base and observed snapshots. */
  readonly cashBalance: string
  /** Unique by canonical asset identity; assets absent here start from flat on their first fill. */
  readonly positions: readonly PerpAccountReplayPosition[]
}

/**
 * Caller's completeness claim for the event set. `incomplete` returns `indeterminate` without
 * exposing a replay prefix — Math never infers missing history.
 *
 * @public
 */
export type ReconciliationCompleteness =
  | { readonly kind: 'complete' }
  | { readonly kind: 'incomplete'; readonly reason: MathReason }

/**
 * One ordered account event: a fill (with optional raw server evidence), a settled funding
 * delta, or a transfer delta. `eventId` must be unique and non-empty; `timestampMs` (epoch
 * milliseconds) must be nondecreasing, with same-timestamp array order authoritative.
 *
 * @public
 */
export type PerpAccountReplayEvent =
  | {
      readonly kind: 'fill'
      readonly eventId: string
      readonly timestampMs: number
      readonly asset: ReconciliationAsset
      readonly fill: PerpFill
      readonly serverFillEvidence?: PerpAccountServerFillEvidence
    }
  | {
      readonly kind: 'funding'
      readonly eventId: string
      readonly timestampMs: number
      readonly asset: ReconciliationAsset
      /** Signed settled funding delta as reported (e.g. `userFunding`); not recomputed by Math. */
      readonly accountValueDelta: string
    }
  | {
      readonly kind: 'transfer'
      readonly eventId: string
      readonly timestampMs: number
      readonly accountValueDelta: string
    }

/** @public */
export interface ReplayPerpAccountEventsInput {
  readonly snapshot: PerpAccountReplaySnapshot
  /** Already ordered, deduplicated, and routed by the caller; Math never sorts or backfills. */
  readonly events: readonly PerpAccountReplayEvent[]
  readonly completeness: ReconciliationCompleteness
}

/**
 * Raw server fill display fields (`startPosition`, `closedPnl`, `fee`) passed verbatim after
 * caller normalization; replay reports neutral residuals against them without asserting whether
 * server `closedPnl` is gross, net, or rounded.
 *
 * @public
 */
export interface PerpAccountServerFillEvidence {
  readonly startPosition: string
  readonly closedPnl: string
  readonly fee: string
}

/** @public */
export type PerpAccountServerFillResiduals =
  | { readonly status: 'not-evaluated' }
  | {
      readonly status: 'evaluated'
      readonly startPositionResidual: string
      readonly serverClosedPnlMinusProjectedGrossRealizedPnl: string
      readonly serverClosedPnlMinusMathNetClosedPnl: string
      readonly serverFeeMinusProjectionFeeAmount: string
    }

/** @public */
export type PerpAccountLedgerLine =
  | {
      readonly kind: 'realized-pnl'
      readonly eventId: string
      readonly timestampMs: number
      readonly assetKey: string
      readonly amount: string
    }
  | {
      readonly kind: 'trade-fee'
      readonly eventId: string
      readonly timestampMs: number
      readonly assetKey: string
      readonly amount: string
    }
  | {
      readonly kind: 'funding'
      readonly eventId: string
      readonly timestampMs: number
      readonly assetKey: string
      readonly amount: string
    }
  | {
      readonly kind: 'transfer'
      readonly eventId: string
      readonly timestampMs: number
      readonly amount: string
    }

/** @public */
export type PerpAccountReplayTransition =
  | {
      readonly kind: 'fill'
      readonly eventId: string
      readonly timestampMs: number
      readonly assetKey: string
      readonly projection: PerpFillProjection
      readonly cashDelta: string
      readonly serverFillEvidence: PerpAccountServerFillEvidence | null
      readonly serverFillResiduals: PerpAccountServerFillResiduals
    }
  | {
      readonly kind: 'funding'
      readonly eventId: string
      readonly timestampMs: number
      readonly assetKey: string
      readonly cashDelta: string
    }
  | {
      readonly kind: 'transfer'
      readonly eventId: string
      readonly timestampMs: number
      readonly cashDelta: string
    }

/** @public */
export interface PerpAccountReplayTotals {
  readonly realizedPnl: string
  readonly feeAccountValueDelta: string
  readonly fundingAccountValueDelta: string
  readonly transferAccountValueDelta: string
  readonly netCashDelta: string
}

/** @public */
export interface PerpAccountReplay {
  readonly initial: PerpAccountReplaySnapshot
  readonly final: PerpAccountReplaySnapshot
  readonly transitions: readonly PerpAccountReplayTransition[]
  readonly ledger: readonly PerpAccountLedgerLine[]
  readonly totals: PerpAccountReplayTotals
}

/**
 * Non-negative absolute tolerances; a numeric check is satisfied iff `abs(residual) <= tolerance`.
 *
 * @public
 */
export interface PerpAccountReconciliationTolerances {
  readonly cashBalance: string
  readonly signedSize: string
  readonly entryPrice: string
}

/** @public */
export type PerpAccountReconciliationEvidence =
  | { readonly kind: 'complete'; readonly eventCount: number }
  | { readonly kind: 'incomplete'; readonly reason: MathReason }

/** @public */
export interface ReconcilePerpAccountSnapshotInput {
  readonly projected: PerpAccountReplaySnapshot
  readonly observed: PerpAccountReplaySnapshot
  readonly tolerances: PerpAccountReconciliationTolerances
  readonly evidence: PerpAccountReconciliationEvidence
}

/** @public */
export type PerpAccountPositionResidual =
  | {
      readonly assetKey: string
      readonly status: 'flat'
    }
  | {
      readonly assetKey: string
      readonly status: 'numeric-residual'
      readonly signedSizeResidual: string
      readonly entryPriceResidual: string
    }
  | {
      readonly assetKey: string
      readonly status: 'missing-projected' | 'missing-observed' | 'state-mismatch'
      readonly projectedState?: PerpPositionState
      readonly observedState?: PerpPositionState
    }

/** @public */
export interface PerpAccountReconciliation {
  /** `observed.cashBalance - projected.cashBalance`. */
  readonly cashBalanceResidual: string
  readonly positions: readonly PerpAccountPositionResidual[]
  readonly checks: readonly ConstraintCheck[]
  /** Always the observed snapshot — server state wins; no local projection overwrites it. */
  readonly corrected: {
    readonly authority: 'server-authoritative'
    readonly snapshot: PerpAccountReplaySnapshot
  }
}
