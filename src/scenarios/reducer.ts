import { Decimal40 } from '../core/decimal.js'
import type { Assumption, MathReason } from '../model/index.js'
import { normalizedFromPublic, projectNormalizedFill } from '../positions/project.js'
import type { NormalizedPosition, PerpFillProjection } from '../positions/types.js'
import { scenarioFormulaId, scenarioSourceRefs } from './constants.js'
import { transferConstraintReason } from './constraints.js'
import { decimalString, scenarioReason } from './result.js'
import type {
  AccountMarginDelta,
  AccountMarginView,
  DecimalValue,
  NormalizedAction,
  NormalizedInput,
  NormalizedMarket,
  PositionTransitionView,
  ProjectedActionView,
  ProjectedFillView,
  WorkingPosition,
  WorkingState,
} from './types.js'
import { positionMargin } from './views.js'

export function buildWorking(input: NormalizedInput): WorkingState {
  return {
    crossAccountValue: input.crossAccountValueDecimal,
    positions: new Map(input.positions.map((position) => [position.assetKey, { ...position }])),
  }
}

function applyIsolatedTransfer(
  position: WorkingPosition,
  state: WorkingState,
  amount: DecimalValue,
  path: string,
):
  | { readonly ok: true; readonly position: WorkingPosition }
  | { readonly ok: false; readonly reason: MathReason } {
  if (position.marginMode.kind !== 'isolated') {
    return { ok: false, reason: scenarioReason('normalized-state-invariant', path) }
  }
  const nextIsolated = position.marginMode.isolatedMarginValueDecimal.plus(amount)
  state.crossAccountValue = state.crossAccountValue.minus(amount)
  return {
    ok: true,
    position: {
      ...position,
      marginMode: {
        kind: 'isolated',
        isolatedMarginValue: decimalString(nextIsolated),
        isolatedMarginValueDecimal: nextIsolated,
        marginRemoval: position.marginMode.marginRemoval,
      },
    },
  }
}

function unrealizedPnl(position: NormalizedPosition, market: NormalizedMarket): DecimalValue {
  if (position.kind === 'flat') return new Decimal40(0)
  return position.signedSizeDecimal.mul(market.markPriceDecimal.minus(position.entryPriceDecimal))
}

function normalizedFromProjection(
  projection: PerpFillProjection,
  position: WorkingPosition,
): WorkingPosition {
  return {
    ...position,
    state: normalizedFromPublic(projection.nextState),
  }
}

export function scenarioAssumptions(actions: readonly NormalizedAction[]): readonly Assumption[] {
  const actionAssumptions = actions.map((action, index) => ({
    kind: 'counterfactual-action' as const,
    actionIndex: index,
    protocolSupport: 'unverified' as const,
    basis: scenarioReason(
      action.kind === 'set-leverage'
        ? 'testnet-update-leverage-unverified'
        : 'counterfactual-scenario-projection',
      `/actions/${index}`,
    ),
  }))
  const fillAssumptions: Assumption[] = actions.some((action) => action.kind === 'fill')
    ? [
        {
          kind: 'fill-model',
          model: 'explicit-sequence',
          parameters: {
            fee: 'explicit-per-fill',
            fillPrice: 'explicit',
            markPrice: 'frozen',
          },
        },
      ]
    : []
  const identityProtocolAssumption: Assumption[] =
    actions.length === 0
      ? [
          {
            kind: 'counterfactual-action',
            actionIndex: -1,
            protocolSupport: 'unverified',
            basis: scenarioReason('identity-scenario-protocol-parity-unverified', '/actions'),
          },
        ]
      : []
  return [
    { kind: 'frozen-input', path: '/snapshot/markets/*/markPrice', value: 'frozen' },
    { kind: 'frozen-input', path: '/snapshot/crossAccountValue', value: 'frozen' },
    { kind: 'frozen-input', path: '/assumptions/fundingAccrual', value: 'unchanged' },
    { kind: 'frozen-input', path: '/assumptions/nonTargetPositions', value: 'unchanged' },
    ...fillAssumptions,
    ...actionAssumptions,
    ...identityProtocolAssumption,
  ]
}

export function computeDelta(
  current: AccountMarginView,
  projected: AccountMarginView,
  actionCount: number,
): AccountMarginDelta {
  const isolatedMarginValues: Record<string, string> = {}
  const positionSizes: Record<string, string> = {}
  const marginRequirements: Record<string, string> = {}
  const liquidationPrices: Record<string, string | null> = {}
  const currentPositions = new Map(
    current.positions.map((position) => [position.assetKey, position]),
  )
  for (const projectedPosition of projected.positions) {
    const currentPosition = currentPositions.get(projectedPosition.assetKey)
    const currentIsolated =
      currentPosition?.marginMode.kind === 'isolated'
        ? currentPosition.marginMode.isolatedMarginValue
        : '0'
    const projectedIsolated =
      projectedPosition.marginMode.kind === 'isolated'
        ? projectedPosition.marginMode.isolatedMarginValue
        : '0'
    isolatedMarginValues[projectedPosition.assetKey] = decimalString(
      new Decimal40(projectedIsolated).minus(currentIsolated),
    )
    const currentSize =
      currentPosition?.state.kind === 'open' ? currentPosition.state.signedSize : '0'
    const projectedSize =
      projectedPosition.state.kind === 'open' ? projectedPosition.state.signedSize : '0'
    positionSizes[projectedPosition.assetKey] = decimalString(
      new Decimal40(projectedSize).minus(currentSize),
    )
    marginRequirements[projectedPosition.assetKey] = decimalString(
      new Decimal40(projectedPosition.maintenanceMargin).minus(
        currentPosition?.maintenanceMargin ?? '0',
      ),
    )
    const currentLiq = current.liquidation.byAsset[projectedPosition.assetKey]
    const projectedLiq = projected.liquidation.byAsset[projectedPosition.assetKey]
    liquidationPrices[projectedPosition.assetKey] =
      currentLiq === null && projectedLiq === null
        ? '0'
        : currentLiq === null ||
            currentLiq === undefined ||
            projectedLiq === null ||
            projectedLiq === undefined
          ? null
          : decimalString(new Decimal40(projectedLiq).minus(currentLiq))
  }
  return {
    crossAccountValue: decimalString(
      new Decimal40(projected.cross.accountValue).minus(current.cross.accountValue),
    ),
    actionsApplied: actionCount,
    isolatedMarginValues,
    positionSizes,
    marginRequirements,
    liquidationPrices,
  }
}

export function applyActions(normalized: NormalizedInput):
  | {
      readonly ok: true
      readonly state: WorkingState
      readonly actions: ProjectedActionView[]
      readonly fills: ProjectedFillView[]
      readonly transitions: PositionTransitionView[]
    }
  | { readonly ok: false; readonly reason: MathReason; readonly actionIndex: number } {
  const state = buildWorking(normalized)
  const actions: ProjectedActionView[] = []
  const fills: ProjectedFillView[] = []
  const transitions: PositionTransitionView[] = []
  for (let index = 0; index < normalized.actions.length; index += 1) {
    const action = normalized.actions[index]
    if (action === undefined) {
      return {
        ok: false,
        reason: scenarioReason('normalized-action-invariant', `/actions/${index}`),
        actionIndex: index,
      }
    }
    if (action.kind === 'cross-account-value-delta') {
      state.crossAccountValue = state.crossAccountValue.plus(action.decimal)
      if (action.decimal.isNegative()) {
        const constraint = transferConstraintReason(
          state,
          normalized.markets,
          `/actions/${index}/amount`,
          { cross: true },
        )
        if (constraint !== null) return { ok: false, reason: constraint, actionIndex: index }
      }
      actions.push({
        actionIndex: index,
        kind: action.kind,
        accountValueDelta: action.amount,
        marginDelta: '0',
        positionEffect: 'none',
        formulaIds: [scenarioFormulaId],
        sourceRefs: scenarioSourceRefs,
      })
      continue
    }
    if (
      action.kind !== 'isolated-margin-delta' &&
      action.kind !== 'set-leverage' &&
      action.kind !== 'fill'
    ) {
      return {
        ok: false,
        reason: scenarioReason('normalized-action-invariant', `/actions/${index}/kind`),
        actionIndex: index,
      }
    }
    const position = state.positions.get(action.assetKey)
    if (position === undefined)
      return {
        ok: false,
        reason: scenarioReason('missing-position', `/actions/${index}/asset`),
        actionIndex: index,
      }
    if (action.kind === 'isolated-margin-delta') {
      if (position.marginMode.kind !== 'isolated' || position.state.kind !== 'open') {
        return {
          ok: false,
          reason: scenarioReason('isolated-position-required', `/actions/${index}/asset`),
          actionIndex: index,
        }
      }
      if (action.decimal.isNegative() && position.marginMode.marginRemoval === 'strict') {
        return {
          ok: false,
          reason: scenarioReason('strict-isolated-removal-unverified', `/actions/${index}/amount`),
          actionIndex: index,
        }
      }
      const next = applyIsolatedTransfer(position, state, action.decimal, `/actions/${index}/asset`)
      if (!next.ok) return { ok: false, reason: next.reason, actionIndex: index }
      state.positions.set(action.assetKey, next.position)
      const constraint = transferConstraintReason(
        state,
        normalized.markets,
        `/actions/${index}/amount`,
        action.decimal.isNegative()
          ? { cross: action.decimal.isPositive(), isolatedAssetKey: action.assetKey }
          : { cross: action.decimal.isPositive() },
      )
      if (constraint !== null) return { ok: false, reason: constraint, actionIndex: index }
      actions.push({
        actionIndex: index,
        kind: action.kind,
        assetKey: action.assetKey,
        accountValueDelta: decimalString(action.decimal.neg()),
        marginDelta: action.amount,
        positionEffect: 'none',
        formulaIds: [scenarioFormulaId],
        sourceRefs: scenarioSourceRefs,
      })
      continue
    }
    if (action.kind === 'set-leverage') {
      if (action.targetMode !== 'cross' && action.targetMode !== 'isolated') {
        return {
          ok: false,
          reason: scenarioReason('normalized-action-invariant', `/actions/${index}/targetMode`),
          actionIndex: index,
        }
      }
      if (
        action.marginEffect.kind !== 'none' &&
        action.marginEffect.kind !== 'preserve-isolated-margin' &&
        action.marginEffect.kind !== 'auto-from-leverage' &&
        action.marginEffect.kind !== 'explicit-isolated-margin-delta' &&
        action.marginEffect.kind !== 'release-all-isolated-to-cross' &&
        action.marginEffect.kind !== 'not-supported'
      ) {
        return {
          ok: false,
          reason: scenarioReason('normalized-action-invariant', `/actions/${index}/marginEffect`),
          actionIndex: index,
        }
      }
      if (action.marginEffect.kind === 'not-supported')
        return { ok: false, reason: action.marginEffect.reason, actionIndex: index }
      let next: WorkingPosition = {
        ...position,
        leverage: action.leverage,
        leverageDecimal: action.leverageDecimal,
      }
      let accountValueDelta = new Decimal40(0)
      let marginDelta = new Decimal40(0)
      if (action.targetMode === 'cross' && position.marginMode.kind === 'cross') {
        if (action.marginEffect.kind !== 'none')
          return {
            ok: false,
            reason: scenarioReason('invalid-margin-effect', `/actions/${index}/marginEffect`),
            actionIndex: index,
          }
      } else if (action.targetMode === 'isolated') {
        if (
          action.marginEffect.kind === 'none' ||
          action.marginEffect.kind === 'release-all-isolated-to-cross'
        ) {
          return {
            ok: false,
            reason: scenarioReason('invalid-margin-effect', `/actions/${index}/marginEffect`),
            actionIndex: index,
          }
        }
        if (
          position.marginMode.kind === 'cross' &&
          action.marginEffect.kind === 'preserve-isolated-margin'
        ) {
          return {
            ok: false,
            reason: scenarioReason('invalid-margin-effect', `/actions/${index}/marginEffect`),
            actionIndex: index,
          }
        }
        const existing =
          position.marginMode.kind === 'isolated'
            ? position.marginMode.isolatedMarginValueDecimal
            : new Decimal40(0)
        let targetMargin = existing
        if (action.marginEffect.kind === 'auto-from-leverage') {
          const market = normalized.markets.get(action.assetKey)
          if (market === undefined)
            return {
              ok: false,
              reason: scenarioReason('missing-market', `/actions/${index}/asset`),
              actionIndex: index,
            }
          targetMargin = Decimal40.max(existing, positionMargin(next, market).initialMargin)
        } else if (action.marginEffect.kind === 'explicit-isolated-margin-delta') {
          targetMargin = existing.plus(action.marginEffect.amount)
        }
        marginDelta = targetMargin.minus(existing)
        state.crossAccountValue = state.crossAccountValue.minus(marginDelta)
        accountValueDelta = marginDelta.neg()
        next = {
          ...next,
          marginMode: {
            kind: 'isolated',
            isolatedMarginValue: decimalString(targetMargin),
            isolatedMarginValueDecimal: targetMargin,
            marginRemoval:
              position.marginMode.kind === 'isolated'
                ? position.marginMode.marginRemoval
                : 'allowed',
          },
        }
      } else if (position.marginMode.kind === 'isolated') {
        if (action.marginEffect.kind !== 'release-all-isolated-to-cross') {
          return {
            ok: false,
            reason: scenarioReason('invalid-margin-effect', `/actions/${index}/marginEffect`),
            actionIndex: index,
          }
        }
        state.crossAccountValue = state.crossAccountValue.plus(
          position.marginMode.isolatedMarginValueDecimal,
        )
        accountValueDelta = position.marginMode.isolatedMarginValueDecimal
        marginDelta = position.marginMode.isolatedMarginValueDecimal.neg()
        next = { ...next, marginMode: { kind: 'cross' } }
      } else {
        return {
          ok: false,
          reason: scenarioReason(
            'normalized-state-invariant',
            `/actions/${index}/asset/marginMode`,
          ),
          actionIndex: index,
        }
      }
      state.positions.set(action.assetKey, next)
      const constraint = transferConstraintReason(
        state,
        normalized.markets,
        `/actions/${index}/marginEffect`,
        action.targetMode === 'isolated'
          ? {
              cross: marginDelta.isPositive(),
              isolatedAssetKey: action.assetKey,
            }
          : { cross: true },
      )
      if (constraint !== null) return { ok: false, reason: constraint, actionIndex: index }
      actions.push({
        actionIndex: index,
        kind: action.kind,
        assetKey: action.assetKey,
        accountValueDelta: decimalString(accountValueDelta),
        marginDelta: decimalString(marginDelta),
        positionEffect: 'leverage',
        formulaIds: [scenarioFormulaId, 'hl.exchange.update-leverage.action'],
        sourceRefs: scenarioSourceRefs,
      })
      continue
    }
    if (
      action.isolatedMarginAllocation.kind !== 'not-applicable' &&
      action.isolatedMarginAllocation.kind !== 'auto-from-leverage' &&
      action.isolatedMarginAllocation.kind !== 'explicit-margin-delta' &&
      action.isolatedMarginAllocation.kind !== 'not-supported'
    ) {
      return {
        ok: false,
        reason: scenarioReason(
          'normalized-action-invariant',
          `/actions/${index}/isolatedMarginAllocation`,
        ),
        actionIndex: index,
      }
    }
    if (action.isolatedMarginAllocation.kind === 'not-supported')
      return { ok: false, reason: action.isolatedMarginAllocation.reason, actionIndex: index }
    const projection = projectNormalizedFill(position.state, action.fill)
    const market = normalized.markets.get(action.assetKey)
    if (market === undefined)
      return {
        ok: false,
        reason: scenarioReason('missing-market', `/actions/${index}/asset`),
        actionIndex: index,
      }
    const unrealizedDelta = unrealizedPnl(normalizedFromPublic(projection.nextState), market).minus(
      unrealizedPnl(position.state, market),
    )
    const valueDelta = new Decimal40(projection.grossRealizedPnl)
      .plus(projection.feeAccountValueDelta)
      .plus(unrealizedDelta)
    let actionAccountValueDelta = valueDelta
    let actionMarginDelta = new Decimal40(0)
    let nextPosition = normalizedFromProjection(projection, position)
    if (position.marginMode.kind === 'isolated') {
      if (
        projection.classification === 'reduce' ||
        projection.classification === 'close' ||
        projection.classification === 'flip'
      ) {
        return {
          ok: false,
          reason: scenarioReason(
            'isolated-reallocation-unverified',
            `/actions/${index}/isolatedMarginAllocation`,
          ),
          actionIndex: index,
        }
      }
      const currentMargin = position.marginMode.isolatedMarginValueDecimal.plus(valueDelta)
      nextPosition = {
        ...nextPosition,
        marginMode: {
          ...position.marginMode,
          isolatedMarginValue: decimalString(currentMargin),
          isolatedMarginValueDecimal: currentMargin,
        },
      }
      let transfer = new Decimal40(0)
      if (projection.classification === 'open' || projection.classification === 'increase') {
        if (action.isolatedMarginAllocation.kind === 'not-applicable') {
          return {
            ok: false,
            reason: scenarioReason(
              'isolated-margin-allocation-required',
              `/actions/${index}/isolatedMarginAllocation`,
            ),
            actionIndex: index,
          }
        }
        if (action.isolatedMarginAllocation.kind === 'explicit-margin-delta') {
          transfer = new Decimal40(action.isolatedMarginAllocation.amount)
        } else {
          const market = normalized.markets.get(action.assetKey)
          if (market === undefined)
            return {
              ok: false,
              reason: scenarioReason('missing-market', `/actions/${index}/asset`),
              actionIndex: index,
            }
          transfer = positionMargin(nextPosition, market).initialMargin.minus(currentMargin)
          if (transfer.isNegative()) transfer = new Decimal40(0)
        }
      }
      const transferred = applyIsolatedTransfer(
        nextPosition,
        state,
        transfer,
        `/actions/${index}/asset`,
      )
      if (!transferred.ok) return { ok: false, reason: transferred.reason, actionIndex: index }
      nextPosition = transferred.position
      actionAccountValueDelta = transfer.neg()
      actionMarginDelta = valueDelta.plus(transfer)
      state.positions.set(action.assetKey, nextPosition)
      if (projection.classification === 'open' || projection.classification === 'increase') {
        const constraint = transferConstraintReason(
          state,
          normalized.markets,
          `/actions/${index}/isolatedMarginAllocation`,
          {
            cross: transfer.isPositive(),
            isolatedAssetKey: action.assetKey,
          },
        )
        if (constraint !== null) return { ok: false, reason: constraint, actionIndex: index }
      }
    } else {
      if (action.isolatedMarginAllocation.kind !== 'not-applicable') {
        return {
          ok: false,
          reason: scenarioReason(
            'invalid-isolated-allocation',
            `/actions/${index}/isolatedMarginAllocation`,
          ),
          actionIndex: index,
        }
      }
      state.crossAccountValue = state.crossAccountValue.plus(valueDelta)
    }
    state.positions.set(action.assetKey, nextPosition)
    fills.push({ actionIndex: index, assetKey: action.assetKey, ...projection })
    transitions.push({
      actionIndex: index,
      assetKey: action.assetKey,
      previousState: projection.previousState,
      nextState: projection.nextState,
      classification: projection.classification,
    })
    actions.push({
      actionIndex: index,
      kind: action.kind,
      assetKey: action.assetKey,
      accountValueDelta: decimalString(actionAccountValueDelta),
      marginDelta: decimalString(actionMarginDelta),
      positionEffect: projection.classification,
      formulaIds: [scenarioFormulaId, 'hl.positions.fill.project'],
      sourceRefs: scenarioSourceRefs,
    })
  }
  return { ok: true, state, actions, fills, transitions }
}
