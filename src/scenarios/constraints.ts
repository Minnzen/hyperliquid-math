import { Decimal40 } from '../core/decimal.js'
import {
  computePerpTransferRequirement,
  selectPerpMarginTierFromSchedule,
} from '../margin/internal.js'
import type { MathReason, ScenarioConstraintCheck } from '../model/index.js'
import { decimalString, scenarioReason } from './result.js'
import type { DecimalValue, NormalizedMarket, WorkingPosition, WorkingState } from './types.js'
import { positionMargin } from './views.js'

interface MarginConstraintFacts {
  readonly accountValue: DecimalValue
  readonly maintenanceMargin: DecimalValue
  readonly transferMarginRequirement: DecimalValue
}

function crossConstraintFacts(
  state: WorkingState,
  markets: ReadonlyMap<string, NormalizedMarket>,
): MarginConstraintFacts {
  let positionValue = new Decimal40(0)
  let initialMargin = new Decimal40(0)
  let maintenanceMargin = new Decimal40(0)
  for (const position of state.positions.values()) {
    if (position.marginMode.kind !== 'cross') continue
    const market = markets.get(position.assetKey)
    if (market === undefined) throw new Error('market already validated')
    const margin = positionMargin(position, market)
    positionValue = positionValue.plus(margin.positionValue)
    initialMargin = initialMargin.plus(margin.initialMargin)
    maintenanceMargin = maintenanceMargin.plus(margin.maintenanceMargin)
  }
  return {
    accountValue: state.crossAccountValue,
    maintenanceMargin,
    transferMarginRequirement: computePerpTransferRequirement(initialMargin, positionValue),
  }
}

function isolatedConstraintFacts(
  position: WorkingPosition,
  markets: ReadonlyMap<string, NormalizedMarket>,
): MarginConstraintFacts | null {
  if (position.marginMode.kind !== 'isolated' || position.state.kind === 'flat') return null
  const market = markets.get(position.assetKey)
  if (market === undefined) throw new Error('market already validated')
  const margin = positionMargin(position, market)
  return {
    accountValue: position.marginMode.isolatedMarginValueDecimal,
    maintenanceMargin: margin.maintenanceMargin,
    transferMarginRequirement: computePerpTransferRequirement(
      margin.initialMargin,
      margin.positionValue,
    ),
  }
}

function objectiveConstraint(
  ruleId: string,
  actual: DecimalValue,
  limit: DecimalValue,
  path: string,
): ScenarioConstraintCheck {
  if (actual.gte(limit)) return { status: 'satisfied', ruleId }
  return {
    status: 'violated',
    ruleId,
    transitionEffect: 'preserves-transition',
    violation: {
      ruleId,
      code: 'margin-constraint-violated',
      path,
      actual: decimalString(actual),
      limit: decimalString(limit),
    },
  }
}

function upperBoundConstraint(
  ruleId: string,
  actual: DecimalValue,
  limit: DecimalValue,
  path: string,
): ScenarioConstraintCheck {
  if (actual.lte(limit)) return { status: 'satisfied', ruleId }
  return {
    status: 'violated',
    ruleId,
    transitionEffect: 'preserves-transition',
    violation: {
      ruleId,
      code: 'leverage-exceeds-tier-max-leverage',
      path,
      actual: decimalString(actual),
      limit: decimalString(limit),
    },
  }
}

export function scenarioConstraintChecks(
  state: WorkingState,
  markets: ReadonlyMap<string, NormalizedMarket>,
): readonly ScenarioConstraintCheck[] {
  const zero = new Decimal40(0)
  const cross = crossConstraintFacts(state, markets)
  const checks: ScenarioConstraintCheck[] = [
    objectiveConstraint(
      'hl.scenario.cross-account-non-negative',
      cross.accountValue,
      zero,
      '/projected/cross/accountValue',
    ),
    objectiveConstraint(
      'hl.scenario.cross-maintenance-margin',
      cross.accountValue,
      cross.maintenanceMargin,
      '/projected/cross/accountValue',
    ),
    objectiveConstraint(
      'hl.scenario.cross-transfer-margin',
      cross.accountValue,
      cross.transferMarginRequirement,
      '/projected/cross/accountValue',
    ),
  ]

  let positionIndex = 0
  for (const position of state.positions.values()) {
    const market = markets.get(position.assetKey) as NormalizedMarket
    if (position.state.kind === 'open') {
      const margin = positionMargin(position, market)
      const selectedTier = selectPerpMarginTierFromSchedule(
        margin.positionValue,
        market.marginTiers,
      )
      checks.push(
        upperBoundConstraint(
          'hl.scenario.opening-leverage-within-tier',
          position.leverageDecimal,
          selectedTier.maxLeverageDecimal,
          `/projected/positions/${positionIndex}/leverage`,
        ),
      )
    }
    const isolated = isolatedConstraintFacts(position, markets)
    if (isolated !== null) {
      const path = `/projected/positions/${positionIndex}/marginMode/isolatedMarginValue`
      checks.push(
        objectiveConstraint(
          'hl.scenario.isolated-account-non-negative',
          isolated.accountValue,
          zero,
          path,
        ),
        objectiveConstraint(
          'hl.scenario.isolated-maintenance-margin',
          isolated.accountValue,
          isolated.maintenanceMargin,
          path,
        ),
        objectiveConstraint(
          'hl.scenario.isolated-transfer-margin',
          isolated.accountValue,
          isolated.transferMarginRequirement,
          path,
        ),
      )
    }
    positionIndex += 1
  }
  return checks
}

export function transferConstraintReason(
  state: WorkingState,
  markets: ReadonlyMap<string, NormalizedMarket>,
  path: string,
  options: { readonly cross: boolean; readonly isolatedAssetKey?: string },
): MathReason | null {
  const zero = new Decimal40(0)
  if (options.cross) {
    const cross = crossConstraintFacts(state, markets)
    if (cross.accountValue.lt(zero))
      return scenarioReason('cross-account-non-negative-constraint', path)
    if (cross.accountValue.lt(cross.maintenanceMargin)) {
      return scenarioReason('cross-maintenance-margin-constraint', path)
    }
    if (cross.accountValue.lt(cross.transferMarginRequirement)) {
      return scenarioReason('cross-transfer-margin-constraint', path)
    }
  }
  if (options.isolatedAssetKey !== undefined) {
    const position = state.positions.get(options.isolatedAssetKey)
    if (position === undefined) return scenarioReason('missing-position', path)
    const isolated = isolatedConstraintFacts(position, markets)
    if (isolated === null) return scenarioReason('isolated-position-required', path)
    if (isolated.accountValue.lt(zero)) {
      return scenarioReason('isolated-account-non-negative-constraint', path)
    }
    if (isolated.accountValue.lt(isolated.maintenanceMargin)) {
      return scenarioReason('isolated-maintenance-margin-constraint', path)
    }
    if (isolated.accountValue.lt(isolated.transferMarginRequirement)) {
      return scenarioReason('isolated-transfer-margin-constraint', path)
    }
  }
  return null
}
