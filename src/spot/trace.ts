import type {
  Assumption,
  CalculationMaturity,
  CalculationTrace,
  JsonObject,
  MathReason,
  RoundingDecision,
  TraceStep,
} from '../model/index.js'
import type {
  NormalizedCalculateSpotPortfolioValueInput,
  NormalizedConvertSpotTokenUnitsInput,
  NormalizedEvaluateSpotDustEligibilityInput,
  NormalizedProjectSpotDustAllocationInput,
  NormalizedProjectSpotPositionEventInput,
  NormalizedSpotEvent,
  NormalizedSpotPosition,
} from './types.js'

type TraceCompletion =
  | { readonly status: 'complete' }
  | { readonly status: 'incomplete'; readonly reason: MathReason }

const decimalSource = 'DECIMALJS.10.6.0'

function positionJson(position: NormalizedSpotPosition): JsonObject {
  if (position.kind === 'flat') return { kind: 'flat' }
  return { kind: 'open', balance: position.balance, entryPrice: position.entryPrice }
}

function eventJson(event: NormalizedSpotEvent): JsonObject {
  if (event.kind === 'buy' || event.kind === 'sell') {
    return {
      kind: event.kind,
      size: event.size,
      price: event.price,
      feeQuoteAmount: event.feeQuoteAmount,
    }
  }
  if (event.kind === 'transfer') {
    return {
      kind: 'transfer',
      size: event.size,
      markPrice: event.markPrice,
      direction: event.direction,
    }
  }
  if (event.kind === 'genesis') {
    return { kind: 'genesis', size: event.size, maxSupply: event.maxSupply }
  }
  return {
    kind: 'initialize-from-existing-balance',
    balance: event.balance,
    eventPrice: event.eventPrice,
  }
}

function positionEventMaturity(
  input: NormalizedProjectSpotPositionEventInput | undefined,
): CalculationMaturity {
  if (input?.event.kind === 'genesis' || input?.event.kind === 'initialize-from-existing-balance') {
    return 'experimental'
  }
  return 'stable'
}

function positionEventAssumptions(
  input: NormalizedProjectSpotPositionEventInput | undefined,
): readonly Assumption[] {
  if (input === undefined) return []
  const assumptions: Assumption[] = [
    { kind: 'frozen-input', path: '/event', value: 'caller-provided-explicit-spot-event' },
  ]
  if (input.event.kind === 'buy' || input.event.kind === 'sell') {
    assumptions.push({
      kind: 'frozen-input',
      path: '/event/feeQuoteAmount',
      value: 'signed-user-cost',
    })
  }
  if (input.event.kind === 'transfer') {
    assumptions.push({
      kind: 'frozen-input',
      path: '/event/markPrice',
      value: 'caller-provided-unverified-mark',
    })
  }
  if (input.event.kind === 'genesis') {
    assumptions.push({
      kind: 'frozen-input',
      path: '/event/maxSupply',
      value: 'caller-provided-genesis-maximum-supply',
    })
  }
  if (input.event.kind === 'initialize-from-existing-balance') {
    assumptions.push({
      kind: 'frozen-input',
      path: '/event/eventPrice',
      value: 'first-supplied-post-feature-event-price',
    })
  }
  return assumptions
}

export function spotTrace(
  formulaId: string,
  maturity: CalculationMaturity,
  normalizedInputs: JsonObject,
  completion: TraceCompletion,
  sourceRefs: readonly string[],
  assumptions: readonly Assumption[] = [],
  intermediates: readonly TraceStep[] = [],
  rounding: readonly RoundingDecision[] = [],
): CalculationTrace {
  return {
    formulaId,
    formulaVersion: 1,
    authority: 'local-exact',
    maturity,
    completion,
    normalizedInputs,
    intermediates,
    rounding,
    assumptions: completion.status === 'complete' ? assumptions : [],
    sourceRefs: [...sourceRefs, decimalSource],
  }
}

export function convertInputs(input: NormalizedConvertSpotTokenUnitsInput | undefined): JsonObject {
  if (input === undefined) return {}
  return { value: input.value, weiDecimals: input.weiDecimals, direction: input.direction }
}

export function orderInputs(
  input: { readonly side: string; readonly baseSize: string; readonly price: string } | undefined,
): JsonObject {
  if (input === undefined) return {}
  return { side: input.side, baseSize: input.baseSize, price: input.price }
}

export function positionEventInputs(
  input: NormalizedProjectSpotPositionEventInput | undefined,
): JsonObject {
  if (input === undefined) return {}
  return { position: positionJson(input.position), event: eventJson(input.event) }
}

export function portfolioInputs(
  input: NormalizedCalculateSpotPortfolioValueInput | undefined,
): JsonObject {
  if (input === undefined) return {}
  return {
    balances: input.balances.map((balance) => ({
      tokenKey: balance.tokenKey,
      balance: balance.balance,
      entryPrice: balance.entryPrice,
      markPrice: balance.markPrice,
    })),
  }
}

export function dustEligibilityInputs(
  input: NormalizedEvaluateSpotDustEligibilityInput | undefined,
): JsonObject {
  if (input === undefined) return {}
  return {
    balance: input.balance,
    midPrice: input.midPrice,
    weiDecimals: input.weiDecimals,
    szDecimals: input.szDecimals,
    usdThreshold: input.usdThreshold,
  }
}

export function dustAllocationInputs(
  input: NormalizedProjectSpotDustAllocationInput | undefined,
): JsonObject {
  if (input === undefined) return {}
  return {
    aggregateDustSize: input.aggregateDustSize,
    executedProceeds: input.executedProceeds,
    userDustSize: input.userDustSize,
    aggregateLotSize: input.aggregateLotSize,
  }
}

export function positionEventTrace(
  input: NormalizedProjectSpotPositionEventInput | undefined,
  completion: TraceCompletion,
  intermediates: readonly TraceStep[] = [],
  rounding: readonly RoundingDecision[] = [],
): CalculationTrace {
  return spotTrace(
    'hl.spot.position-event.project',
    positionEventMaturity(input),
    positionEventInputs(input),
    completion,
    sourceRefs.positionEvent,
    positionEventAssumptions(input),
    intermediates,
    rounding,
  )
}

export const sourceRefs = {
  units: [
    'HLM.SPEC.SPOT.UNITS_CONVERT.V1',
    'HL.DOC.INFO.SPOT.2026-07-19',
    'HL.DOC.HIP1.2026-07-19',
  ],
  orderDeltas: ['HLM.SPEC.SPOT.ORDER_DELTAS.V1', 'HL.DOC.HIP1.2026-07-19'],
  positionEvent: ['HLM.SPEC.SPOT.POSITION_EVENT_PROJECT.V1', 'HL.DOC.ENTRY_PNL.2026-07-19'],
  portfolio: ['HLM.SPEC.SPOT.PORTFOLIO_VALUE.V1', 'HL.DOC.INFO.SPOT.2026-07-19'],
  dustEligibility: [
    'HLM.SPEC.SPOT.DUST_ELIGIBILITY.V1',
    'HL.DOC.INFO.SPOT.2026-07-19',
    'HL.DOC.HIP1.2026-07-19',
  ],
  dustAllocation: ['HLM.SPEC.SPOT.DUST_ALLOCATION_PROJECT.V1', 'HL.DOC.HIP1.2026-07-19'],
} as const
