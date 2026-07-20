import type { Decimal40 } from '../core/decimal.js'
import type { ConstraintCheck } from '../model/index.js'

type DecimalValue = InstanceType<typeof Decimal40>

/** @public */
export type SpotSide = 'buy' | 'sell'

/** @public */
export interface ConvertSpotTokenUnitsInput {
  /** `minimal-to-human`: non-negative integer decimal string of minimal units; `human-to-minimal`: human token amount. */
  readonly value: string
  /** Official token metadata `weiDecimals` — the decimal scale of the token's minimal unit, as a plain number. */
  readonly weiDecimals: number
  readonly direction: 'human-to-minimal' | 'minimal-to-human'
}

/** @public */
export interface SpotTokenUnitConversion {
  readonly value: string
}

/** @public */
export interface CalculateSpotOrderDeltasInput {
  readonly side: SpotSide
  readonly baseSize: string
  readonly price: string
}

/** @public */
export interface SpotOrderDeltas {
  /** `price * baseSize`. */
  readonly notional: string
  /** Signed base-token balance change: `+baseSize` for a buy, `-baseSize` for a sell. */
  readonly baseDelta: string
  /** Signed quote-token balance change: `-notional` for a buy, `+notional` for a sell. */
  readonly quoteDelta: string
}

/** @public */
export type SpotPosition =
  | { readonly kind: 'flat' }
  | { readonly kind: 'open'; readonly balance: string; readonly entryPrice: string }

/**
 * One explicit spot inventory event. `feeQuoteAmount` is the signed user cost already normalized
 * into the quote token (positive charge, negative rebate); base-token fees are not-supported until
 * the caller independently proves the actual inventory delta. Transfers use the supplied mark for
 * entry/PnL per the official rule; `direction: "in"` means tokens arriving into this venue.
 *
 * @public
 */
export type SpotPositionEvent =
  | {
      readonly kind: 'buy'
      readonly size: string
      readonly price: string
      readonly feeQuoteAmount: string
    }
  | {
      readonly kind: 'sell'
      readonly size: string
      readonly price: string
      readonly feeQuoteAmount: string
    }
  | {
      readonly kind: 'transfer'
      readonly size: string
      readonly markPrice: string
      readonly direction: 'in' | 'out'
    }
  | { readonly kind: 'genesis'; readonly size: string; readonly maxSupply: string }
  | {
      readonly kind: 'initialize-from-existing-balance'
      readonly balance: string
      readonly eventPrice: string
    }

/** @public */
export interface ProjectSpotPositionEventInput {
  readonly position: SpotPosition
  readonly event: SpotPositionEvent
}

/** @public */
export interface SpotPositionEventProjection {
  readonly classification:
    | 'open'
    | 'increase'
    | 'reduce'
    | 'close'
    | 'transfer-in'
    | 'transfer-out'
    | 'genesis'
    | 'initialize-from-existing-balance'
  readonly previousState: SpotPosition
  readonly nextState: SpotPosition
  readonly grossRealizedPnl: string
  readonly feeAmount: string
  readonly feeAccountValueDelta: string
  readonly closedPnl: string
  readonly openedSize: string
  readonly closedSize: string
}

/** @public */
export interface SpotPortfolioBalanceInput {
  /** Caller-chosen join key echoed back per token; recommended `spotMeta.tokens[].name`. Must be unique within the call. */
  readonly tokenKey: string
  readonly balance: string
  readonly entryPrice: string
  readonly markPrice: string
}

/** @public */
export interface CalculateSpotPortfolioValueInput {
  readonly balances: readonly SpotPortfolioBalanceInput[]
}

/** @public */
export interface SpotPortfolioTokenValue {
  readonly tokenKey: string
  readonly balance: string
  readonly entryPrice: string
  readonly markPrice: string
  readonly tokenValue: string
  readonly entryNotional: string
  readonly unrealizedPnl: string
}

/** @public */
export interface SpotPortfolioValue {
  readonly tokens: readonly SpotPortfolioTokenValue[]
  readonly portfolioValue: string
  readonly entryNotional: string
  readonly unrealizedPnl: string
}

/** @public */
export interface EvaluateSpotDustEligibilityInput {
  /** Non-negative human token balance. */
  readonly balance: string
  /** Frozen mid price chosen by the caller; Math does not fetch or verify it. */
  readonly midPrice: string
  /** Official token metadata `weiDecimals` (number); must satisfy `szDecimals <= weiDecimals`. */
  readonly weiDecimals: number
  /** Official token metadata `szDecimals` (number) — minimum tradable size precision. */
  readonly szDecimals: number
  /** Non-negative USD threshold; the official dust rule uses 1 USD. */
  readonly usdThreshold: string
}

/** @public */
export type SpotDustCheck = ConstraintCheck

/** @public */
export interface SpotDustEligibility {
  readonly lotSizeWei: string
  readonly lotSize: string
  readonly notionalUsd: string
  readonly eligible: boolean
  readonly checks: readonly SpotDustCheck[]
}

/** @public */
export interface ProjectSpotDustAllocationInput {
  /** Total dust collected across users, non-negative; must be `>= userDustSize`. */
  readonly aggregateDustSize: string
  /** Caller-supplied aggregate sale proceeds; must be `0` when the aggregate is below one lot (burn). */
  readonly executedProceeds: string
  readonly userDustSize: string
  /** One token lot for the aggregate, positive. */
  readonly aggregateLotSize: string
}

/** @public */
export interface SpotDustAllocation {
  /** `burn` when `aggregateDustSize < aggregateLotSize`; otherwise `converted`. */
  readonly mode: 'burn' | 'converted'
  /** `userDustSize / aggregateDustSize` (`0` for burn). */
  readonly allocationRatio: string
  /** `executedProceeds * allocationRatio` (`0` for burn). */
  readonly userProceeds: string
}

export interface NormalizedDecimal {
  readonly value: string
  readonly decimal: DecimalValue
}

export interface NormalizedConvertSpotTokenUnitsInput {
  readonly value: string
  readonly weiDecimals: number
  readonly direction: 'human-to-minimal' | 'minimal-to-human'
}

export interface NormalizedSpotOrderDeltasInput {
  readonly side: SpotSide
  readonly baseSize: string
  readonly baseSizeDecimal: DecimalValue
  readonly price: string
  readonly priceDecimal: DecimalValue
}

export type NormalizedSpotPosition =
  | { readonly kind: 'flat' }
  | {
      readonly kind: 'open'
      readonly balance: string
      readonly balanceDecimal: DecimalValue
      readonly entryPrice: string
      readonly entryPriceDecimal: DecimalValue
    }

export type NormalizedSpotEvent =
  | {
      readonly kind: 'buy'
      readonly size: string
      readonly sizeDecimal: DecimalValue
      readonly price: string
      readonly priceDecimal: DecimalValue
      readonly feeQuoteAmount: string
      readonly feeQuoteAmountDecimal: DecimalValue
    }
  | {
      readonly kind: 'sell'
      readonly size: string
      readonly sizeDecimal: DecimalValue
      readonly price: string
      readonly priceDecimal: DecimalValue
      readonly feeQuoteAmount: string
      readonly feeQuoteAmountDecimal: DecimalValue
    }
  | {
      readonly kind: 'transfer'
      readonly size: string
      readonly sizeDecimal: DecimalValue
      readonly markPrice: string
      readonly markPriceDecimal: DecimalValue
      readonly direction: 'in' | 'out'
    }
  | {
      readonly kind: 'genesis'
      readonly size: string
      readonly sizeDecimal: DecimalValue
      readonly maxSupply: string
      readonly maxSupplyDecimal: DecimalValue
    }
  | {
      readonly kind: 'initialize-from-existing-balance'
      readonly balance: string
      readonly balanceDecimal: DecimalValue
      readonly eventPrice: string
      readonly eventPriceDecimal: DecimalValue
    }

export interface NormalizedProjectSpotPositionEventInput {
  readonly position: NormalizedSpotPosition
  readonly event: NormalizedSpotEvent
}

export interface NormalizedSpotPortfolioBalance {
  readonly tokenKey: string
  readonly balance: string
  readonly balanceDecimal: DecimalValue
  readonly entryPrice: string
  readonly entryPriceDecimal: DecimalValue
  readonly markPrice: string
  readonly markPriceDecimal: DecimalValue
}

export interface NormalizedCalculateSpotPortfolioValueInput {
  readonly balances: readonly NormalizedSpotPortfolioBalance[]
}

export interface NormalizedEvaluateSpotDustEligibilityInput {
  readonly balance: string
  readonly balanceDecimal: DecimalValue
  readonly midPrice: string
  readonly midPriceDecimal: DecimalValue
  readonly weiDecimals: number
  readonly szDecimals: number
  readonly usdThreshold: string
  readonly usdThresholdDecimal: DecimalValue
}

export interface NormalizedProjectSpotDustAllocationInput {
  readonly aggregateDustSize: string
  readonly aggregateDustSizeDecimal: DecimalValue
  readonly executedProceeds: string
  readonly executedProceedsDecimal: DecimalValue
  readonly userDustSize: string
  readonly userDustSizeDecimal: DecimalValue
  readonly aggregateLotSize: string
  readonly aggregateLotSizeDecimal: DecimalValue
}
