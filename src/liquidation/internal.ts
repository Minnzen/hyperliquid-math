import { Decimal40 } from '../core/decimal.js'
import {
  computePerpMaintenanceForNotional,
  selectPerpMarginTierFromSchedule,
} from '../margin/internal.js'
import type { SelectedPerpMarginTier } from '../margin/types.js'
import type {
  LiquidationCandidateTrace,
  NormalizedLiquidationInput,
  NormalizedLiquidationPosition,
} from './types.js'

type DecimalValue = InstanceType<typeof Decimal40>

export interface LiquidationRoot {
  readonly price: DecimalValue
  readonly tier: SelectedPerpMarginTier
  readonly maintenanceMargin: DecimalValue
  readonly totalMaintenanceMargin: DecimalValue
  readonly accountValue: DecimalValue
}

interface RootSolveResult {
  readonly root: LiquidationRoot | null
  readonly candidates: readonly LiquidationCandidateTrace[]
}

export interface NormalizedLiquidationComputation extends RootSolveResult {
  readonly backstopRoot: LiquidationRoot | null
  readonly currentlyAtOrBelowMaintenance: boolean
}

function maintenanceMargin(position: NormalizedLiquidationPosition, markPrice: DecimalValue) {
  const notional = position.signedSizeDecimal.abs().mul(markPrice)
  const computation = computePerpMaintenanceForNotional(notional, position.marginTiers)
  return { notional, ...computation }
}

function accountValueAt(
  baseAccountValue: DecimalValue,
  target: NormalizedLiquidationPosition,
  price: DecimalValue,
): DecimalValue {
  return baseAccountValue.plus(target.signedSizeDecimal.mul(price.minus(target.markPriceDecimal)))
}

function solveRoot(
  input: NormalizedLiquidationInput,
  maintenanceFactor: DecimalValue,
): RootSolveResult {
  const target = input.positions[input.targetPositionIndex] as NormalizedLiquidationPosition
  const baseAccountValue =
    target.marginMode.kind === 'cross'
      ? input.crossAccountValueDecimal
      : target.marginMode.isolatedMarginValueDecimal
  const otherMaintenance =
    target.marginMode.kind === 'cross'
      ? input.positions.reduce((sum, position, index) => {
          if (index === input.targetPositionIndex || position.marginMode.kind !== 'cross') {
            return sum
          }
          return sum.plus(
            maintenanceMargin(position, position.markPriceDecimal).maintenanceMarginDecimal,
          )
        }, new Decimal40(0))
      : new Decimal40(0)
  const signedSize = target.signedSizeDecimal
  const absoluteSize = signedSize.abs()
  const candidates: LiquidationCandidateTrace[] = []
  const accepted: LiquidationRoot[] = []

  for (const [tierIndex, tier] of target.marginTiers.entries()) {
    const numerator = maintenanceFactor
      .mul(otherMaintenance.minus(tier.maintenanceDeductionDecimal))
      .minus(baseAccountValue)
      .plus(signedSize.mul(target.markPriceDecimal))
    const denominator = signedSize.minus(
      maintenanceFactor.mul(absoluteSize).mul(tier.maintenanceRateDecimal),
    )

    if (denominator.isZero()) {
      candidates.push({
        tierIndex,
        price: null,
        notional: null,
        accepted: false,
        rejectedReason: 'zero-denominator',
      })
      continue
    }

    const price = numerator.div(denominator)
    const notional = absoluteSize.mul(price)
    if (!price.isFinite() || !price.gt(0)) {
      candidates.push({
        tierIndex,
        price: price.isFinite() ? price.toFixed() : null,
        notional: notional.isFinite() ? notional.toFixed() : null,
        accepted: false,
        rejectedReason: 'non-positive-or-non-finite-root',
      })
      continue
    }

    const selectedTier = selectPerpMarginTierFromSchedule(notional, target.marginTiers)
    if (selectedTier.tierIndex !== tierIndex) {
      candidates.push({
        tierIndex,
        price: price.toFixed(),
        notional: notional.toFixed(),
        accepted: false,
        rejectedReason: 'root-selects-different-tier',
      })
      continue
    }

    const targetMaintenance = notional
      .mul(tier.maintenanceRateDecimal)
      .minus(tier.maintenanceDeductionDecimal)
    if (targetMaintenance.isNegative()) {
      candidates.push({
        tierIndex,
        price: price.toFixed(),
        notional: notional.toFixed(),
        accepted: false,
        rejectedReason: 'negative-maintenance-at-root',
      })
      continue
    }

    const totalMaintenanceMargin = otherMaintenance.plus(targetMaintenance)
    candidates.push({
      tierIndex,
      price: price.toFixed(),
      notional: notional.toFixed(),
      accepted: true,
      rejectedReason: null,
    })
    accepted.push({
      price,
      tier: selectedTier,
      maintenanceMargin: targetMaintenance,
      totalMaintenanceMargin,
      accountValue: accountValueAt(baseAccountValue, target, price),
    })
  }

  return {
    root: accepted.length === 1 ? (accepted[0] as LiquidationRoot) : null,
    candidates,
  }
}

function currentlyAtOrBelowMaintenance(input: NormalizedLiquidationInput): boolean {
  const target = input.positions[input.targetPositionIndex] as NormalizedLiquidationPosition
  const accountValue =
    target.marginMode.kind === 'cross'
      ? input.crossAccountValueDecimal
      : target.marginMode.isolatedMarginValueDecimal
  const totalMaintenance =
    target.marginMode.kind === 'cross'
      ? input.positions.reduce((sum, position) => {
          if (position.marginMode.kind !== 'cross') return sum
          return sum.plus(
            maintenanceMargin(position, position.markPriceDecimal).maintenanceMarginDecimal,
          )
        }, new Decimal40(0))
      : maintenanceMargin(target, target.markPriceDecimal).maintenanceMarginDecimal
  return accountValue.lte(totalMaintenance)
}

export function computePerpLiquidationPriceNormalized(
  input: NormalizedLiquidationInput,
): NormalizedLiquidationComputation {
  const liquidation = solveRoot(input, new Decimal40(1))
  const backstop = solveRoot(input, new Decimal40(2).div(3))
  return {
    ...liquidation,
    backstopRoot: backstop.root,
    currentlyAtOrBelowMaintenance: currentlyAtOrBelowMaintenance(input),
  }
}
