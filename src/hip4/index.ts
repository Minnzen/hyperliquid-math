import { Decimal40 } from '../core/decimal.js'
import type { MathIssue, MathResult, RoundingDecision, TraceStep } from '../model/index.js'
import { outcomeDualPriceTrace, outcomeSettlementTrace, recurringOutcomeTrace } from './trace.js'
import type {
  CalculateOutcomeDualPriceInput,
  CalculateOutcomeSettlementInput,
  EvaluatedPriceBucketOutcome,
  EvaluatedRecurringOutcome,
  EvaluateRecurringOutcomeInput,
  NormalizedEvaluateRecurringOutcomeInput,
  OutcomeDualPrice,
  OutcomeSettlement,
} from './types.js'
import {
  normalizeCalculateOutcomeDualPriceInput,
  normalizeCalculateOutcomeSettlementInput,
  normalizeEvaluateRecurringOutcomeInput,
  reason,
} from './validation.js'

export type {
  CalculateOutcomeDualPriceInput,
  CalculateOutcomeSettlementInput,
  EvaluatedPriceBinaryOutcome,
  EvaluatedPriceBucketOutcome,
  EvaluatedRecurringOutcome,
  EvaluatePriceBinaryOutcomeInput,
  EvaluatePriceBucketOutcomeInput,
  EvaluateRecurringOutcomeInput,
  OutcomeDualPrice,
  OutcomeSettlement,
  OutcomeTokenSide,
} from './types.js'

function invalid<T>(
  issue: MathIssue,
  traceFactory: (issueReason: ReturnType<typeof reason>) => MathResult<T>['trace'],
): MathResult<T> {
  return {
    value: { status: 'invalid-input', issues: [issue] },
    trace: traceFactory(reason(issue.code, issue.path ?? '')),
  }
}

/**
 * Returns the complementary HIP-4 outcome price `1 - price` for a caller-supplied price in `[0, 1]`.
 * This is the merged-book price equivalence only; it does not model execution priority.
 *
 * @public
 */
export function calculateOutcomeDualPrice(
  input: CalculateOutcomeDualPriceInput,
): MathResult<OutcomeDualPrice> {
  const normalized = normalizeCalculateOutcomeDualPriceInput(input)
  if (!normalized.ok) {
    return invalid(normalized.issue, (issueReason) =>
      outcomeDualPriceTrace(undefined, { status: 'incomplete', reason: issueReason }),
    )
  }

  const dualPrice = new Decimal40(1).minus(normalized.value.priceDecimal).toFixed()
  return {
    value: { status: 'ok', data: { dualPrice } },
    trace: outcomeDualPriceTrace(normalized.value, { status: 'complete' }, [
      {
        stepId: 'dual-price',
        inputs: { price: normalized.value.price },
        output: dualPrice,
      },
    ]),
  }
}

/**
 * Projects a Yes or No token's settlement value and gross PnL from an explicit settlement fraction.
 * Numeric outcome asset sides are deliberately not accepted because their label mapping is metadata.
 *
 * @public
 */
export function calculateOutcomeSettlement(
  input: CalculateOutcomeSettlementInput,
): MathResult<OutcomeSettlement> {
  const normalized = normalizeCalculateOutcomeSettlementInput(input)
  if (!normalized.ok) {
    return invalid(normalized.issue, (issueReason) =>
      outcomeSettlementTrace(undefined, { status: 'incomplete', reason: issueReason }),
    )
  }

  if (normalized.value.sizeDecimal.isZero()) {
    return {
      value: {
        status: 'not-applicable',
        reason: reason('zero-outcome-size', '/size'),
      },
      trace: outcomeSettlementTrace(normalized.value, { status: 'complete' }),
    }
  }

  const payoutFractionDecimal =
    normalized.value.tokenSide === 'yes'
      ? normalized.value.settleFractionDecimal
      : new Decimal40(1).minus(normalized.value.settleFractionDecimal)
  const settlementValue = normalized.value.sizeDecimal.mul(payoutFractionDecimal)
  const entryNotional = normalized.value.sizeDecimal.mul(normalized.value.entryPriceDecimal)
  const grossPnl = settlementValue.minus(entryNotional)
  const data: OutcomeSettlement = {
    payoutFraction: payoutFractionDecimal.toFixed(),
    settlementValue: settlementValue.toFixed(),
    entryNotional: entryNotional.toFixed(),
    grossPnl: grossPnl.toFixed(),
  }

  return {
    value: { status: 'ok', data },
    trace: outcomeSettlementTrace(normalized.value, { status: 'complete' }, [
      {
        stepId: 'payout-fraction',
        inputs: {
          tokenSide: normalized.value.tokenSide,
          settleFraction: normalized.value.settleFraction,
        },
        output: data.payoutFraction,
      },
      {
        stepId: 'settlement-value',
        inputs: { size: normalized.value.size, payoutFraction: data.payoutFraction },
        output: data.settlementValue,
      },
      {
        stepId: 'entry-notional',
        inputs: { size: normalized.value.size, entryPrice: normalized.value.entryPrice },
        output: data.entryNotional,
      },
      {
        stepId: 'gross-pnl',
        inputs: {
          settlementValue: data.settlementValue,
          entryNotional: data.entryNotional,
        },
        output: data.grossPnl,
      },
    ]),
  }
}

function interpolateMarkPrice(input: NormalizedEvaluateRecurringOutcomeInput): {
  readonly interpolatedMarkPriceDecimal: InstanceType<typeof Decimal40>
  readonly intermediates: readonly TraceStep[]
  readonly rounding: readonly RoundingDecision[]
} {
  const timeOffset = new Decimal40(String(input.settlementTime)).minus(String(input.t0))
  const interval = new Decimal40(String(input.t1)).minus(String(input.t0))
  const interpolationWeight = timeOffset.div(interval)
  const markPriceChange = input.markPrice1Decimal.minus(input.markPrice0Decimal)
  const interpolatedMarkPriceDecimal = input.markPrice0Decimal.plus(
    interpolationWeight.mul(markPriceChange),
  )
  const interpolatedMarkPrice = interpolatedMarkPriceDecimal.toFixed()

  return {
    interpolatedMarkPriceDecimal,
    intermediates: [
      {
        stepId: 'interpolation-time-offset',
        inputs: { settlementTime: input.settlementTime, t0: input.t0 },
        output: timeOffset.toFixed(),
      },
      {
        stepId: 'interpolation-interval',
        inputs: { t1: input.t1, t0: input.t0 },
        output: interval.toFixed(),
      },
      {
        stepId: 'interpolation-mark-change',
        inputs: { markPrice1: input.markPrice1, markPrice0: input.markPrice0 },
        output: markPriceChange.toFixed(),
      },
      {
        stepId: 'interpolation-weight',
        inputs: { timeOffset: timeOffset.toFixed(), interval: interval.toFixed() },
        output: interpolationWeight.toFixed(),
      },
      {
        stepId: 'interpolated-mark-price',
        inputs: {
          markPrice0: input.markPrice0,
          interpolationWeight: interpolationWeight.toFixed(),
          markPriceChange: markPriceChange.toFixed(),
        },
        output: interpolatedMarkPrice,
      },
    ],
    rounding: [
      {
        path: '/value/data/interpolatedMarkPrice',
        input: `${input.markPrice0}+(${timeOffset.toFixed()}/${interval.toFixed()})*(${markPriceChange.toFixed()})`,
        output: interpolatedMarkPrice,
        mode: 'half-even',
        reasonCode: 'decimal40-division',
      },
    ],
  }
}

/**
 * Interpolates the two caller-selected marks at settlement, then evaluates either a binary target
 * (equality settles Yes) or two ascending bucket thresholds (equality selects the higher bucket).
 *
 * @public
 */
export function evaluateRecurringOutcome(
  input: EvaluateRecurringOutcomeInput,
): MathResult<EvaluatedRecurringOutcome> {
  const normalized = normalizeEvaluateRecurringOutcomeInput(input)
  if (!normalized.ok) {
    return invalid(normalized.issue, (issueReason) =>
      recurringOutcomeTrace(undefined, { status: 'incomplete', reason: issueReason }),
    )
  }

  const interpolation = interpolateMarkPrice(normalized.value)
  const interpolatedMarkPrice = interpolation.interpolatedMarkPriceDecimal.toFixed()
  if (normalized.value.class === 'priceBinary') {
    const settlesTo = interpolation.interpolatedMarkPriceDecimal.gte(
      normalized.value.targetPriceDecimal,
    )
      ? 'yes'
      : 'no'
    const settleFraction = settlesTo === 'yes' ? '1' : '0'
    const data: EvaluatedRecurringOutcome = {
      class: 'priceBinary',
      interpolatedMarkPrice,
      settlesTo,
      settleFraction,
    }
    return {
      value: { status: 'ok', data },
      trace: recurringOutcomeTrace(
        normalized.value,
        { status: 'complete' },
        [
          ...interpolation.intermediates,
          {
            stepId: 'binary-target-comparison',
            inputs: {
              interpolatedMarkPrice,
              targetPrice: normalized.value.targetPrice,
            },
            output: { settlesTo, settleFraction },
          },
        ],
        interpolation.rounding,
      ),
    }
  }

  const [threshold0, threshold1] = normalized.value.priceThresholdDecimals
  const belowFirst = interpolation.interpolatedMarkPriceDecimal.lt(threshold0)
  const belowSecond = interpolation.interpolatedMarkPriceDecimal.lt(threshold1)
  const settledBucket: 0 | 1 | 2 = belowFirst ? 0 : belowSecond ? 1 : 2
  const settleFractions: EvaluatedPriceBucketOutcome['settleFractions'] =
    settledBucket === 0 ? ['1', '0', '0'] : settledBucket === 1 ? ['0', '1', '0'] : ['0', '0', '1']
  const data: EvaluatedRecurringOutcome = {
    class: 'priceBucket',
    interpolatedMarkPrice,
    settledBucket,
    settleFractions,
  }
  return {
    value: { status: 'ok', data },
    trace: recurringOutcomeTrace(
      normalized.value,
      { status: 'complete' },
      [
        ...interpolation.intermediates,
        {
          stepId: 'bucket-lower-comparison',
          inputs: {
            interpolatedMarkPrice,
            priceThreshold: normalized.value.priceThresholds[0],
          },
          output: belowFirst,
        },
        {
          stepId: 'bucket-upper-comparison',
          inputs: {
            interpolatedMarkPrice,
            priceThreshold: normalized.value.priceThresholds[1],
          },
          output: belowSecond,
        },
        {
          stepId: 'bucket-settlement',
          inputs: { belowFirst, belowSecond },
          output: { settledBucket, settleFractions },
        },
      ],
      interpolation.rounding,
    ),
  }
}
