import { Decimal40 } from '../core/decimal.js'
import { invalidInputResult, okResult } from '../core/result.js'
import {
  exactPlainObject,
  normalizeDecimalAt,
  ownDataValue,
  type ValidationIssue,
} from '../core/validation.js'
import type { MathResult } from '../model/index.js'
import {
  breakEvenAssumptions,
  fillAssumptions,
  fillInputs,
  flatBreakEvenAssumptions,
  positionTrace,
  sequenceAssumptions,
  sequenceInputs,
  unrealizedAssumptions,
  unrealizedInputs,
} from './trace.js'
import type {
  CalculatePerpBreakEvenPriceInput,
  CalculatePerpUnrealizedPnlInput,
  NormalizedFill,
  NormalizedPosition,
  PerpBreakEvenPrice,
  PerpFillProjection,
  PerpFillSequenceProjection,
  PerpPositionState,
  PerpUnrealizedPnl,
  ProjectPerpFillInput,
  ProjectPerpFillSequenceInput,
} from './types.js'
import { normalizeFill, normalizeFillArray, normalizePosition, reason } from './validation.js'

const unrealizedSourceRefs = [
  'HLM.SPEC.POSITIONS.UNREALIZED_PNL.V1',
  'HL.DOC.ENTRY_PNL.2026-07-19',
  'HL.DOC.INFO.PERP.2026-07-19',
] as const

const fillSourceRefs = [
  'HLM.SPEC.POSITIONS.FILL_PROJECT.V1',
  'HL.DOC.ENTRY_PNL.2026-07-19',
  'HL.DOC.INFO.USER_FILLS.2026-07-19',
] as const

const sequenceSourceRefs = [
  'HLM.SPEC.POSITIONS.SEQUENCE_PROJECT.V1',
  'HL.DOC.INFO.USER_FILLS.2026-07-19',
] as const

const breakEvenSourceRefs = [
  'HLM.SPEC.POSITIONS.BREAK_EVEN.V1',
  'HL.DOC.ENTRY_PNL.2026-07-19',
] as const

function decimalString(value: InstanceType<typeof Decimal40>): string {
  return value.isZero() ? '0' : value.toFixed()
}

function publicState(position: NormalizedPosition): PerpPositionState {
  if (position.kind === 'flat') return { kind: 'flat' }
  return { kind: 'open', signedSize: position.signedSize, entryPrice: position.entryPrice }
}

function openState(
  signedSize: InstanceType<typeof Decimal40>,
  entryPrice: InstanceType<typeof Decimal40>,
): PerpPositionState {
  return {
    kind: 'open',
    signedSize: decimalString(signedSize),
    entryPrice: decimalString(entryPrice),
  }
}

export function normalizedFromPublic(position: PerpPositionState): NormalizedPosition {
  if (position.kind === 'flat') return { kind: 'flat' }
  return {
    kind: 'open',
    signedSize: position.signedSize,
    signedSizeDecimal: new Decimal40(position.signedSize),
    entryPrice: position.entryPrice,
    entryPriceDecimal: new Decimal40(position.entryPrice),
  }
}

function invalid<T>(
  formulaId: string,
  sources: readonly string[],
  issue: ValidationIssue,
): MathResult<T> {
  return invalidInputResult(
    [issue],
    positionTrace(
      formulaId,
      sources,
      {},
      { status: 'incomplete', reason: reason(issue.code, issue.path) },
    ),
  )
}

function normalizeUnrealizedInput(input: CalculatePerpUnrealizedPnlInput):
  | {
      readonly ok: true
      readonly position: NormalizedPosition
      readonly markPrice: string
      readonly markPriceDecimal: InstanceType<typeof Decimal40>
    }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['position', 'markPrice'], '')
  if (!shape.ok) return shape

  const position = normalizePosition(ownDataValue(shape.object, 'position'), '/position')
  if (!position.ok) return position

  const markPrice = normalizeDecimalAt(
    ownDataValue(shape.object, 'markPrice'),
    '/markPrice',
    'positive',
  )
  if (!markPrice.ok) return markPrice

  return {
    ok: true,
    position: position.position,
    markPrice: markPrice.value,
    markPriceDecimal: markPrice.decimal,
  }
}

/**
 * Computes `unrealizedPnl = signedSize * (markPrice - entryPrice)` plus
 * `positionValue = abs(signedSize) * markPrice` for an open position at the caller's frozen mark.
 * A flat position is valid but returns `not-applicable`; ROE is not returned because margin used
 * belongs to the margin snapshot.
 *
 * @public
 */
export function calculatePerpUnrealizedPnl(
  input: CalculatePerpUnrealizedPnlInput,
): MathResult<PerpUnrealizedPnl> {
  const normalized = normalizeUnrealizedInput(input)
  if (!normalized.ok) {
    return invalid('hl.positions.unrealized-pnl.calculate', unrealizedSourceRefs, normalized.issue)
  }

  const inputs = unrealizedInputs(normalized.position, normalized.markPrice)
  if (normalized.position.kind === 'flat') {
    return {
      value: { status: 'not-applicable', reason: reason('flat-position', '/position') },
      trace: positionTrace(
        'hl.positions.unrealized-pnl.calculate',
        unrealizedSourceRefs,
        inputs,
        { status: 'complete' },
        [],
        [],
        unrealizedAssumptions,
      ),
    }
  }

  const size = normalized.position.signedSizeDecimal
  const absSize = size.abs()
  const positionValue = absSize.mul(normalized.markPriceDecimal)
  const unrealizedPnl = size.mul(
    normalized.markPriceDecimal.minus(normalized.position.entryPriceDecimal),
  )
  const data = {
    side: size.isPositive() ? 'long' : 'short',
    absoluteSize: decimalString(absSize),
    positionValue: decimalString(positionValue),
    unrealizedPnl: decimalString(unrealizedPnl),
  } as const

  return okResult(
    data,
    positionTrace(
      'hl.positions.unrealized-pnl.calculate',
      unrealizedSourceRefs,
      inputs,
      { status: 'complete' },
      [
        {
          stepId: 'position-value',
          inputs: { absoluteSize: data.absoluteSize, markPrice: normalized.markPrice },
          output: data.positionValue,
        },
        {
          stepId: 'unrealized-pnl',
          inputs: {
            signedSize: normalized.position.signedSize,
            markPrice: normalized.markPrice,
            entryPrice: normalized.position.entryPrice,
          },
          output: data.unrealizedPnl,
        },
      ],
      [],
      unrealizedAssumptions,
    ),
  )
}

function normalizeProjectInput(
  input: ProjectPerpFillInput,
):
  | { readonly ok: true; readonly position: NormalizedPosition; readonly fill: NormalizedFill }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['position', 'fill'], '')
  if (!shape.ok) return shape

  const position = normalizePosition(ownDataValue(shape.object, 'position'), '/position')
  if (!position.ok) return position

  const fill = normalizeFill(ownDataValue(shape.object, 'fill'), '/fill')
  if (!fill.ok) return fill

  return { ok: true, position: position.position, fill: fill.fill }
}

export function projectNormalizedFill(
  position: NormalizedPosition,
  fill: NormalizedFill,
): PerpFillProjection {
  const previousState = publicState(position)
  const fillSign = fill.side === 'buy' ? new Decimal40(1) : new Decimal40(-1)
  const fillSignedSize = fill.sizeDecimal.mul(fillSign)
  const feeAmount = fill.feeAmountDecimal
  const feeAccountValueDelta = feeAmount.neg()

  if (fill.sizeDecimal.isZero()) {
    return {
      classification: 'no-op',
      closedSize: '0',
      openedSize: '0',
      previousState,
      nextState: previousState,
      fillSignedSize: '0',
      grossRealizedPnl: '0',
      feeAmount: '0',
      feeAccountValueDelta: '0',
      closedPnl: '0',
    }
  }

  if (position.kind === 'flat') {
    const nextState = openState(fillSignedSize, fill.priceDecimal)
    return {
      classification: 'open',
      closedSize: '0',
      openedSize: fill.size,
      previousState,
      nextState,
      fillSignedSize: decimalString(fillSignedSize),
      grossRealizedPnl: '0',
      feeAmount: decimalString(feeAmount),
      feeAccountValueDelta: decimalString(feeAccountValueDelta),
      closedPnl: decimalString(feeAccountValueDelta),
    }
  }

  const oldSize = position.signedSizeDecimal
  const oldAbsSize = oldSize.abs()
  const sameDirection = oldSize.mul(fillSignedSize).isPositive()

  if (sameDirection) {
    const nextSignedSize = oldSize.plus(fillSignedSize)
    const weightedEntry = oldAbsSize
      .mul(position.entryPriceDecimal)
      .plus(fill.sizeDecimal.mul(fill.priceDecimal))
      .div(nextSignedSize.abs())
    return {
      classification: 'increase',
      closedSize: '0',
      openedSize: fill.size,
      previousState,
      nextState: openState(nextSignedSize, weightedEntry),
      fillSignedSize: decimalString(fillSignedSize),
      grossRealizedPnl: '0',
      feeAmount: decimalString(feeAmount),
      feeAccountValueDelta: decimalString(feeAccountValueDelta),
      closedPnl: decimalString(feeAccountValueDelta),
    }
  }

  const closedSize = Decimal40.min(oldAbsSize, fill.sizeDecimal)
  const openedSize = fill.sizeDecimal.minus(closedSize)
  const sideSign = oldSize.isPositive() ? new Decimal40(1) : new Decimal40(-1)
  const grossRealizedPnl = sideSign
    .mul(fill.priceDecimal.minus(position.entryPriceDecimal))
    .mul(closedSize)
  const closedPnl = grossRealizedPnl.plus(feeAccountValueDelta)

  if (fill.sizeDecimal.lessThan(oldAbsSize)) {
    const nextSignedSize = oldSize.plus(fillSignedSize)
    return {
      classification: 'reduce',
      closedSize: decimalString(closedSize),
      openedSize: '0',
      previousState,
      nextState: openState(nextSignedSize, position.entryPriceDecimal),
      fillSignedSize: decimalString(fillSignedSize),
      grossRealizedPnl: decimalString(grossRealizedPnl),
      feeAmount: decimalString(feeAmount),
      feeAccountValueDelta: decimalString(feeAccountValueDelta),
      closedPnl: decimalString(closedPnl),
    }
  }

  if (fill.sizeDecimal.equals(oldAbsSize)) {
    return {
      classification: 'close',
      closedSize: decimalString(closedSize),
      openedSize: '0',
      previousState,
      nextState: { kind: 'flat' },
      fillSignedSize: decimalString(fillSignedSize),
      grossRealizedPnl: decimalString(grossRealizedPnl),
      feeAmount: decimalString(feeAmount),
      feeAccountValueDelta: decimalString(feeAccountValueDelta),
      closedPnl: decimalString(closedPnl),
    }
  }

  const nextSignedSize = openedSize.mul(fillSign)
  return {
    classification: 'flip',
    closedSize: decimalString(closedSize),
    openedSize: decimalString(openedSize),
    previousState,
    nextState: openState(nextSignedSize, fill.priceDecimal),
    fillSignedSize: decimalString(fillSignedSize),
    grossRealizedPnl: decimalString(grossRealizedPnl),
    feeAmount: decimalString(feeAmount),
    feeAccountValueDelta: decimalString(feeAccountValueDelta),
    closedPnl: decimalString(closedPnl),
  }
}

/**
 * Applies one fill to a position state and classifies the transition (`open`, `increase`,
 * `reduce`, `close`, `flip`, or zero-size `no-op`). Increases use size-weighted entry
 * `(abs(oldSize) * oldEntry + fillSize * fillPrice) / abs(newSize)`; the closing portion realizes
 * `grossRealizedPnl = sign(oldSize) * (fillPrice - oldEntry) * closedSize` and
 * `closedPnl = grossRealizedPnl - feeAmount`, with the fee computed on the full fill.
 *
 * @public
 */
export function projectPerpFill(input: ProjectPerpFillInput): MathResult<PerpFillProjection> {
  const normalized = normalizeProjectInput(input)
  if (!normalized.ok) {
    return invalid('hl.positions.fill.project', fillSourceRefs, normalized.issue)
  }

  const projection = projectNormalizedFill(normalized.position, normalized.fill)
  return okResult(
    projection,
    positionTrace(
      'hl.positions.fill.project',
      fillSourceRefs,
      fillInputs(normalized.position, normalized.fill),
      { status: 'complete' },
      [
        { stepId: 'classification', output: projection.classification },
        {
          stepId: 'closed-pnl',
          inputs: {
            grossRealizedPnl: projection.grossRealizedPnl,
            feeAccountValueDelta: projection.feeAccountValueDelta,
          },
          output: projection.closedPnl,
        },
      ],
      projection.classification === 'increase'
        ? [
            {
              path: '/value/data/nextState/entryPrice',
              input: 'weighted-entry',
              output: (
                projection.nextState as { readonly kind: 'open'; readonly entryPrice: string }
              ).entryPrice,
              mode: 'half-even',
              reasonCode: 'decimal40-division',
            },
          ]
        : [],
      fillAssumptions,
    ),
  )
}

function normalizeSequenceInput(input: ProjectPerpFillSequenceInput):
  | {
      readonly ok: true
      readonly position: NormalizedPosition
      readonly fills: readonly NormalizedFill[]
    }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['position', 'fills'], '')
  if (!shape.ok) return shape

  const position = normalizePosition(ownDataValue(shape.object, 'position'), '/position')
  if (!position.ok) return position

  const fills = normalizeFillArray(ownDataValue(shape.object, 'fills'), '/fills')
  if (!fills.ok) return fills

  return { ok: true, position: position.position, fills: fills.fills }
}

/**
 * Folds an ordered fill page (max 2000, one `userFillsByTime` window) through the single-fill
 * transition, returning every transition, the final state, and exact totals of gross realized PnL,
 * fees, and closed PnL. Fills are never sorted or truncated; compose larger histories by feeding
 * one page's final state into the next call. Empty input is an `ok` identity.
 *
 * @public
 */
export function projectPerpFillSequence(
  input: ProjectPerpFillSequenceInput,
): MathResult<PerpFillSequenceProjection> {
  const normalized = normalizeSequenceInput(input)
  if (!normalized.ok) {
    return invalid('hl.positions.sequence.project', sequenceSourceRefs, normalized.issue)
  }

  const transitions: PerpFillProjection[] = []
  let state = normalized.position
  let grossRealizedPnlTotal = new Decimal40(0)
  let feeAmountTotal = new Decimal40(0)
  let feeAccountValueDeltaTotal = new Decimal40(0)
  let closedPnlTotal = new Decimal40(0)

  for (const fill of normalized.fills) {
    const transition = projectNormalizedFill(state, fill)
    transitions.push(transition)
    grossRealizedPnlTotal = grossRealizedPnlTotal.plus(transition.grossRealizedPnl)
    feeAmountTotal = feeAmountTotal.plus(transition.feeAmount)
    feeAccountValueDeltaTotal = feeAccountValueDeltaTotal.plus(transition.feeAccountValueDelta)
    closedPnlTotal = closedPnlTotal.plus(transition.closedPnl)
    state = normalizedFromPublic(transition.nextState)
  }

  const data = {
    transitions,
    finalState: publicState(state),
    grossRealizedPnlTotal: decimalString(grossRealizedPnlTotal),
    feeAmountTotal: decimalString(feeAmountTotal),
    feeAccountValueDeltaTotal: decimalString(feeAccountValueDeltaTotal),
    closedPnlTotal: decimalString(closedPnlTotal),
  }

  return okResult(
    data,
    positionTrace(
      'hl.positions.sequence.project',
      sequenceSourceRefs,
      sequenceInputs(normalized.position, normalized.fills.length),
      { status: 'complete' },
      [
        { stepId: 'fill-count', output: normalized.fills.length },
        { stepId: 'closed-pnl-total', output: data.closedPnlTotal },
      ],
      [
        ...(transitions.some((transition) => transition.classification === 'increase')
          ? [
              {
                path: '/value/data/transitions/*/nextState/entryPrice',
                input: 'weighted-entry',
                output: 'decimal40',
                mode: 'half-even' as const,
                reasonCode: 'decimal40-division',
              },
            ]
          : []),
      ],
      sequenceAssumptions,
    ),
  )
}

function normalizeBreakEvenInput(input: CalculatePerpBreakEvenPriceInput):
  | {
      readonly ok: true
      readonly position: NormalizedPosition
      readonly cumulativeCost: string
      readonly cumulativeCostDecimal: InstanceType<typeof Decimal40>
    }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['position', 'cumulativeCost'], '')
  if (!shape.ok) return shape

  const position = normalizePosition(ownDataValue(shape.object, 'position'), '/position')
  if (!position.ok) return position

  const cumulativeCost = normalizeDecimalAt(
    ownDataValue(shape.object, 'cumulativeCost'),
    '/cumulativeCost',
    'signed',
  )
  if (!cumulativeCost.ok) return cumulativeCost

  return {
    ok: true,
    position: position.position,
    cumulativeCost: cumulativeCost.value,
    cumulativeCostDecimal: cumulativeCost.decimal,
  }
}

/**
 * Computes `breakEvenPrice = entryPrice + cumulativeCost / signedSize` for the current open
 * position and the caller-supplied signed cost only (future fees/funding excluded). Flat returns
 * `not-applicable`; a computed non-positive price returns `indeterminate`.
 *
 * @public
 */
export function calculatePerpBreakEvenPrice(
  input: CalculatePerpBreakEvenPriceInput,
): MathResult<PerpBreakEvenPrice> {
  const normalized = normalizeBreakEvenInput(input)
  if (!normalized.ok) {
    return invalid('hl.positions.break-even-price.calculate', breakEvenSourceRefs, normalized.issue)
  }

  const inputs = {
    ...unrealizedInputs(normalized.position, undefined),
    cumulativeCost: normalized.cumulativeCost,
  }
  if (normalized.position.kind === 'flat') {
    return {
      value: { status: 'not-applicable', reason: reason('flat-position', '/position') },
      trace: positionTrace(
        'hl.positions.break-even-price.calculate',
        breakEvenSourceRefs,
        inputs,
        { status: 'complete' },
        [],
        [],
        flatBreakEvenAssumptions,
      ),
    }
  }

  const breakEvenPrice = normalized.position.entryPriceDecimal.plus(
    normalized.cumulativeCostDecimal.div(normalized.position.signedSizeDecimal),
  )
  if (!breakEvenPrice.isPositive()) {
    return {
      value: {
        status: 'indeterminate',
        reason: reason('no-positive-break-even-price', '/cumulativeCost'),
      },
      trace: positionTrace(
        'hl.positions.break-even-price.calculate',
        breakEvenSourceRefs,
        inputs,
        { status: 'complete' },
        [
          {
            stepId: 'break-even-price',
            inputs: {
              entryPrice: normalized.position.entryPrice,
              cumulativeCost: normalized.cumulativeCost,
              signedSize: normalized.position.signedSize,
            },
            output: decimalString(breakEvenPrice),
          },
        ],
        [
          {
            path: '/trace/intermediates/breakEvenPrice',
            input: `${normalized.cumulativeCost}/${normalized.position.signedSize}`,
            output: decimalString(breakEvenPrice),
            mode: 'half-even',
            reasonCode: 'decimal40-division',
          },
        ],
        breakEvenAssumptions,
      ),
    }
  }

  const data = { breakEvenPrice: decimalString(breakEvenPrice) }
  return okResult(
    data,
    positionTrace(
      'hl.positions.break-even-price.calculate',
      breakEvenSourceRefs,
      inputs,
      { status: 'complete' },
      [
        {
          stepId: 'break-even-price',
          inputs: {
            entryPrice: normalized.position.entryPrice,
            cumulativeCost: normalized.cumulativeCost,
            signedSize: normalized.position.signedSize,
          },
          output: data.breakEvenPrice,
        },
      ],
      [
        {
          path: '/value/data/breakEvenPrice',
          input: `${normalized.cumulativeCost}/${normalized.position.signedSize}`,
          output: data.breakEvenPrice,
          mode: 'half-even',
          reasonCode: 'decimal40-division',
        },
      ],
      breakEvenAssumptions,
    ),
  )
}
