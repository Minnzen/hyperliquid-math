import type { Decimal40 } from '../core/decimal.js'
import type { ConstraintCheck } from '../model/index.js'

export type DecimalValue = InstanceType<typeof Decimal40>

/** @public */
export interface ValidateHip1DeploymentInput {
  /** Display label, max 6 Unicode code points; never trimmed, normalized, or used as identity. */
  readonly name: string
  /** Official token metadata `weiDecimals` (number); must satisfy `szDecimals + 5 <= weiDecimals`. */
  readonly weiDecimals: number
  /** Official token metadata `szDecimals` (number) — minimum tradable size precision. */
  readonly szDecimals: number
  /** Non-negative integer decimal string of minimal units; positive supply is an objective constraint. */
  readonly maxSupplyWei: string
  /** Sum of `UserGenesis` `userAndWei` allocations, aggregated by the caller. */
  readonly userGenesisWei: string
  /** Sum of `UserGenesis` `existingTokenAndWei` (anchor) allocations, aggregated by the caller. */
  readonly anchorGenesisWei: string
}

/** @public */
export interface ValidatedHip1Deployment {
  /** `10 ** (weiDecimals - szDecimals)` — one tradable lot in minimal units. */
  readonly lotSizeWei: string
  /** `userGenesisWei + anchorGenesisWei`; must equal `maxSupplyWei` per the genesis checksum. */
  readonly totalGenesisWei: string
  /** Objective facts; failed constraints appear as violated checks on an `ok` result. */
  readonly checks: readonly ConstraintCheck[]
}

/** @public */
export interface EvaluateHip1AnchorGenesisEligibilityInput {
  /** Holder's anchor-token balance in minimal units, non-negative integer decimal string. */
  readonly holderBalanceWei: string
  /** Anchor token's max supply in minimal units, non-negative integer decimal string. */
  readonly anchorTokenMaxSupplyWei: string
}

/** @public */
export interface Hip1AnchorGenesisEligibility {
  /** `anchorTokenMaxSupplyWei / 1000000` (0.0001% of max supply); may be fractional minimal units. */
  readonly thresholdWei: string
  /** `max(holderBalanceWei - thresholdWei, 0)`, kept as an exact rational — not a rounded allocation. */
  readonly weightWei: string
  /** True iff `weightWei > 0`. */
  readonly eligible: boolean
}

export interface NormalizedHip1DeploymentInput {
  readonly name: string
  readonly weiDecimals: number
  readonly szDecimals: number
  readonly maxSupplyWei: string
  readonly userGenesisWei: string
  readonly anchorGenesisWei: string
  readonly maxSupplyWeiDecimal: DecimalValue
  readonly userGenesisWeiDecimal: DecimalValue
  readonly anchorGenesisWeiDecimal: DecimalValue
}

export interface NormalizedHip1AnchorGenesisEligibilityInput {
  readonly holderBalanceWei: string
  readonly anchorTokenMaxSupplyWei: string
  readonly holderBalanceWeiDecimal: DecimalValue
  readonly anchorTokenMaxSupplyWeiDecimal: DecimalValue
}
