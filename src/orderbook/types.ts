import type { Decimal40 } from '../core/decimal.js'

export type DecimalValue = InstanceType<typeof Decimal40>

/** @public */
export interface L2Level {
  /** Level price as a positive decimal string (official `l2Book` `px`). */
  readonly px: string
  /** Resting size at this level as a positive decimal string (official `sz`). */
  readonly sz: string
  /** Number of orders at this level (official `n`), a positive safe integer. */
  readonly n: number
}

/** @public */
export interface L2BookInput {
  /** `[bids, asks]` as returned by `l2Book`: bids strictly descending, asks strictly ascending, max 20 levels per side. */
  readonly levels: readonly [readonly L2Level[], readonly L2Level[]]
}

/** @public */
export interface BookMetrics {
  readonly bestBid: string
  readonly bestAsk: string
  readonly mid: string
  readonly spread: string
  readonly spreadBps: string
}

/** @public */
export type FillSide = 'buy' | 'sell'

/**
 * Requested fill amount: base size, or quote notional (notional needs `szDecimals`, 0-8, to
 * down-quantize the final partial level's size).
 *
 * @public
 */
export type FillAmount =
  | { readonly kind: 'size'; readonly value: string }
  | { readonly kind: 'notional'; readonly value: string; readonly szDecimals: number }

/** @public */
export interface SimulateBookFillInput extends L2BookInput {
  /** `buy` walks asks best-to-worst; `sell` walks bids best-to-worst. */
  readonly side: FillSide
  readonly amount: FillAmount
  /** Caller-chosen slippage baseline (e.g. mid or mark), a positive decimal string; never inferred. */
  readonly referencePrice: string
}

/** @public */
export interface SimulatedFill {
  readonly px: string
  readonly sz: string
  readonly notional: string
}

/** @public */
export interface SimulatedBookFill {
  readonly completion: 'none' | 'partial' | 'full'
  readonly fills: readonly SimulatedFill[]
  readonly filledSize: string
  readonly filledNotional: string
  /** Requested minus filled, in the request's own unit (size or exact notional). */
  readonly unfilledAmount: string
  /** `filledNotional / filledSize`; absent when completion is `none`. */
  readonly vwap?: string
  /** Price of the last consumed level; absent when completion is `none`. */
  readonly worstPrice?: string
  /** Signed adverse slippage vs `referencePrice` in bps; price improvement is negative. */
  readonly slippageBps?: string
}

export interface NormalizedLevel extends L2Level {
  readonly pxDecimal: DecimalValue
  readonly szDecimal: DecimalValue
}

export interface NormalizedBook {
  readonly levels: readonly [readonly NormalizedLevel[], readonly NormalizedLevel[]]
}

export type NormalizedAmount =
  | {
      readonly kind: 'size'
      readonly value: string
      readonly decimal: DecimalValue
    }
  | {
      readonly kind: 'notional'
      readonly value: string
      readonly decimal: DecimalValue
      readonly szDecimals: number
    }
