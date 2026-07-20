import { normalizePerpAssetRefAt } from '../core/asset-ref.js'
import type { Decimal40 } from '../core/decimal.js'
import {
  exactPlainArray,
  exactPlainObject,
  issue,
  normalizeDecimalAt,
  normalizeMathReason,
  ownDataValue,
  type ValidationIssue,
} from '../core/validation.js'
import type { MathReason } from '../model/index.js'
import type { NormalizedFill, NormalizedPosition, PerpPositionState } from '../positions/types.js'
import { normalizeFill, normalizePosition } from '../positions/validation.js'
import type {
  PerpAccountReplaySnapshot,
  PerpAccountServerFillEvidence,
  ReconciliationAsset,
} from './types.js'

export type DecimalValue = InstanceType<typeof Decimal40>

export interface NormalizedAsset {
  readonly publicValue: ReconciliationAsset
  readonly assetKey: string
}

export interface NormalizedSnapshotPosition {
  readonly asset: ReconciliationAsset
  readonly assetKey: string
  readonly state: PerpPositionState
  readonly normalizedState: NormalizedPosition
}

export interface NormalizedSnapshot {
  readonly cashBalance: string
  readonly cashBalanceDecimal: DecimalValue
  readonly positions: readonly NormalizedSnapshotPosition[]
  readonly publicValue: PerpAccountReplaySnapshot
}

export type NormalizedCompleteness =
  | { readonly kind: 'complete' }
  | { readonly kind: 'incomplete'; readonly reason: MathReason }

export type NormalizedEvidence =
  | { readonly kind: 'complete'; readonly eventCount: number }
  | { readonly kind: 'incomplete'; readonly reason: MathReason }

export type NormalizedReplayEvent =
  | {
      readonly kind: 'fill'
      readonly eventId: string
      readonly timestampMs: number
      readonly asset: ReconciliationAsset
      readonly assetKey: string
      readonly fill: NormalizedFill
      readonly serverFillEvidence: NormalizedServerFillEvidence | null
    }
  | {
      readonly kind: 'funding'
      readonly eventId: string
      readonly timestampMs: number
      readonly asset: ReconciliationAsset
      readonly assetKey: string
      readonly accountValueDelta: string
      readonly accountValueDeltaDecimal: DecimalValue
    }
  | {
      readonly kind: 'transfer'
      readonly eventId: string
      readonly timestampMs: number
      readonly accountValueDelta: string
      readonly accountValueDeltaDecimal: DecimalValue
    }

export interface NormalizedServerFillEvidence {
  readonly publicValue: PerpAccountServerFillEvidence
  readonly startPositionDecimal: DecimalValue
  readonly closedPnlDecimal: DecimalValue
  readonly feeDecimal: DecimalValue
}

function decimalString(value: DecimalValue): string {
  return value.isZero() ? '0' : value.toFixed()
}

export function normalizeAsset(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly asset: NormalizedAsset }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const normalized = normalizePerpAssetRefAt(input, path)
  if (!normalized.ok) return normalized

  return {
    ok: true,
    asset: {
      publicValue: normalized.value,
      assetKey: normalized.assetKey,
    },
  }
}

export function normalizeSnapshot(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly snapshot: NormalizedSnapshot }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['cashBalance', 'positions'], path)
  if (!shape.ok) return shape

  const cashBalance = normalizeDecimalAt(
    ownDataValue(shape.object, 'cashBalance'),
    `${path}/cashBalance`,
    'signed',
  )
  if (!cashBalance.ok) return cashBalance

  const positionsArray = exactPlainArray(
    ownDataValue(shape.object, 'positions'),
    `${path}/positions`,
    { maxLength: 2000 },
  )
  if (!positionsArray.ok) return positionsArray

  const seen = new Set<string>()
  const positions: NormalizedSnapshotPosition[] = []
  const publicPositions: PerpAccountReplaySnapshot['positions'][number][] = []
  for (let index = 0; index < positionsArray.values.length; index += 1) {
    const positionPath = `${path}/positions/${index}`
    const positionShape = exactPlainObject(
      positionsArray.values[index],
      ['asset', 'state'],
      positionPath,
    )
    if (!positionShape.ok) return positionShape

    const asset = normalizeAsset(
      ownDataValue(positionShape.object, 'asset'),
      `${positionPath}/asset`,
    )
    if (!asset.ok) return asset
    if (seen.has(asset.asset.assetKey)) {
      return {
        ok: false,
        issue: issue(
          'duplicate-asset-position',
          `${positionPath}/asset`,
          asset.asset.assetKey,
          'unique canonical asset identity',
        ),
      }
    }
    seen.add(asset.asset.assetKey)

    const state = normalizePosition(
      ownDataValue(positionShape.object, 'state'),
      `${positionPath}/state`,
    )
    if (!state.ok) return state

    const publicState =
      state.position.kind === 'flat'
        ? { kind: 'flat' as const }
        : {
            kind: 'open' as const,
            signedSize: state.position.signedSize,
            entryPrice: state.position.entryPrice,
          }
    positions.push({
      asset: asset.asset.publicValue,
      assetKey: asset.asset.assetKey,
      state: publicState,
      normalizedState: state.position,
    })
    publicPositions.push({ asset: asset.asset.publicValue, state: publicState })
  }

  return {
    ok: true,
    snapshot: {
      cashBalance: cashBalance.value,
      cashBalanceDecimal: cashBalance.decimal,
      positions,
      publicValue: { cashBalance: cashBalance.value, positions: publicPositions },
    },
  }
}

export function normalizeCompleteness(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly completeness: NormalizedCompleteness }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const completeShape = exactPlainObject(input, ['kind'], path)
  if (completeShape.ok && ownDataValue(completeShape.object, 'kind') === 'complete') {
    return { ok: true, completeness: { kind: 'complete' } }
  }

  const incompleteShape = exactPlainObject(input, ['kind', 'reason'], path)
  if (!incompleteShape.ok) return incompleteShape
  if (ownDataValue(incompleteShape.object, 'kind') !== 'incomplete') {
    return {
      ok: false,
      issue: issue(
        'invalid-completeness-kind',
        `${path}/kind`,
        ownDataValue(incompleteShape.object, 'kind'),
        'complete or incomplete',
      ),
    }
  }
  const reason = normalizeMathReason(
    ownDataValue(incompleteShape.object, 'reason'),
    `${path}/reason`,
  )
  if (!reason.ok) return reason
  return { ok: true, completeness: { kind: 'incomplete', reason: reason.reason } }
}

function normalizeEventHeader(
  input: Record<PropertyKey, unknown>,
  path: string,
):
  | { readonly ok: true; readonly eventId: string; readonly timestampMs: number }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const eventId = ownDataValue(input, 'eventId')
  if (typeof eventId !== 'string' || eventId.length === 0) {
    return {
      ok: false,
      issue: issue('invalid-event-id', `${path}/eventId`, eventId, 'non-empty string'),
    }
  }
  const rawTimestampMs = ownDataValue(input, 'timestampMs')
  if (
    typeof rawTimestampMs !== 'number' ||
    !Number.isSafeInteger(rawTimestampMs) ||
    rawTimestampMs < 0
  ) {
    return {
      ok: false,
      issue: issue(
        'invalid-timestamp-ms',
        `${path}/timestampMs`,
        rawTimestampMs,
        'non-negative safe integer',
      ),
    }
  }
  const timestampMs = rawTimestampMs
  return { ok: true, eventId, timestampMs }
}

function validateEventOrdering(
  event: NormalizedReplayEvent,
  path: string,
  seen: Set<string>,
  previousTimestampMs: number,
): { readonly ok: true } | { readonly ok: false; readonly issue: ValidationIssue } {
  if (seen.has(event.eventId)) {
    return {
      ok: false,
      issue: issue('duplicate-event-id', `${path}/eventId`, event.eventId, 'unique event id'),
    }
  }
  if (event.timestampMs < previousTimestampMs) {
    return {
      ok: false,
      issue: issue(
        'decreasing-event-timestamp',
        `${path}/timestampMs`,
        event.timestampMs,
        'nondecreasing event timestamps',
      ),
    }
  }
  return { ok: true }
}

function normalizeServerFillEvidence(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly evidence: NormalizedServerFillEvidence }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['startPosition', 'closedPnl', 'fee'], path)
  if (!shape.ok) return shape
  const startPosition = normalizeDecimalAt(
    ownDataValue(shape.object, 'startPosition'),
    `${path}/startPosition`,
    'signed',
  )
  if (!startPosition.ok) return startPosition
  const closedPnl = normalizeDecimalAt(
    ownDataValue(shape.object, 'closedPnl'),
    `${path}/closedPnl`,
    'signed',
  )
  if (!closedPnl.ok) return closedPnl
  const fee = normalizeDecimalAt(ownDataValue(shape.object, 'fee'), `${path}/fee`, 'signed')
  if (!fee.ok) return fee
  return {
    ok: true,
    evidence: {
      publicValue: {
        startPosition: startPosition.value,
        closedPnl: closedPnl.value,
        fee: fee.value,
      },
      startPositionDecimal: startPosition.decimal,
      closedPnlDecimal: closedPnl.decimal,
      feeDecimal: fee.decimal,
    },
  }
}

export function normalizeReplayEvents(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly events: readonly NormalizedReplayEvent[] }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const array = exactPlainArray(input, path, { maxLength: 5000 })
  if (!array.ok) return array

  const seen = new Set<string>()
  let previousTimestampMs = -1
  const events: NormalizedReplayEvent[] = []

  for (let index = 0; index < array.values.length; index += 1) {
    const eventPath = `${path}/${index}`
    const value = array.values[index]
    if (typeof value !== 'object' || value === null) {
      return {
        ok: false,
        issue: issue('invalid-input-shape', eventPath, value, 'plain event object'),
      }
    }
    const kind = ownDataValue(value, 'kind')
    if (kind === 'fill') {
      let shape = exactPlainObject(
        value,
        ['kind', 'eventId', 'timestampMs', 'asset', 'fill'],
        eventPath,
      )
      let hasServerFillEvidence = false
      if (!shape.ok) {
        const evidenceShape = exactPlainObject(
          value,
          ['kind', 'eventId', 'timestampMs', 'asset', 'fill', 'serverFillEvidence'],
          eventPath,
        )
        if (!evidenceShape.ok) return evidenceShape
        shape = evidenceShape
        hasServerFillEvidence = true
      }
      const header = normalizeEventHeader(shape.object, eventPath)
      if (!header.ok) return header
      const asset = normalizeAsset(ownDataValue(shape.object, 'asset'), `${eventPath}/asset`)
      if (!asset.ok) return asset
      const fill = normalizeFill(ownDataValue(shape.object, 'fill'), `${eventPath}/fill`)
      if (!fill.ok) return fill
      let serverFillEvidence: NormalizedServerFillEvidence | null = null
      if (hasServerFillEvidence) {
        const evidence = normalizeServerFillEvidence(
          ownDataValue(shape.object, 'serverFillEvidence'),
          `${eventPath}/serverFillEvidence`,
        )
        if (!evidence.ok) return evidence
        serverFillEvidence = evidence.evidence
      }
      const event: NormalizedReplayEvent = {
        kind: 'fill',
        eventId: header.eventId,
        timestampMs: header.timestampMs,
        asset: asset.asset.publicValue,
        assetKey: asset.asset.assetKey,
        fill: fill.fill,
        serverFillEvidence,
      }
      const ordering = validateEventOrdering(event, eventPath, seen, previousTimestampMs)
      if (!ordering.ok) return ordering
      events.push(event)
      seen.add(event.eventId)
      previousTimestampMs = event.timestampMs
    } else if (kind === 'funding') {
      const shape = exactPlainObject(
        value,
        ['kind', 'eventId', 'timestampMs', 'asset', 'accountValueDelta'],
        eventPath,
      )
      if (!shape.ok) return shape
      const header = normalizeEventHeader(shape.object, eventPath)
      if (!header.ok) return header
      const asset = normalizeAsset(ownDataValue(shape.object, 'asset'), `${eventPath}/asset`)
      if (!asset.ok) return asset
      const delta = normalizeDecimalAt(
        ownDataValue(shape.object, 'accountValueDelta'),
        `${eventPath}/accountValueDelta`,
        'signed',
      )
      if (!delta.ok) return delta
      const event: NormalizedReplayEvent = {
        kind: 'funding',
        eventId: header.eventId,
        timestampMs: header.timestampMs,
        asset: asset.asset.publicValue,
        assetKey: asset.asset.assetKey,
        accountValueDelta: delta.value,
        accountValueDeltaDecimal: delta.decimal,
      }
      const ordering = validateEventOrdering(event, eventPath, seen, previousTimestampMs)
      if (!ordering.ok) return ordering
      events.push(event)
      seen.add(event.eventId)
      previousTimestampMs = event.timestampMs
    } else if (kind === 'transfer') {
      const shape = exactPlainObject(
        value,
        ['kind', 'eventId', 'timestampMs', 'accountValueDelta'],
        eventPath,
      )
      if (!shape.ok) return shape
      const header = normalizeEventHeader(shape.object, eventPath)
      if (!header.ok) return header
      const delta = normalizeDecimalAt(
        ownDataValue(shape.object, 'accountValueDelta'),
        `${eventPath}/accountValueDelta`,
        'signed',
      )
      if (!delta.ok) return delta
      const event: NormalizedReplayEvent = {
        kind: 'transfer',
        eventId: header.eventId,
        timestampMs: header.timestampMs,
        accountValueDelta: delta.value,
        accountValueDeltaDecimal: delta.decimal,
      }
      const ordering = validateEventOrdering(event, eventPath, seen, previousTimestampMs)
      if (!ordering.ok) return ordering
      events.push(event)
      seen.add(event.eventId)
      previousTimestampMs = event.timestampMs
    } else {
      return {
        ok: false,
        issue: issue('invalid-event-kind', `${eventPath}/kind`, kind, 'fill, funding, or transfer'),
      }
    }
  }

  return { ok: true, events }
}

export function normalizeTolerances(
  input: unknown,
  path: string,
):
  | {
      readonly ok: true
      readonly tolerances: {
        readonly cashBalance: DecimalValue
        readonly signedSize: DecimalValue
        readonly entryPrice: DecimalValue
      }
    }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['cashBalance', 'signedSize', 'entryPrice'], path)
  if (!shape.ok) return shape
  const cashBalance = normalizeDecimalAt(
    ownDataValue(shape.object, 'cashBalance'),
    `${path}/cashBalance`,
    'non-negative',
  )
  if (!cashBalance.ok) return cashBalance
  const signedSize = normalizeDecimalAt(
    ownDataValue(shape.object, 'signedSize'),
    `${path}/signedSize`,
    'non-negative',
  )
  if (!signedSize.ok) return signedSize
  const entryPrice = normalizeDecimalAt(
    ownDataValue(shape.object, 'entryPrice'),
    `${path}/entryPrice`,
    'non-negative',
  )
  if (!entryPrice.ok) return entryPrice
  return {
    ok: true,
    tolerances: {
      cashBalance: cashBalance.decimal,
      signedSize: signedSize.decimal,
      entryPrice: entryPrice.decimal,
    },
  }
}

export function normalizeEvidence(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly evidence: NormalizedEvidence }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const completeShape = exactPlainObject(input, ['kind', 'eventCount'], path)
  if (completeShape.ok && ownDataValue(completeShape.object, 'kind') === 'complete') {
    const rawEventCount = ownDataValue(completeShape.object, 'eventCount')
    if (
      typeof rawEventCount !== 'number' ||
      !Number.isSafeInteger(rawEventCount) ||
      rawEventCount < 0
    ) {
      return {
        ok: false,
        issue: issue(
          'invalid-event-count',
          `${path}/eventCount`,
          rawEventCount,
          'non-negative safe integer',
        ),
      }
    }
    const eventCount = rawEventCount
    return { ok: true, evidence: { kind: 'complete', eventCount } }
  }

  const incompleteShape = exactPlainObject(input, ['kind', 'reason'], path)
  if (!incompleteShape.ok) return incompleteShape
  if (ownDataValue(incompleteShape.object, 'kind') !== 'incomplete') {
    return {
      ok: false,
      issue: issue(
        'invalid-evidence-kind',
        `${path}/kind`,
        ownDataValue(incompleteShape.object, 'kind'),
        'complete or incomplete',
      ),
    }
  }
  const reason = normalizeMathReason(
    ownDataValue(incompleteShape.object, 'reason'),
    `${path}/reason`,
  )
  if (!reason.ok) return reason
  return { ok: true, evidence: { kind: 'incomplete', reason: reason.reason } }
}

export { decimalString }
