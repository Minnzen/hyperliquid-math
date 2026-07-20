import type { MathResult } from '../model/index.js'
import { feeTierTrace, tradeFeeTrace, weightedFeeVolumeTrace } from './trace.js'
import type {
  CalculateTradeFeeInput,
  CalculateWeightedFeeVolumeInput,
  SelectedFeeTier,
  SelectFeeTierInput,
  TradeFee,
  WeightedFeeVolume,
} from './types.js'
import {
  normalizeSelectFeeTierInput,
  normalizeTradeFeeInput,
  normalizeWeightedFeeVolumeInput,
  reason,
} from './validation.js'

export type {
  CalculateTradeFeeInput,
  CalculateWeightedFeeVolumeInput,
  FeeRates,
  FeeTier,
  FeeTierSelection,
  SelectedFeeTier,
  SelectFeeTierInput,
  TradeFee,
  WeightedFeeVolume,
} from './types.js'

/**
 * Computes `notional = price * size`, `feeAmount = notional * rate`, and
 * `accountValueDelta = -feeAmount` under the signed user-cost convention (positive rate/fee =
 * charge, negative = rebate). Applies no hidden minimum, tier, or rounding; a zero size is valid
 * but returns `not-applicable`.
 *
 * @public
 */
export function calculateTradeFee(input: CalculateTradeFeeInput): MathResult<TradeFee> {
  const normalized = normalizeTradeFeeInput(input)
  if (!normalized.ok) {
    return {
      value: { status: 'invalid-input', issues: [normalized.issue] },
      trace: tradeFeeTrace(undefined, {
        status: 'incomplete',
        reason: reason(normalized.issue.code, normalized.issue.path as string),
      }),
    }
  }

  if (normalized.value.sizeDecimal.isZero()) {
    return {
      value: { status: 'not-applicable', reason: reason('zero-trade-size', '/size') },
      trace: tradeFeeTrace(normalized.value, { status: 'complete' }),
    }
  }

  const notional = normalized.value.priceDecimal.mul(normalized.value.sizeDecimal)
  const feeAmount = notional.mul(normalized.value.rateDecimal)
  const accountValueDelta = feeAmount.neg()
  const data = {
    notional: notional.toFixed(),
    feeAmount: feeAmount.toFixed(),
    accountValueDelta: accountValueDelta.toFixed(),
  }

  return {
    value: { status: 'ok', data },
    trace: tradeFeeTrace(normalized.value, { status: 'complete' }, [
      {
        stepId: 'notional',
        inputs: { price: normalized.value.price, size: normalized.value.size },
        output: data.notional,
      },
      {
        stepId: 'fee-amount',
        inputs: { notional: data.notional, rate: normalized.value.rate },
        output: data.feeAmount,
      },
      {
        stepId: 'account-value-delta',
        inputs: { feeAmount: data.feeAmount },
        output: data.accountValueDelta,
      },
    ]),
  }
}

/**
 * Computes the official fee-tier volume weighting `weightedVolume = perpsVolume + 2 * spotVolume`.
 * Inputs are the caller's already-windowed rolling-14-day totals; this function does not fetch,
 * window, or deduplicate volume events.
 *
 * @public
 */
export function calculateWeightedFeeVolume(
  input: CalculateWeightedFeeVolumeInput,
): MathResult<WeightedFeeVolume> {
  const normalized = normalizeWeightedFeeVolumeInput(input)
  if (!normalized.ok) {
    return {
      value: { status: 'invalid-input', issues: [normalized.issue] },
      trace: weightedFeeVolumeTrace(undefined, {
        status: 'incomplete',
        reason: reason(normalized.issue.code, normalized.issue.path as string),
      }),
    }
  }

  const weightedVolume = normalized.value.perpsVolumeDecimal.plus(
    normalized.value.spotVolumeDecimal.mul(2),
  )
  const data = { weightedVolume: weightedVolume.toFixed() }

  return {
    value: { status: 'ok', data },
    trace: weightedFeeVolumeTrace(normalized.value, { status: 'complete' }, [
      {
        stepId: 'weighted-volume',
        inputs: {
          perpsVolume: normalized.value.perpsVolume,
          spotVolume: normalized.value.spotVolume,
        },
        output: data.weightedVolume,
      },
    ]),
  }
}

/**
 * Selects the highest tier whose `minimumWeightedVolume` is strictly exceeded by
 * `weightedVolume` (the official strict greater-than rule); base rates apply when no tier
 * activates.
 * Returns the selected maker/taker rates plus which tier won. The server's actual tier assignment
 * remains authoritative — this only evaluates the supplied schedule.
 *
 * @public
 */
export function selectFeeTier(input: SelectFeeTierInput): MathResult<SelectedFeeTier> {
  const normalized = normalizeSelectFeeTierInput(input)
  if (!normalized.ok) {
    return {
      value: { status: 'invalid-input', issues: [normalized.issue] },
      trace: feeTierTrace(undefined, {
        status: 'incomplete',
        reason: reason(normalized.issue.code, normalized.issue.path as string),
      }),
    }
  }

  let selection: SelectedFeeTier = {
    selection: { kind: 'base' },
    makerRate: normalized.value.baseRates.makerRate,
    takerRate: normalized.value.baseRates.takerRate,
  }

  for (const [index, tier] of normalized.value.tiers.entries()) {
    if (normalized.value.weightedVolumeDecimal.gt(tier.minimumWeightedVolumeDecimal)) {
      selection = {
        selection: {
          kind: 'volume',
          index,
          minimumWeightedVolume: tier.minimumWeightedVolume,
        },
        makerRate: tier.makerRate,
        takerRate: tier.takerRate,
      }
    }
  }

  return {
    value: { status: 'ok', data: selection },
    trace: feeTierTrace(normalized.value, { status: 'complete' }, [
      {
        stepId: 'selected-tier',
        inputs: { weightedVolume: normalized.value.weightedVolume },
        output: selection.selection,
      },
    ]),
  }
}
