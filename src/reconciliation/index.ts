import { Decimal40 } from '../core/decimal.js'
import { invalidInputResult, okResult } from '../core/result.js'
import { exactPlainObject, ownDataValue, type ValidationIssue } from '../core/validation.js'
import type { ConstraintCheck, MathResult } from '../model/index.js'
import { normalizedFromPublic, projectNormalizedFill } from '../positions/project.js'
import type { NormalizedPosition, PerpPositionState } from '../positions/types.js'
import {
  reconcileAssumptions,
  reconcileSourceRefs,
  reconciliationReason,
  reconciliationTrace,
  replayAssumptions,
  replaySourceRefs,
} from './trace.js'
import type {
  PerpAccountLedgerLine,
  PerpAccountPositionResidual,
  PerpAccountReconciliation,
  PerpAccountReplay,
  PerpAccountReplaySnapshot,
  PerpAccountReplayTransition,
  PerpAccountServerFillResiduals,
  ReconcilePerpAccountSnapshotInput,
  ReplayPerpAccountEventsInput,
} from './types.js'
import {
  type DecimalValue,
  decimalString,
  type NormalizedCompleteness,
  type NormalizedEvidence,
  type NormalizedServerFillEvidence,
  type NormalizedSnapshot,
  normalizeCompleteness,
  normalizeEvidence,
  normalizeReplayEvents,
  normalizeSnapshot,
  normalizeTolerances,
} from './validation.js'

export type {
  PerpAccountLedgerLine,
  PerpAccountPositionResidual,
  PerpAccountReconciliation,
  PerpAccountReconciliationEvidence,
  PerpAccountReconciliationTolerances,
  PerpAccountReplay,
  PerpAccountReplayEvent,
  PerpAccountReplayPosition,
  PerpAccountReplaySnapshot,
  PerpAccountReplayTotals,
  PerpAccountReplayTransition,
  PerpAccountServerFillEvidence,
  PerpAccountServerFillResiduals,
  ReconcilePerpAccountSnapshotInput,
  ReconciliationAsset,
  ReconciliationCompleteness,
  ReplayPerpAccountEventsInput,
} from './types.js'

const replayFormulaId = 'hl.reconciliation.perp-account.replay'
const reconcileFormulaId = 'hl.reconciliation.perp-account.reconcile'

function invalid<T>(
  formulaId: string,
  sourceRefs: readonly string[],
  issue: ValidationIssue,
  authority: 'local-exact' | 'server-authoritative',
): MathResult<T> {
  return invalidInputResult(
    [issue],
    reconciliationTrace({
      formulaId,
      authority,
      completion: { status: 'incomplete', reason: reconciliationReason(issue.code, issue.path) },
      normalizedInputs: {},
      sourceRefs,
    }),
  )
}

function positionState(position: NormalizedPosition): PerpPositionState {
  return position.kind === 'flat'
    ? { kind: 'flat' }
    : { kind: 'open', signedSize: position.signedSize, entryPrice: position.entryPrice }
}

function signedSizeForEvidence(position: NormalizedPosition): DecimalValue {
  return position.kind === 'flat' ? new Decimal40(0) : position.signedSizeDecimal
}

function serverFillResiduals(
  evidence: NormalizedServerFillEvidence | null,
  previousState: NormalizedPosition,
  projection: PerpAccountReplayTransition & { readonly kind: 'fill' },
): PerpAccountServerFillResiduals {
  if (evidence === null) return { status: 'not-evaluated' }
  return {
    status: 'evaluated',
    startPositionResidual: decimalString(
      evidence.startPositionDecimal.minus(signedSizeForEvidence(previousState)),
    ),
    serverClosedPnlMinusProjectedGrossRealizedPnl: decimalString(
      evidence.closedPnlDecimal.minus(projection.projection.grossRealizedPnl),
    ),
    serverClosedPnlMinusMathNetClosedPnl: decimalString(
      evidence.closedPnlDecimal.minus(projection.projection.closedPnl),
    ),
    serverFeeMinusProjectionFeeAmount: decimalString(
      evidence.feeDecimal.minus(projection.projection.feeAmount),
    ),
  }
}

function snapshotFromState(
  cashBalance: DecimalValue,
  positions: ReadonlyMap<
    string,
    {
      readonly asset: PerpAccountReplaySnapshot['positions'][number]['asset']
      readonly state: NormalizedPosition
    }
  >,
): PerpAccountReplaySnapshot {
  const outputPositions: PerpAccountReplaySnapshot['positions'][number][] = []
  for (const position of positions.values()) {
    outputPositions.push({ asset: position.asset, state: positionState(position.state) })
  }
  return { cashBalance: decimalString(cashBalance), positions: outputPositions }
}

function normalizeReplayInput(input: ReplayPerpAccountEventsInput):
  | {
      readonly ok: true
      readonly snapshot: NormalizedSnapshot
      readonly completeness: NormalizedCompleteness
      readonly rawEvents: unknown
    }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['snapshot', 'events', 'completeness'], '')
  if (!shape.ok) return shape
  const snapshot = normalizeSnapshot(ownDataValue(shape.object, 'snapshot'), '/snapshot')
  if (!snapshot.ok) return snapshot
  const completeness = normalizeCompleteness(
    ownDataValue(shape.object, 'completeness'),
    '/completeness',
  )
  if (!completeness.ok) return completeness
  return {
    ok: true,
    snapshot: snapshot.snapshot,
    completeness: completeness.completeness,
    rawEvents: ownDataValue(shape.object, 'events'),
  }
}

/**
 * Replays an ordered, complete event set (fills, funding, transfers) over a base snapshot,
 * projecting cash as `base cash + realized PnL + fees + funding + transfers` and positions
 * through the M2 fill transition. Emits per-event transitions, an objective ledger, totals, and
 * neutral residuals against any supplied raw server fill evidence. Declared-incomplete history
 * returns `indeterminate` with no partial replay.
 *
 * @public
 */
export function replayPerpAccountEvents(
  input: ReplayPerpAccountEventsInput,
): MathResult<PerpAccountReplay> {
  const base = normalizeReplayInput(input)
  if (!base.ok) return invalid(replayFormulaId, replaySourceRefs, base.issue, 'local-exact')

  if (base.completeness.kind === 'incomplete') {
    return {
      value: { status: 'indeterminate', reason: base.completeness.reason },
      trace: reconciliationTrace({
        formulaId: replayFormulaId,
        authority: 'local-exact',
        completion: { status: 'incomplete', reason: base.completeness.reason },
        normalizedInputs: {
          initialPositionCount: base.snapshot.positions.length,
          completenessKind: base.completeness.kind,
        },
        sourceRefs: replaySourceRefs,
      }),
    }
  }

  const events = normalizeReplayEvents(base.rawEvents, '/events')
  if (!events.ok) return invalid(replayFormulaId, replaySourceRefs, events.issue, 'local-exact')

  const positions = new Map<
    string,
    { asset: PerpAccountReplaySnapshot['positions'][number]['asset']; state: NormalizedPosition }
  >()
  for (const position of base.snapshot.positions) {
    positions.set(position.assetKey, { asset: position.asset, state: position.normalizedState })
  }

  const ledger: PerpAccountLedgerLine[] = []
  const transitions: PerpAccountReplayTransition[] = []
  let cashBalance = base.snapshot.cashBalanceDecimal
  let realizedPnl = new Decimal40(0)
  let feeAccountValueDelta = new Decimal40(0)
  let fundingAccountValueDelta = new Decimal40(0)
  let transferAccountValueDelta = new Decimal40(0)

  for (const event of events.events) {
    if (event.kind === 'fill') {
      const current = positions.get(event.assetKey) ?? {
        asset: event.asset,
        state: { kind: 'flat' as const },
      }
      const projection = projectNormalizedFill(current.state, event.fill)
      const gross = new Decimal40(projection.grossRealizedPnl)
      const feeDelta = new Decimal40(projection.feeAccountValueDelta)
      const cashDelta = gross.plus(feeDelta)
      cashBalance = cashBalance.plus(cashDelta)
      realizedPnl = realizedPnl.plus(gross)
      feeAccountValueDelta = feeAccountValueDelta.plus(feeDelta)
      positions.set(event.assetKey, {
        asset: event.asset,
        state: normalizedFromPublic(projection.nextState),
      })
      ledger.push(
        {
          kind: 'realized-pnl',
          eventId: event.eventId,
          timestampMs: event.timestampMs,
          assetKey: event.assetKey,
          amount: decimalString(gross),
        },
        {
          kind: 'trade-fee',
          eventId: event.eventId,
          timestampMs: event.timestampMs,
          assetKey: event.assetKey,
          amount: decimalString(feeDelta),
        },
      )
      const fillTransition = {
        kind: 'fill',
        eventId: event.eventId,
        timestampMs: event.timestampMs,
        assetKey: event.assetKey,
        projection,
        cashDelta: decimalString(cashDelta),
        serverFillEvidence: event.serverFillEvidence?.publicValue ?? null,
        serverFillResiduals: { status: 'not-evaluated' },
      } as const
      transitions.push({
        ...fillTransition,
        serverFillResiduals: serverFillResiduals(
          event.serverFillEvidence,
          current.state,
          fillTransition,
        ),
      })
    } else if (event.kind === 'funding') {
      cashBalance = cashBalance.plus(event.accountValueDeltaDecimal)
      fundingAccountValueDelta = fundingAccountValueDelta.plus(event.accountValueDeltaDecimal)
      ledger.push({
        kind: 'funding',
        eventId: event.eventId,
        timestampMs: event.timestampMs,
        assetKey: event.assetKey,
        amount: event.accountValueDelta,
      })
      transitions.push({
        kind: 'funding',
        eventId: event.eventId,
        timestampMs: event.timestampMs,
        assetKey: event.assetKey,
        cashDelta: event.accountValueDelta,
      })
    } else {
      cashBalance = cashBalance.plus(event.accountValueDeltaDecimal)
      transferAccountValueDelta = transferAccountValueDelta.plus(event.accountValueDeltaDecimal)
      ledger.push({
        kind: 'transfer',
        eventId: event.eventId,
        timestampMs: event.timestampMs,
        amount: event.accountValueDelta,
      })
      transitions.push({
        kind: 'transfer',
        eventId: event.eventId,
        timestampMs: event.timestampMs,
        cashDelta: event.accountValueDelta,
      })
    }
  }

  const final = snapshotFromState(cashBalance, positions)
  const netCashDelta = cashBalance.minus(base.snapshot.cashBalanceDecimal)
  const data: PerpAccountReplay = {
    initial: base.snapshot.publicValue,
    final,
    transitions,
    ledger,
    totals: {
      realizedPnl: decimalString(realizedPnl),
      feeAccountValueDelta: decimalString(feeAccountValueDelta),
      fundingAccountValueDelta: decimalString(fundingAccountValueDelta),
      transferAccountValueDelta: decimalString(transferAccountValueDelta),
      netCashDelta: decimalString(netCashDelta),
    },
  }

  return okResult(
    data,
    reconciliationTrace({
      formulaId: replayFormulaId,
      authority: 'local-exact',
      completion: { status: 'complete' },
      normalizedInputs: {
        initialPositionCount: base.snapshot.positions.length,
        eventCount: events.events.length,
      },
      intermediates: [
        { stepId: 'ledger-line-count', output: ledger.length },
        { stepId: 'net-cash-delta', output: data.totals.netCashDelta },
      ],
      sourceRefs: replaySourceRefs,
      assumptions: replayAssumptions,
    }),
  )
}

function normalizeReconcileInput(input: ReconcilePerpAccountSnapshotInput):
  | {
      readonly ok: true
      readonly projected: NormalizedSnapshot
      readonly observed: NormalizedSnapshot
      readonly tolerances: {
        readonly cashBalance: DecimalValue
        readonly signedSize: DecimalValue
        readonly entryPrice: DecimalValue
      }
      readonly evidence: NormalizedEvidence
    }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['projected', 'observed', 'tolerances', 'evidence'], '')
  if (!shape.ok) return shape
  const evidence = normalizeEvidence(ownDataValue(shape.object, 'evidence'), '/evidence')
  if (!evidence.ok) return evidence
  const projected = normalizeSnapshot(ownDataValue(shape.object, 'projected'), '/projected')
  if (!projected.ok) return projected
  const observed = normalizeSnapshot(ownDataValue(shape.object, 'observed'), '/observed')
  if (!observed.ok) return observed
  const tolerances = normalizeTolerances(ownDataValue(shape.object, 'tolerances'), '/tolerances')
  if (!tolerances.ok) return tolerances
  return {
    ok: true,
    projected: projected.snapshot,
    observed: observed.snapshot,
    tolerances: tolerances.tolerances,
    evidence: evidence.evidence,
  }
}

function numericCheck(
  ruleId: string,
  residual: DecimalValue,
  tolerance: DecimalValue,
  path: string,
): ConstraintCheck {
  if (residual.abs().lte(tolerance)) return { status: 'satisfied', ruleId }
  return {
    status: 'violated',
    ruleId,
    violation: {
      ruleId,
      code: 'residual-outside-tolerance',
      path,
      actual: decimalString(residual),
      limit: decimalString(tolerance),
    },
  }
}

function stateMismatchCheck(ruleId: string, path: string): ConstraintCheck {
  return {
    status: 'violated',
    ruleId,
    violation: {
      ruleId,
      code: 'position-state-mismatch',
      path,
    },
  }
}

/**
 * Diffs a projected snapshot against the observed one: cash residual
 * `observed - projected`, per-asset signed-size/entry-price residuals joined by canonical
 * identity, and tolerance checks (`abs(residual) <= tolerance`). `corrected` is always the
 * observed snapshot under server authority; residuals identify differences, never causes.
 * Incomplete evidence returns `indeterminate`.
 *
 * @public
 */
export function reconcilePerpAccountSnapshot(
  input: ReconcilePerpAccountSnapshotInput,
): MathResult<PerpAccountReconciliation> {
  const normalized = normalizeReconcileInput(input)
  if (!normalized.ok) {
    return invalid(reconcileFormulaId, reconcileSourceRefs, normalized.issue, 'local-exact')
  }

  if (normalized.evidence.kind === 'incomplete') {
    return {
      value: { status: 'indeterminate', reason: normalized.evidence.reason },
      trace: reconciliationTrace({
        formulaId: reconcileFormulaId,
        authority: 'local-exact',
        completion: { status: 'incomplete', reason: normalized.evidence.reason },
        normalizedInputs: {
          evidenceKind: normalized.evidence.kind,
          evidenceReasonCode: normalized.evidence.reason.code,
          evidenceReasonPath: normalized.evidence.reason.path ?? '',
        },
        sourceRefs: reconcileSourceRefs,
      }),
    }
  }

  const checks: ConstraintCheck[] = []
  const cashBalanceResidualDecimal = normalized.observed.cashBalanceDecimal.minus(
    normalized.projected.cashBalanceDecimal,
  )
  checks.push(
    numericCheck(
      'hl.reconciliation.cash-balance-residual',
      cashBalanceResidualDecimal,
      normalized.tolerances.cashBalance,
      '/cashBalance',
    ),
  )

  const projectedByKey = new Map(
    normalized.projected.positions.map((position) => [position.assetKey, position]),
  )
  const observedByKey = new Map(
    normalized.observed.positions.map((position) => [position.assetKey, position]),
  )
  const orderedKeys = [
    ...normalized.projected.positions.map((position) => position.assetKey),
    ...normalized.observed.positions
      .map((position) => position.assetKey)
      .filter((assetKey) => !projectedByKey.has(assetKey)),
  ]
  const positions: PerpAccountPositionResidual[] = []

  for (const assetKey of orderedKeys) {
    const projected = projectedByKey.get(assetKey)
    const observed = observedByKey.get(assetKey)
    if (projected === undefined && observed !== undefined) {
      positions.push({
        assetKey,
        status: 'missing-projected',
        observedState: observed.state,
      })
      checks.push(stateMismatchCheck('hl.reconciliation.position-state', `/positions/${assetKey}`))
      continue
    }
    if (projected !== undefined && observed === undefined) {
      positions.push({
        assetKey,
        status: 'missing-observed',
        projectedState: projected.state,
      })
      checks.push(stateMismatchCheck('hl.reconciliation.position-state', `/positions/${assetKey}`))
      continue
    }
    const matchedProjected = projected as NonNullable<typeof projected>
    const matchedObserved = observed as NonNullable<typeof observed>
    if (
      matchedProjected.normalizedState.kind === 'flat' &&
      matchedObserved.normalizedState.kind === 'flat'
    ) {
      positions.push({ assetKey, status: 'flat' })
      continue
    }
    if (
      matchedProjected.normalizedState.kind !== 'open' ||
      matchedObserved.normalizedState.kind !== 'open'
    ) {
      positions.push({
        assetKey,
        status: 'state-mismatch',
        projectedState: matchedProjected.state,
        observedState: matchedObserved.state,
      })
      checks.push(stateMismatchCheck('hl.reconciliation.position-state', `/positions/${assetKey}`))
      continue
    }

    const signedSizeResidual = matchedObserved.normalizedState.signedSizeDecimal.minus(
      matchedProjected.normalizedState.signedSizeDecimal,
    )
    const entryPriceResidual = matchedObserved.normalizedState.entryPriceDecimal.minus(
      matchedProjected.normalizedState.entryPriceDecimal,
    )
    positions.push({
      assetKey,
      status: 'numeric-residual',
      signedSizeResidual: decimalString(signedSizeResidual),
      entryPriceResidual: decimalString(entryPriceResidual),
    })
    checks.push(
      numericCheck(
        'hl.reconciliation.position-signed-size-residual',
        signedSizeResidual,
        normalized.tolerances.signedSize,
        `/positions/${assetKey}/signedSize`,
      ),
      numericCheck(
        'hl.reconciliation.position-entry-price-residual',
        entryPriceResidual,
        normalized.tolerances.entryPrice,
        `/positions/${assetKey}/entryPrice`,
      ),
    )
  }

  const data: PerpAccountReconciliation = {
    cashBalanceResidual: decimalString(cashBalanceResidualDecimal),
    positions,
    checks,
    corrected: { authority: 'server-authoritative', snapshot: normalized.observed.publicValue },
  }

  return okResult(
    data,
    reconciliationTrace({
      formulaId: reconcileFormulaId,
      authority: 'local-exact',
      completion: { status: 'complete' },
      normalizedInputs: {
        projectedPositionCount: normalized.projected.positions.length,
        observedPositionCount: normalized.observed.positions.length,
        eventCount: normalized.evidence.eventCount,
      },
      intermediates: [
        { stepId: 'cash-balance-residual', output: data.cashBalanceResidual },
        { stepId: 'position-residual-count', output: data.positions.length },
      ],
      sourceRefs: reconcileSourceRefs,
      assumptions: reconcileAssumptions,
    }),
  )
}
