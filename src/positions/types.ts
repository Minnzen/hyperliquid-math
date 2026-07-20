import type { Decimal40 } from '../core/decimal.js'

type DecimalValue = InstanceType<typeof Decimal40>

/**
 * Discriminated position state. Open `signedSize` maps from official `position.szi` unchanged
 * (positive = long, negative = short, never zero) and `entryPrice` from `position.entryPx`.
 *
 * @public
 */
export type PerpPositionState =
  | { readonly kind: 'flat' }
  | { readonly kind: 'open'; readonly signedSize: string; readonly entryPrice: string }

/**
 * Fee attached to a fill, in the signed user-cost convention (positive = charge, negative =
 * rebate): an explicit quote amount (server fill `fee`), a decimal-fraction `rate` applied to the
 * fill notional, or `none`.
 *
 * @public
 */
export type PerpFillFee =
  | { readonly kind: 'explicit'; readonly amount: string }
  | { readonly kind: 'rate'; readonly rate: string }
  | { readonly kind: 'none' }

/** @public */
export interface PerpFill {
  /** Official fill `side`: `"B"` maps to `buy`, `"A"` maps to `sell`. */
  readonly side: 'buy' | 'sell'
  /** Unsigned fill size (official `sz`); direction comes from `side`. */
  readonly size: string
  /** Fill price (official `px`), positive decimal string. */
  readonly price: string
  readonly fee: PerpFillFee
}

/** @public */
export interface CalculatePerpUnrealizedPnlInput {
  readonly position: PerpPositionState
  readonly markPrice: string
}

/** @public */
export interface PerpUnrealizedPnl {
  readonly side: 'long' | 'short'
  readonly absoluteSize: string
  readonly positionValue: string
  readonly unrealizedPnl: string
}

/** @public */
export interface ProjectPerpFillInput {
  readonly position: PerpPositionState
  readonly fill: PerpFill
}

/** @public */
export type PerpFillClassification = 'no-op' | 'open' | 'increase' | 'reduce' | 'close' | 'flip'

/** @public */
export interface PerpFillProjection {
  readonly classification: PerpFillClassification
  readonly closedSize: string
  readonly openedSize: string
  readonly previousState: PerpPositionState
  readonly nextState: PerpPositionState
  /** Fill delta with direction applied: positive for a buy, negative for a sell. */
  readonly fillSignedSize: string
  /** Price PnL of the closing portion only, before fees. */
  readonly grossRealizedPnl: string
  /** Signed user-cost fee on the full fill (flip includes the opening remainder). */
  readonly feeAmount: string
  /** `-feeAmount`. */
  readonly feeAccountValueDelta: string
  /** Math-defined net: `grossRealizedPnl + feeAccountValueDelta`; not the raw server `closedPnl`. */
  readonly closedPnl: string
}

/** @public */
export interface ProjectPerpFillSequenceInput {
  readonly position: PerpPositionState
  /** Applied in array order, never sorted; max 2000 entries (one `userFillsByTime` window). */
  readonly fills: readonly PerpFill[]
}

/** @public */
export interface PerpFillSequenceProjection {
  readonly transitions: readonly PerpFillProjection[]
  readonly finalState: PerpPositionState
  readonly grossRealizedPnlTotal: string
  readonly feeAmountTotal: string
  readonly feeAccountValueDeltaTotal: string
  readonly closedPnlTotal: string
}

/** @public */
export interface CalculatePerpBreakEvenPriceInput {
  readonly position: PerpPositionState
  /** Signed user cost to recover: fees/funding paid are positive, rebates/funding received negative. */
  readonly cumulativeCost: string
}

/** @public */
export interface PerpBreakEvenPrice {
  readonly breakEvenPrice: string
}

export interface NormalizedFlatPosition {
  readonly kind: 'flat'
}

export interface NormalizedOpenPosition {
  readonly kind: 'open'
  readonly signedSize: string
  readonly signedSizeDecimal: DecimalValue
  readonly entryPrice: string
  readonly entryPriceDecimal: DecimalValue
}

export type NormalizedPosition = NormalizedFlatPosition | NormalizedOpenPosition

export interface NormalizedFill {
  readonly side: 'buy' | 'sell'
  readonly size: string
  readonly sizeDecimal: DecimalValue
  readonly price: string
  readonly priceDecimal: DecimalValue
  readonly fee: PerpFillFee
  readonly feeAmountDecimal: DecimalValue
}
