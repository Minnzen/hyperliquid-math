import { Decimal40 } from '../core/decimal.js'
import type { MathIssue, MathResult, TraceStep } from '../model/index.js'
import { computePerpLiquidationPriceNormalized, type LiquidationRoot } from './internal.js'
import { candidateRootsStep, liquidationTrace } from './trace.js'
import type {
  LiquidationCandidateTrace,
  NormalizedLiquidationInput,
  NormalizedLiquidationPosition,
  PerpLiquidationInput,
  PerpLiquidationPrice,
} from './types.js'
import { normalizeLiquidationInput, reason } from './validation.js'

export type {
  PerpLiquidationInput,
  PerpLiquidationMarginMode,
  PerpLiquidationPosition,
  PerpLiquidationPrice,
  PerpLiquidationSelectedTier,
  PerpLiquidationTier,
} from './types.js'

function invalid<T>(issue: MathIssue): MathResult<T> {
  return {
    value: { status: 'invalid-input', issues: [issue] },
    trace: liquidationTrace(undefined, {
      status: 'incomplete',
      reason: reason(issue.code, issue.path as string),
    }),
  }
}

function notApplicable<T>(
  input: NormalizedLiquidationInput,
  code: string,
  candidates: readonly LiquidationCandidateTrace[],
): MathResult<T> {
  return {
    value: {
      status: 'not-applicable',
      reason: reason(code, `/positions/${input.targetPositionIndex}`),
    },
    trace: liquidationTrace(input, { status: 'complete' }, [candidateRootsStep(candidates)]),
  }
}

function marginModeOutput(
  position: NormalizedLiquidationPosition,
): PerpLiquidationPrice['marginMode'] {
  if (position.marginMode.kind === 'cross') return { kind: 'cross' }
  return { kind: 'isolated', marginRemoval: position.marginMode.marginRemoval }
}

function backstopRootStep(backstopRoot: LiquidationRoot | null): TraceStep {
  if (backstopRoot === null) {
    return {
      stepId: 'backstop-root',
      output: {
        price: null,
        tierIndex: null,
        maintenanceThreshold: null,
        reason: 'no-positive-tier-consistent-backstop-root',
      },
    }
  }
  return {
    stepId: 'backstop-root',
    output: {
      price: backstopRoot.price.toFixed(),
      tierIndex: backstopRoot.tier.tierIndex,
      maintenanceThreshold: backstopRoot.accountValue.toFixed(),
    },
  }
}

function resultSteps(
  candidates: readonly LiquidationCandidateTrace[],
  root: LiquidationRoot,
  backstopRoot: LiquidationRoot | null,
): readonly TraceStep[] {
  return [
    candidateRootsStep(candidates),
    {
      stepId: 'selected-liquidation-root',
      output: {
        price: root.price.toFixed(),
        tierIndex: root.tier.tierIndex,
        targetMaintenanceMargin: root.maintenanceMargin.toFixed(),
        totalAccountMaintenanceMargin: root.totalMaintenanceMargin.toFixed(),
      },
    },
    backstopRootStep(backstopRoot),
  ]
}

/**
 * Solves the target's local liquidation root
 * `x = (M_other - deduction - crossAccountValue + q * p0) / (q - abs(q) * maintenanceRate)` over
 * every target tier, keeping the unique positive root whose own liquidation notional selects that
 * tier (isolated targets use only their `isolatedMarginValue` and set `M_other = 0`). Also solves
 * an independent backstop root at `(2/3)` of total maintenance. `not-applicable` when no
 * tier-consistent root exists; it never predicts partial liquidation, backstop fills, or ADL.
 *
 * @public
 */
export function calculatePerpLiquidationPrice(
  input: PerpLiquidationInput,
): MathResult<PerpLiquidationPrice> {
  const normalized = normalizeLiquidationInput(input)
  if (!normalized.ok) return invalid(normalized.issue)

  const computation = computePerpLiquidationPriceNormalized(normalized.value)
  if (computation.root === null) {
    return notApplicable(
      normalized.value,
      'no-positive-tier-consistent-liquidation-root',
      computation.candidates,
    )
  }

  const target = normalized.value.positions[
    normalized.value.targetPositionIndex
  ] as NormalizedLiquidationPosition
  const root = computation.root
  const side = target.signedSizeDecimal.gt(0) ? new Decimal40(1) : new Decimal40(-1)
  const adverseDistance = side.mul(target.markPriceDecimal.minus(root.price))
  const backstopRoot = computation.backstopRoot
  const backstopAdverseDistance =
    backstopRoot === null
      ? null
      : side.mul(target.markPriceDecimal.minus(backstopRoot.price)).toFixed()

  return {
    value: {
      status: 'ok',
      data: {
        assetKey: target.assetKey,
        marginMode: marginModeOutput(target),
        liquidationPrice: root.price.toFixed(),
        liquidationNotional: target.signedSizeDecimal.abs().mul(root.price).toFixed(),
        selectedTier: {
          index: root.tier.tierIndex,
          lowerBound: root.tier.lowerBound,
          nextLowerBound: root.tier.nextTierLowerBound,
          maxLeverage: root.tier.maxLeverage,
          maintenanceRate: root.tier.maintenanceRate,
          deduction: root.tier.maintenanceDeduction,
        },
        accountEquityAtLiquidation: root.accountValue.toFixed(),
        targetMaintenanceMargin: root.maintenanceMargin.toFixed(),
        totalAccountMaintenanceMargin: root.totalMaintenanceMargin.toFixed(),
        adverseDistance: adverseDistance.toFixed(),
        adverseDistanceRatio: adverseDistance.div(target.markPriceDecimal).toFixed(),
        currentlyAtOrBelowMaintenance: computation.currentlyAtOrBelowMaintenance,
        backstopPrice: backstopRoot === null ? null : backstopRoot.price.toFixed(),
        backstopMaintenanceThreshold:
          backstopRoot === null ? null : backstopRoot.accountValue.toFixed(),
        backstopAdverseDistance,
      },
    },
    trace: liquidationTrace(
      normalized.value,
      { status: 'complete' },
      resultSteps(computation.candidates, root, backstopRoot),
    ),
  }
}
