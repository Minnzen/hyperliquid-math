import { Decimal40 } from '../core/decimal.js'
import type { MathIssue, MathResult } from '../model/index.js'
import {
  computePerpInitialMarginNormalized,
  computePerpMaintenanceMarginNormalized,
  computePerpTransferRequirement,
} from './internal.js'
import {
  accountMarginTrace,
  initialMarginTrace,
  maintenanceMarginTrace,
  unifiedAccountRatioTrace,
} from './trace.js'
import type {
  CalculatePerpInitialMarginInput,
  CalculatePerpMaintenanceMarginInput,
  CalculateUnifiedAccountRatioInput,
  EvaluatePerpAccountMarginInput,
  PerpAccountMargin,
  PerpAccountMarginPosition,
  PerpInitialMargin,
  PerpMaintenanceMargin,
  UnifiedAccountRatio,
  UnifiedAccountTokenRatio,
} from './types.js'
import {
  normalizeCalculateUnifiedAccountRatioInput,
  normalizeEvaluatePerpAccountMarginInput,
  normalizeInitialMarginInput,
  normalizeMaintenanceMarginInput,
  reason,
  validateNonZeroPosition,
} from './validation.js'

export type {
  CalculatePerpInitialMarginInput,
  CalculatePerpMaintenanceMarginInput,
  CalculateUnifiedAccountRatioInput,
  CanonicalAssetRef,
  EvaluatePerpAccountMarginInput,
  PerpAccountMargin,
  PerpAccountMarginPosition,
  PerpAccountMarginTotals,
  PerpCrossAccountMargin,
  PerpInitialMargin,
  PerpMaintenanceMargin,
  PerpMarginMode,
  PerpMarginPosition,
  PerpMarginTier,
  UnifiedAccountDexMargin,
  UnifiedAccountRatio,
  UnifiedAccountSpotBalance,
  UnifiedAccountTokenRatio,
} from './types.js'

const decimalZero = new Decimal40(0)
const decimalTen = new Decimal40(10)
const decimalTwo = new Decimal40(2)
const decimalThree = new Decimal40(3)

function invalidInitial<T>(issue: MathIssue): MathResult<T> {
  return {
    value: { status: 'invalid-input', issues: [issue] },
    trace: initialMarginTrace(undefined, {
      status: 'incomplete',
      reason: reason(issue.code, issue.path as string),
    }),
  }
}

function invalidMaintenance<T>(issue: MathIssue): MathResult<T> {
  return {
    value: { status: 'invalid-input', issues: [issue] },
    trace: maintenanceMarginTrace(undefined, {
      status: 'incomplete',
      reason: reason(issue.code, issue.path as string),
    }),
  }
}

function invalidAccount<T>(issue: MathIssue): MathResult<T> {
  return {
    value: { status: 'invalid-input', issues: [issue] },
    trace: accountMarginTrace(undefined, {
      status: 'incomplete',
      reason: reason(issue.code, issue.path as string),
    }),
  }
}

function invalidUnifiedAccountRatio<T>(issue: MathIssue): MathResult<T> {
  return {
    value: { status: 'invalid-input', issues: [issue] },
    trace: unifiedAccountRatioTrace(undefined, {
      status: 'incomplete',
      reason: reason(issue.code, issue.path as string),
    }),
  }
}

/**
 * Computes `initialMargin = abs(signedSize) * markPrice / leverage` and
 * `transferMarginRequirement = max(initialMargin, 0.1 * notional)` (the official minimum to
 * transfer margin or open isolated). Also selects the notional's margin tier and reports an
 * objective `leverage <= tier maxLeverage` constraint check — a violation does not invalidate the
 * arithmetic, since an open position can drift into another tier as marks move.
 *
 * @public
 */
export function calculatePerpInitialMargin(
  input: CalculatePerpInitialMarginInput,
): MathResult<PerpInitialMargin> {
  const normalized = normalizeInitialMarginInput(input)
  if (!normalized.ok) return invalidInitial(normalized.issue)
  const nonZero = validateNonZeroPosition(normalized.value, '/position')
  if (!nonZero.ok) {
    return {
      value: {
        status: 'not-applicable',
        reason: reason('zero-position-size', '/position/signedSize'),
      },
      trace: initialMarginTrace(normalized.value, { status: 'complete' }),
    }
  }

  const computed = computePerpInitialMarginNormalized(normalized.value)
  return {
    value: { status: 'ok', data: computed.data },
    trace: initialMarginTrace(normalized.value, { status: 'complete' }, [
      {
        stepId: 'position-value',
        inputs: {
          signedSize: normalized.value.signedSize,
          markPrice: normalized.value.markPrice,
        },
        output: computed.data.positionValue,
      },
      {
        stepId: 'initial-margin',
        inputs: {
          positionValue: computed.data.positionValue,
          leverage: normalized.value.leverage.value,
        },
        output: computed.data.initialMargin,
      },
      {
        stepId: 'opening-leverage-tier-check',
        inputs: {
          positionValue: computed.data.positionValue,
          leverage: normalized.value.leverage.value,
        },
        output: {
          tierIndex: computed.data.tierIndex,
          maxLeverage: computed.data.maxLeverage,
          status: computed.data.leverageCheck.status,
        },
      },
      {
        stepId: 'transfer-margin-requirement',
        inputs: {
          initialMargin: computed.data.initialMargin,
          tenPercentPositionValue: computed.positionValueDecimal.div(decimalTen).toFixed(),
        },
        output: computed.data.transferMarginRequirement,
      },
    ]),
  }
}

/**
 * Selects the margin tier for `notional = abs(signedSize) * markPrice` and computes
 * `maintenanceMargin = notional * maintenanceRate - deduction`, where
 * `maintenanceRate = 1 / (2 * maxLeverage)` and the deduction recurrence keeps maintenance margin
 * continuous across tier boundaries. `backstopThreshold = (2/3) * maintenanceMargin` is the
 * official fact only — it predicts no partial liquidation, backstop execution, or ADL.
 *
 * @public
 */
export function calculatePerpMaintenanceMargin(
  input: CalculatePerpMaintenanceMarginInput,
): MathResult<PerpMaintenanceMargin> {
  const normalized = normalizeMaintenanceMarginInput(input)
  if (!normalized.ok) return invalidMaintenance(normalized.issue)
  const nonZero = validateNonZeroPosition(normalized.value, '/position')
  if (!nonZero.ok) {
    return {
      value: {
        status: 'not-applicable',
        reason: reason('zero-position-size', '/position/signedSize'),
      },
      trace: maintenanceMarginTrace(normalized.value, { status: 'complete' }),
    }
  }

  const computed = computePerpMaintenanceMarginNormalized(normalized.value)
  return {
    value: { status: 'ok', data: computed.data },
    trace: maintenanceMarginTrace(normalized.value, { status: 'complete' }, [
      {
        stepId: 'select-tier',
        inputs: { positionValue: computed.data.positionValue },
        output: {
          tierIndex: computed.data.tierIndex,
          tierLowerBound: computed.data.tierLowerBound,
          nextTierLowerBound: computed.data.nextTierLowerBound,
          maxLeverage: computed.data.maxLeverage,
        },
      },
      {
        stepId: 'maintenance-margin',
        inputs: {
          positionValue: computed.data.positionValue,
          maintenanceRate: computed.data.maintenanceRate,
          maintenanceDeduction: computed.data.maintenanceDeduction,
        },
        output: computed.data.maintenanceMargin,
      },
      {
        stepId: 'backstop-threshold',
        inputs: { maintenanceMargin: computed.data.maintenanceMargin },
        output: computed.data.backstopThreshold,
      },
    ]),
  }
}

/**
 * Evaluates initial/maintenance margin facts for every position in one frozen snapshot: cross
 * positions aggregate against `crossAccountValue` (sums, `available = accountValue - requirement`,
 * `maxRemovableMargin`), isolated rows use only their own `isolatedMarginValue`, with
 * `maxRemovableMargin = 0` under `strict` removal. Returns values and objective constraint facts
 * only; severity, blocking, and freshness policy stay with the caller.
 *
 * @public
 */
export function evaluatePerpAccountMargin(
  input: EvaluatePerpAccountMarginInput,
): MathResult<PerpAccountMargin> {
  const normalized = normalizeEvaluatePerpAccountMarginInput(input)
  if (!normalized.ok) return invalidAccount(normalized.issue)

  let crossPositionValue = decimalZero
  let crossInitialMargin = decimalZero
  let crossMaintenanceMargin = decimalZero
  let isolatedPositionValue = decimalZero
  let isolatedInitialMargin = decimalZero
  let isolatedMaintenanceMargin = decimalZero
  const positions: PerpAccountMarginPosition[] = []

  for (const position of normalized.value.positions) {
    if (position.signedSizeDecimal.isZero()) continue

    const initial = computePerpInitialMarginNormalized(position)
    const maintenance = computePerpMaintenanceMarginNormalized(position)

    if (position.marginMode.kind === 'cross') {
      crossPositionValue = crossPositionValue.plus(initial.positionValueDecimal)
      crossInitialMargin = crossInitialMargin.plus(initial.initialMarginDecimal)
      crossMaintenanceMargin = crossMaintenanceMargin.plus(maintenance.maintenanceMarginDecimal)
      positions.push({
        asset: position.asset,
        assetKey: position.assetKey,
        marginMode: { kind: 'cross' },
        ...initial.data,
        maintenanceMargin: maintenance.data.maintenanceMargin,
        backstopThreshold: maintenance.data.backstopThreshold,
        tierIndex: maintenance.data.tierIndex,
        tierLowerBound: maintenance.data.tierLowerBound,
        nextTierLowerBound: maintenance.data.nextTierLowerBound,
        maxLeverage: maintenance.data.maxLeverage,
        maintenanceRate: maintenance.data.maintenanceRate,
        maintenanceDeduction: maintenance.data.maintenanceDeduction,
      })
      continue
    }

    isolatedPositionValue = isolatedPositionValue.plus(initial.positionValueDecimal)
    isolatedInitialMargin = isolatedInitialMargin.plus(initial.initialMarginDecimal)
    isolatedMaintenanceMargin = isolatedMaintenanceMargin.plus(maintenance.maintenanceMarginDecimal)
    const marginValue = position.marginMode.isolatedMarginValueDecimal
    const maintenanceMarginAvailable = marginValue.minus(maintenance.maintenanceMarginDecimal)
    const initialMarginAvailable = marginValue.minus(initial.initialMarginDecimal)
    const transferMarginAvailable = marginValue.minus(initial.transferMarginRequirementDecimal)
    const maxRemovableMargin =
      position.marginMode.marginRemoval === 'strict'
        ? decimalZero
        : Decimal40.max(transferMarginAvailable, decimalZero)
    positions.push({
      asset: position.asset,
      assetKey: position.assetKey,
      marginMode: { kind: 'isolated', marginRemoval: position.marginMode.marginRemoval },
      ...initial.data,
      maintenanceMargin: maintenance.data.maintenanceMargin,
      backstopThreshold: maintenance.data.backstopThreshold,
      tierIndex: maintenance.data.tierIndex,
      tierLowerBound: maintenance.data.tierLowerBound,
      nextTierLowerBound: maintenance.data.nextTierLowerBound,
      maxLeverage: maintenance.data.maxLeverage,
      maintenanceRate: maintenance.data.maintenanceRate,
      maintenanceDeduction: maintenance.data.maintenanceDeduction,
      marginValue: position.marginMode.isolatedMarginValue,
      maintenanceMarginAvailable: maintenanceMarginAvailable.toFixed(),
      initialMarginAvailable: initialMarginAvailable.toFixed(),
      transferMarginAvailable: transferMarginAvailable.toFixed(),
      maxRemovableMargin: maxRemovableMargin.toFixed(),
    })
  }

  const crossTransferMarginRequirement = computePerpTransferRequirement(
    crossInitialMargin,
    crossPositionValue,
  )
  const crossBackstopThreshold = crossMaintenanceMargin.mul(decimalTwo).div(decimalThree)
  const cross = {
    accountValue: normalized.value.crossAccountValue,
    positionValue: crossPositionValue.toFixed(),
    initialMargin: crossInitialMargin.toFixed(),
    transferMarginRequirement: crossTransferMarginRequirement.toFixed(),
    maintenanceMargin: crossMaintenanceMargin.toFixed(),
    backstopThreshold: crossBackstopThreshold.toFixed(),
    maintenanceMarginAvailable: normalized.value.crossAccountValueDecimal
      .minus(crossMaintenanceMargin)
      .toFixed(),
    initialMarginAvailable: normalized.value.crossAccountValueDecimal
      .minus(crossInitialMargin)
      .toFixed(),
    transferMarginAvailable: normalized.value.crossAccountValueDecimal
      .minus(crossTransferMarginRequirement)
      .toFixed(),
    maxRemovableMargin: Decimal40.max(
      normalized.value.crossAccountValueDecimal.minus(crossTransferMarginRequirement),
      decimalZero,
    ).toFixed(),
  }
  const data: PerpAccountMargin = {
    cross,
    positions,
    totals: {
      crossPositionValue: crossPositionValue.toFixed(),
      isolatedPositionValue: isolatedPositionValue.toFixed(),
      totalPositionValue: crossPositionValue.plus(isolatedPositionValue).toFixed(),
      crossMaintenanceMargin: crossMaintenanceMargin.toFixed(),
      isolatedMaintenanceMargin: isolatedMaintenanceMargin.toFixed(),
      totalMaintenanceMargin: crossMaintenanceMargin.plus(isolatedMaintenanceMargin).toFixed(),
      crossInitialMargin: crossInitialMargin.toFixed(),
      isolatedInitialMargin: isolatedInitialMargin.toFixed(),
      totalInitialMargin: crossInitialMargin.plus(isolatedInitialMargin).toFixed(),
    },
  }

  return {
    value: { status: 'ok', data },
    trace: accountMarginTrace(normalized.value, { status: 'complete' }, [
      {
        stepId: 'cross-transfer-margin-requirement',
        inputs: {
          crossInitialMargin: cross.initialMargin,
          tenPercentCrossPositionValue: crossPositionValue.div(decimalTen).toFixed(),
        },
        output: cross.transferMarginRequirement,
      },
      {
        stepId: 'cross-margin-available',
        inputs: {
          crossAccountValue: normalized.value.crossAccountValue,
          crossMaintenanceMargin: cross.maintenanceMargin,
        },
        output: cross.maintenanceMarginAvailable,
      },
    ]),
  }
}

/**
 * Aggregates per-DEX cross maintenance and isolated margin usage by collateral token, then returns
 * the maximum `crossMaintenanceMarginUsed / (spotTotal - isolatedMarginUsed)` ratio. A referenced
 * spot balance is mandatory. Occupied collateral with non-positive available balance is
 * indeterminate; zero-occupation collateral contributes exactly zero without division.
 *
 * @public
 */
export function calculateUnifiedAccountRatio(
  input: CalculateUnifiedAccountRatioInput,
): MathResult<UnifiedAccountRatio> {
  const normalized = normalizeCalculateUnifiedAccountRatioInput(input)
  if (!normalized.ok) return invalidUnifiedAccountRatio(normalized.issue)

  const usageByToken = new Map<
    number,
    {
      crossMaintenanceMarginUsed: InstanceType<typeof Decimal40>
      isolatedMarginUsed: InstanceType<typeof Decimal40>
    }
  >()

  for (const dex of [...normalized.value.dexes].sort(
    (left, right) => left.dexIndex - right.dexIndex,
  )) {
    const existing = usageByToken.get(dex.collateralToken)
    usageByToken.set(dex.collateralToken, {
      crossMaintenanceMarginUsed: (existing?.crossMaintenanceMarginUsed ?? decimalZero).plus(
        dex.crossMaintenanceMarginUsedDecimal,
      ),
      isolatedMarginUsed: (existing?.isolatedMarginUsed ?? decimalZero).plus(
        dex.isolatedMarginUsedDecimal,
      ),
    })
  }

  const tokenGroups = normalized.value.spotBalances
    .flatMap((spot) => {
      const usage = usageByToken.get(spot.token)
      return usage === undefined ? [] : [{ collateralToken: spot.token, spot, usage }]
    })
    .sort((left, right) => left.collateralToken - right.collateralToken)

  let accountRatio = decimalZero
  const tokens: UnifiedAccountTokenRatio[] = []
  const intermediates: {
    stepId: string
    inputs: {
      collateralToken: number
      spotTotal: string
      crossMaintenanceMarginUsed: string
      isolatedMarginUsed: string
    }
    output: { available: string; ratio: string }
  }[] = []

  for (const { collateralToken, spot, usage } of tokenGroups) {
    const available = spot.totalDecimal.minus(usage.isolatedMarginUsed)
    const occupied =
      !usage.crossMaintenanceMarginUsed.isZero() || !usage.isolatedMarginUsed.isZero()
    if (occupied && available.lte(0)) {
      const reasonValue = reason(
        'non-positive-unified-available-balance',
        `/spotBalances/${spot.inputIndex}/total`,
      )
      return {
        value: { status: 'indeterminate', reason: reasonValue },
        trace: unifiedAccountRatioTrace(normalized.value, {
          status: 'incomplete',
          reason: reasonValue,
        }),
      }
    }

    const ratio = occupied ? usage.crossMaintenanceMarginUsed.div(available) : decimalZero
    accountRatio = Decimal40.max(accountRatio, ratio)

    const token = {
      collateralToken,
      spotTotal: spot.total,
      crossMaintenanceMarginUsed: usage.crossMaintenanceMarginUsed.toFixed(),
      isolatedMarginUsed: usage.isolatedMarginUsed.toFixed(),
      available: available.toFixed(),
      ratio: ratio.toFixed(),
    }
    tokens.push(token)
    intermediates.push({
      stepId: 'collateral-token-ratio',
      inputs: {
        collateralToken,
        spotTotal: token.spotTotal,
        crossMaintenanceMarginUsed: token.crossMaintenanceMarginUsed,
        isolatedMarginUsed: token.isolatedMarginUsed,
      },
      output: { available: token.available, ratio: token.ratio },
    })
  }

  return {
    value: {
      status: 'ok',
      data: { tokens, accountRatio: accountRatio.toFixed() },
    },
    trace: unifiedAccountRatioTrace(normalized.value, { status: 'complete' }, intermediates),
  }
}
