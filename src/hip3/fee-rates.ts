import { Decimal40 } from '../core/decimal.js'
import type { ConstraintCheck, MathResult } from '../model/index.js'
import { feeRatesTrace } from './trace.js'
import type { CalculateHip3FeeRatesInput, Hip3EffectiveFeeRates } from './types.js'
import { normalizeCalculateHip3FeeRatesInput, reason } from './validation.js'

function decimalStringDivTen(value: string): string {
  if (value === '0') return value

  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [integerPart = '0', fractionalPart = ''] = unsigned.split('.')
  const digits = `${integerPart}${fractionalPart}`.replace(/^0+/, '')

  const originalScale = fractionalPart.length
  const scale = originalScale + 1
  const padded = digits.padStart(scale + 1, '0')
  const split = padded.length - scale
  const integer = padded.slice(0, split).replace(/^0+/, '') || '0'
  const fraction = padded.slice(split).replace(/0+$/, '')
  const shifted = fraction.length === 0 ? integer : `${integer}.${fraction}`
  return negative ? `-${shifted}` : shifted
}

/**
 * Composes the official HIP-3 deployer fee-rate formula in decimal rates: base rates times the
 * growth multiplier (0.1 in growth mode), taker and positive maker scaled by
 * `hip3Scale = scale < 1 ? scale + 1 : scale * 2` and `(1 - activeReferralDiscount)`, with
 * aligned-quote scales `(1 - deployerShare) * 1.5 + deployerShare` (maker rebate) and
 * `(1 - deployerShare) * 0.8 + deployerShare` (taker). Feed either effective rate into
 * `calculateTradeFee`; tier selection and eligibility proofs stay with the caller (experimental).
 *
 * @public
 */
export function calculateHip3FeeRates(
  input: CalculateHip3FeeRatesInput,
): MathResult<Hip3EffectiveFeeRates> {
  const normalized = normalizeCalculateHip3FeeRatesInput(input)
  if (!normalized.ok) {
    return {
      value: { status: 'invalid-input', issues: [normalized.issue] },
      trace: feeRatesTrace(undefined, {
        status: 'incomplete',
        reason: reason(normalized.issue.code, normalized.issue.path as string),
      }),
    }
  }

  const value = normalized.value
  const one = new Decimal40(1)
  const growthMultiplier = value.growthMode ? new Decimal40('0.1') : one
  const hip3Scale = value.deployerFeeScaleDecimal.lt(1)
    ? value.deployerFeeScaleDecimal.plus(1)
    : value.deployerFeeScaleDecimal.mul(2)
  const deployerShare = value.deployerFeeScaleDecimal.lt(1)
    ? value.deployerFeeScaleDecimal.div(one.plus(value.deployerFeeScaleDecimal))
    : new Decimal40('0.5')
  const makerRateBeforeAdjustments = value.makerRateDecimal.mul(growthMultiplier)
  const activeReferralMultiplier = one.minus(value.activeReferralDiscountDecimal)
  const alignedMakerScale = value.isAlignedQuoteToken
    ? one.minus(deployerShare).mul('1.5').plus(deployerShare)
    : one
  const alignedTakerScale = value.isAlignedQuoteToken
    ? one.minus(deployerShare).mul('0.8').plus(deployerShare)
    : one
  const effectiveMakerRateWithoutGrowth = value.makerRateDecimal.gt(0)
    ? value.makerRateDecimal.mul(hip3Scale).mul(activeReferralMultiplier).mul(growthMultiplier)
    : value.makerRateDecimal.mul(alignedMakerScale).mul(growthMultiplier)
  const effectiveTakerRateWithoutGrowth = value.takerRateDecimal
    .mul(hip3Scale)
    .mul(activeReferralMultiplier)
    .mul(alignedTakerScale)
  const effectiveMakerRate = value.growthMode
    ? decimalStringDivTen(
        value.makerRateDecimal.gt(0)
          ? value.makerRateDecimal.mul(hip3Scale).mul(activeReferralMultiplier).toFixed()
          : value.makerRateDecimal.mul(alignedMakerScale).toFixed(),
      )
    : effectiveMakerRateWithoutGrowth.toFixed()
  const effectiveTakerRate = value.growthMode
    ? decimalStringDivTen(effectiveTakerRateWithoutGrowth.toFixed())
    : effectiveTakerRateWithoutGrowth.toFixed()

  const checks: readonly ConstraintCheck[] = [
    { status: 'satisfied', ruleId: 'hl.hip3.referral-discount-range' },
    { status: 'satisfied', ruleId: 'hl.hip3.deployer-fee-scale-range' },
    { status: 'satisfied', ruleId: 'hl.hip3.growth-mode-scale-range' },
  ]
  const data = {
    effectiveMakerRate,
    effectiveTakerRate,
    hip3Scale: hip3Scale.toFixed(),
    deployerShare: deployerShare.toFixed(),
    growthMultiplier: growthMultiplier.toFixed(),
    alignedMakerScale: alignedMakerScale.toFixed(),
    alignedTakerScale: alignedTakerScale.toFixed(),
    checks,
  }

  return {
    value: { status: 'ok', data },
    trace: feeRatesTrace(
      value,
      { status: 'complete' },
      [
        {
          stepId: 'growth-multiplier',
          inputs: { growthMode: value.growthMode },
          output: data.growthMultiplier,
        },
        {
          stepId: 'hip3-scale-and-deployer-share',
          inputs: { deployerFeeScale: value.deployerFeeScale },
          output: { hip3Scale: data.hip3Scale, deployerShare: data.deployerShare },
        },
        {
          stepId: 'effective-maker-rate',
          inputs: {
            makerRate: value.makerRate,
            makerRateBeforeAdjustments: makerRateBeforeAdjustments.toFixed(),
            activeReferralDiscount: value.activeReferralDiscount,
            alignedMakerScale: data.alignedMakerScale,
          },
          output: data.effectiveMakerRate,
        },
        {
          stepId: 'effective-taker-rate',
          inputs: {
            takerRate: value.takerRate,
            activeReferralDiscount: value.activeReferralDiscount,
            alignedTakerScale: data.alignedTakerScale,
          },
          output: data.effectiveTakerRate,
        },
      ],
      value.deployerFeeScaleDecimal.lt(1)
        ? [
            {
              path: '/value/data/deployerShare',
              input: `${value.deployerFeeScale}/(1+${value.deployerFeeScale})`,
              output: data.deployerShare,
              mode: 'half-even',
              reasonCode: 'decimal40-division',
            },
          ]
        : [],
    ),
  }
}
