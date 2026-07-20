import { okResult } from '../core/result.js'
import type { MathResult } from '../model/index.js'
import { scenarioConstraintChecks } from './constraints.js'
import { applyActions, buildWorking, computeDelta, scenarioAssumptions } from './reducer.js'
import { indeterminateScenario, invalidScenarioInput, scenarioTrace } from './result.js'
import type { PerpAccountScenarioInput, PerpAccountScenarioResult } from './types.js'
import { normalizeInput } from './validation.js'
import { accountView } from './views.js'

export type {
  AccountMarginDelta,
  AccountMarginView,
  CanonicalPerpScenarioAssetRef,
  IsolatedMarginAllocation,
  LeverageMarginEffect,
  PerpAccountScenarioInput,
  PerpAccountScenarioResult,
  PerpAccountScenarioSnapshot,
  PerpScenarioMarginMode,
  PerpScenarioMarginTier,
  PerpScenarioMarket,
  PerpScenarioPosition,
  PositionTransitionView,
  ProjectedActionView,
  ProjectedFillView,
  ScenarioAction,
  ScenarioCrossMarginView,
  ScenarioLiquidationView,
  ScenarioPositionView,
} from './types.js'

/**
 * Applies explicit account actions (fills, account-value deltas, isolated-margin deltas,
 * set-leverage) in order to one frozen snapshot and returns current vs projected margin and
 * liquidation views plus exact deltas. Pure all-or-nothing counterfactual reducer: any invalid
 * action fails the whole scenario, marks never move, and every result carries
 * `protocolSupport: "unverified"` — it is not a server-submit or fill forecast.
 *
 * @public
 */
export function simulatePerpAccountScenario(
  input: PerpAccountScenarioInput,
): MathResult<PerpAccountScenarioResult> {
  const normalized = normalizeInput(input)
  if (!normalized.ok) return invalidScenarioInput(normalized.issue)
  const currentState = buildWorking(normalized.input)
  const current = accountView(currentState, normalized.input.markets)
  const applied = applyActions(normalized.input)
  if (!applied.ok) return indeterminateScenario(applied.reason, applied.actionIndex)
  const projected = accountView(applied.state, normalized.input.markets)
  const assumptions = scenarioAssumptions(normalized.input.actions)
  return okResult(
    {
      current,
      projected,
      delta: computeDelta(current, projected, normalized.input.actions.length),
      actions: applied.actions,
      fills: applied.fills,
      positionTransitions: applied.transitions,
      assumptions,
      constraintChecks: scenarioConstraintChecks(applied.state, normalized.input.markets),
    },
    scenarioTrace(
      { status: 'complete' },
      {
        crossAccountValue: normalized.input.crossAccountValue,
        positions: normalized.input.positions.length,
        markets: normalized.input.markets.size,
        actions: normalized.input.actions.length,
      },
      assumptions,
    ),
  )
}
