import { Decimal40 } from '../core/decimal.js'
import type {
  InitialMarginComputation,
  MaintenanceMarginComputation,
  NormalizedPerpMarginPosition,
  NormalizedPerpMarginTier,
  SelectedPerpMarginTier,
} from './types.js'

type DecimalValue = InstanceType<typeof Decimal40>

const decimalTen = new Decimal40(10)
const decimalTwo = new Decimal40(2)
const decimalThree = new Decimal40(3)

export function computePerpTransferRequirement(
  initialMargin: DecimalValue,
  positionValue: DecimalValue,
): DecimalValue {
  return Decimal40.max(initialMargin, positionValue.div(decimalTen))
}

export function computePerpInitialMarginNormalized(
  position: NormalizedPerpMarginPosition,
): InitialMarginComputation {
  const positionValueDecimal = position.absoluteSizeDecimal.mul(position.markPriceDecimal)
  const selectedTier = selectPerpMarginTierFromSchedule(positionValueDecimal, position.marginTiers)
  const initialMarginDecimal = positionValueDecimal.div(position.leverage.valueDecimal)
  const transferMarginRequirementDecimal = computePerpTransferRequirement(
    initialMarginDecimal,
    positionValueDecimal,
  )
  const ruleId = 'hl.margin.initial.leverage-within-tier'
  const leverageCheck = position.leverage.valueDecimal.lte(selectedTier.maxLeverageDecimal)
    ? ({ status: 'satisfied', ruleId } as const)
    : ({
        status: 'violated',
        ruleId,
        violation: {
          ruleId,
          code: 'leverage-exceeds-tier-max-leverage',
          path: '/position/leverage',
          actual: position.leverage.value,
          limit: selectedTier.maxLeverage,
        },
      } as const)
  const data = {
    positionValue: positionValueDecimal.toFixed(),
    initialMargin: initialMarginDecimal.toFixed(),
    transferMarginRequirement: transferMarginRequirementDecimal.toFixed(),
    tierIndex: selectedTier.tierIndex,
    maxLeverage: selectedTier.maxLeverage,
    leverageCheck,
  }

  return {
    selectedTier,
    positionValueDecimal,
    initialMarginDecimal,
    transferMarginRequirementDecimal,
    data,
  }
}

export function selectPerpMarginTierFromSchedule(
  positionValue: DecimalValue,
  marginTiers: readonly NormalizedPerpMarginTier[],
): SelectedPerpMarginTier {
  let tierIndex = 0
  for (let index = 0; index < marginTiers.length; index += 1) {
    const tier = marginTiers[index]
    if (tier !== undefined && positionValue.gte(tier.lowerBoundDecimal)) tierIndex = index
  }
  const selected = marginTiers[tierIndex]
  if (selected === undefined) throw new Error('normalized margin tiers must be non-empty')
  const next = marginTiers[tierIndex + 1]

  return {
    ...selected,
    tierIndex,
    nextTierLowerBound: next?.lowerBound ?? null,
    nextTierLowerBoundDecimal: next?.lowerBoundDecimal ?? null,
  }
}

export function computePerpMaintenanceForNotional(
  positionValue: DecimalValue,
  marginTiers: readonly NormalizedPerpMarginTier[],
): {
  readonly selectedTier: SelectedPerpMarginTier
  readonly maintenanceMarginDecimal: DecimalValue
  readonly backstopThresholdDecimal: DecimalValue
} {
  const selectedTier = selectPerpMarginTierFromSchedule(positionValue, marginTiers)
  const maintenanceMarginDecimal = positionValue
    .mul(selectedTier.maintenanceRateDecimal)
    .minus(selectedTier.maintenanceDeductionDecimal)
  return {
    selectedTier,
    maintenanceMarginDecimal,
    backstopThresholdDecimal: maintenanceMarginDecimal.mul(decimalTwo).div(decimalThree),
  }
}

export function computePerpMaintenanceMarginNormalized(
  position: NormalizedPerpMarginPosition,
): MaintenanceMarginComputation {
  const positionValueDecimal = position.absoluteSizeDecimal.mul(position.markPriceDecimal)
  const { selectedTier, maintenanceMarginDecimal, backstopThresholdDecimal } =
    computePerpMaintenanceForNotional(positionValueDecimal, position.marginTiers)
  const data = {
    positionValue: positionValueDecimal.toFixed(),
    tierIndex: selectedTier.tierIndex,
    tierLowerBound: selectedTier.lowerBound,
    nextTierLowerBound: selectedTier.nextTierLowerBound,
    maxLeverage: selectedTier.maxLeverage,
    maintenanceRate: selectedTier.maintenanceRate,
    maintenanceDeduction: selectedTier.maintenanceDeduction,
    maintenanceMargin: maintenanceMarginDecimal.toFixed(),
    backstopThreshold: backstopThresholdDecimal.toFixed(),
  }

  return {
    selectedTier,
    positionValueDecimal,
    maintenanceMarginDecimal,
    backstopThresholdDecimal,
    data,
  }
}
