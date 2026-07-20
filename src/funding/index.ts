import { Decimal40 } from '../core/decimal.js'
import type { MathIssue, MathResult, RoundingDecision } from '../model/index.js'
import {
  annualizeFundingRateTrace,
  fundingPaymentTrace,
  fundingRateTrace,
  premiumIndexTrace,
} from './trace.js'
import type {
  AnnualizedFundingRate,
  AnnualizeFundingRateInput,
  FundingPayment,
  FundingPaymentInput,
  FundingPremiumIndex,
  FundingPremiumIndexInput,
  FundingRate,
  FundingRateInput,
} from './types.js'
import {
  invalidReason,
  normalizeAnnualizeFundingRateInput,
  normalizeFundingPaymentInput,
  normalizeFundingPremiumIndexInput,
  normalizeFundingRateInput,
  reason,
} from './validation.js'

export type {
  AnnualizedFundingRate,
  AnnualizeFundingRateInput,
  FundingAnnualizationConvention,
  FundingPayment,
  FundingPaymentInput,
  FundingPremiumIndex,
  FundingPremiumIndexInput,
  FundingRate,
  FundingRateInput,
  FundingRateRules,
} from './types.js'

function invalid<T>(
  issue: MathIssue,
  traceFactory: (reasonValue: ReturnType<typeof invalidReason>) => MathResult<T>['trace'],
): MathResult<T> {
  return {
    value: { status: 'invalid-input', issues: [issue] },
    trace: traceFactory(invalidReason(issue)),
  }
}

/**
 * Computes the standard-perp premium index
 * `premiumIndex = (max(impactBid - oracle, 0) - max(oracle - impactAsk, 0)) / oracle` from
 * explicit impact and oracle prices. It does not derive impact prices from a book (use
 * `simulateBookFill`) and deliberately excludes the HIP-3 responsive-premium branch.
 *
 * @public
 */
export function calculateFundingPremiumIndex(
  input: FundingPremiumIndexInput,
): MathResult<FundingPremiumIndex> {
  const normalized = normalizeFundingPremiumIndexInput(input)
  if (!normalized.ok) {
    return invalid(normalized.issue, (reasonValue) =>
      premiumIndexTrace(undefined, { status: 'incomplete', reason: reasonValue }),
    )
  }

  const zero = new Decimal40(0)
  const bidPremium = Decimal40.max(
    normalized.value.impactBidPriceDecimal.minus(normalized.value.oraclePriceDecimal),
    zero,
  )
  const askDiscount = Decimal40.max(
    normalized.value.oraclePriceDecimal.minus(normalized.value.impactAskPriceDecimal),
    zero,
  )
  const impactPriceDifference = bidPremium.minus(askDiscount)
  const premiumIndex = impactPriceDifference.div(normalized.value.oraclePriceDecimal)
  const data: FundingPremiumIndex = {
    bidPremium: bidPremium.toFixed(),
    askDiscount: askDiscount.toFixed(),
    impactPriceDifference: impactPriceDifference.toFixed(),
    premiumIndex: premiumIndex.toFixed(),
  }

  return {
    value: { status: 'ok', data },
    trace: premiumIndexTrace(
      normalized.value,
      { status: 'complete' },
      [
        {
          stepId: 'standard-impact-price-difference',
          inputs: {
            impactBidPrice: normalized.value.impactBidPrice,
            impactAskPrice: normalized.value.impactAskPrice,
            oraclePrice: normalized.value.oraclePrice,
          },
          output: data.impactPriceDifference,
        },
        {
          stepId: 'premium-index',
          inputs: {
            impactPriceDifference: data.impactPriceDifference,
            oraclePrice: normalized.value.oraclePrice,
          },
          output: data.premiumIndex,
        },
      ],
      [
        {
          path: '/value/data/premiumIndex',
          input: `${data.impactPriceDifference}/${normalized.value.oraclePrice}`,
          output: data.premiumIndex,
          mode: 'half-even',
          reasonCode: 'decimal40-division',
        },
      ],
    ),
  }
}

/**
 * Computes the hourly funding rate from an average premium index and explicit versioned rules:
 * `base = premium + clamp(interestRate - premium, clampLower, clampUpper)`, then
 * `hourlyRate = clamp(base / baseIntervalHours, -hourlyCap, hourlyCap)`.
 * Reports every intermediate term and whether the hourly cap applied; validator sampling and final
 * settlement remain server-authoritative.
 *
 * @public
 */
export function calculateFundingRate(input: FundingRateInput): MathResult<FundingRate> {
  const normalized = normalizeFundingRateInput(input)
  if (!normalized.ok) {
    return invalid(normalized.issue, (reasonValue) =>
      fundingRateTrace(undefined, { status: 'incomplete', reason: reasonValue }),
    )
  }

  const rules = normalized.value.rules
  const rawDifference = rules.interestRateDecimal.minus(normalized.value.averagePremiumIndexDecimal)
  const clampedDifference = Decimal40.min(
    Decimal40.max(rawDifference, rules.clampLowerDecimal),
    rules.clampUpperDecimal,
  )
  const baseIntervalRate = normalized.value.averagePremiumIndexDecimal.plus(clampedDifference)
  const uncappedHourlyRate = baseIntervalRate.div(rules.baseIntervalHours)
  const negativeCap = rules.hourlyCapDecimal.neg()
  const hourlyRate = Decimal40.min(
    Decimal40.max(uncappedHourlyRate, negativeCap),
    rules.hourlyCapDecimal,
  )
  const capped = !hourlyRate.eq(uncappedHourlyRate)
  const data: FundingRate = {
    averagePremiumIndex: normalized.value.averagePremiumIndex,
    interestRate: rules.interestRate,
    clampedDifference: clampedDifference.toFixed(),
    baseIntervalRate: baseIntervalRate.toFixed(),
    uncappedHourlyRate: uncappedHourlyRate.toFixed(),
    hourlyRate: hourlyRate.toFixed(),
    hourlyCap: rules.hourlyCap,
    capped,
  }

  return {
    value: { status: 'ok', data },
    trace: fundingRateTrace(
      normalized.value,
      { status: 'complete' },
      [
        {
          stepId: 'interest-minus-premium-clamp',
          inputs: {
            interestRate: rules.interestRate,
            averagePremiumIndex: normalized.value.averagePremiumIndex,
            clampLower: rules.clampLower,
            clampUpper: rules.clampUpper,
          },
          output: data.clampedDifference,
        },
        {
          stepId: 'base-interval-rate',
          inputs: {
            averagePremiumIndex: normalized.value.averagePremiumIndex,
            clampedDifference: data.clampedDifference,
          },
          output: data.baseIntervalRate,
        },
        {
          stepId: 'hourly-rate-cap',
          inputs: {
            uncappedHourlyRate: data.uncappedHourlyRate,
            hourlyCap: rules.hourlyCap,
          },
          output: { hourlyRate: data.hourlyRate, capped },
        },
      ],
      [
        {
          path: '/value/data/uncappedHourlyRate',
          input: `${data.baseIntervalRate}/${rules.baseIntervalHours}`,
          output: data.uncappedHourlyRate,
          mode: 'half-even',
          reasonCode: 'decimal40-division',
        },
      ],
    ),
  }
}

/**
 * Computes `payment = signedPositionSize * oraclePrice * fundingRate` and
 * `accountValueDelta = -payment` for one settlement; positive payment means the position pays.
 * Uses oracle (not mark) price per the official formula; `assetCtx.funding` and
 * `userFunding.delta.fundingRate` pass directly as `fundingRate`. Zero size returns
 * `not-applicable`.
 *
 * @public
 */
export function calculateFundingPayment(input: FundingPaymentInput): MathResult<FundingPayment> {
  const normalized = normalizeFundingPaymentInput(input)
  if (!normalized.ok) {
    return invalid(normalized.issue, (reasonValue) =>
      fundingPaymentTrace(undefined, { status: 'incomplete', reason: reasonValue }),
    )
  }

  if (normalized.value.signedPositionSizeDecimal.isZero()) {
    return {
      value: {
        status: 'not-applicable',
        reason: reason('zero-position-size', '/signedPositionSize'),
      },
      trace: fundingPaymentTrace(normalized.value, { status: 'complete' }),
    }
  }

  const notional = normalized.value.signedPositionSizeDecimal.mul(
    normalized.value.oraclePriceDecimal,
  )
  const payment = notional.mul(normalized.value.fundingRateDecimal)
  const accountValueDelta = payment.neg()
  const data: FundingPayment = {
    signedPositionSize: normalized.value.signedPositionSize,
    oraclePrice: normalized.value.oraclePrice,
    fundingRate: normalized.value.fundingRate,
    notional: notional.toFixed(),
    payment: payment.toFixed(),
    accountValueDelta: accountValueDelta.toFixed(),
  }

  return {
    value: { status: 'ok', data },
    trace: fundingPaymentTrace(normalized.value, { status: 'complete' }, [
      {
        stepId: 'signed-funding-payment',
        inputs: {
          signedPositionSize: normalized.value.signedPositionSize,
          oraclePrice: normalized.value.oraclePrice,
          fundingRate: normalized.value.fundingRate,
        },
        output: data.payment,
      },
      {
        stepId: 'account-value-delta',
        inputs: { payment: data.payment },
        output: data.accountValueDelta,
      },
    ]),
  }
}

/**
 * Annualizes a periodic funding rate: simple `periodicRate * periodsPerYear`, or compound
 * `(1 + periodicRate) ^ periodsPerYear - 1` (which requires `1 + periodicRate > 0`).
 * The convention is an explicit analytical assumption, not a reinvestment claim.
 *
 * @public
 */
export function annualizeFundingRate(
  input: AnnualizeFundingRateInput,
): MathResult<AnnualizedFundingRate> {
  const normalized = normalizeAnnualizeFundingRateInput(input)
  if (!normalized.ok) {
    return invalid(normalized.issue, (reasonValue) =>
      annualizeFundingRateTrace(undefined, { status: 'incomplete', reason: reasonValue }),
    )
  }

  const rounding: RoundingDecision[] = []
  let annualizedRate: InstanceType<typeof Decimal40>
  if (normalized.value.convention === 'simple') {
    annualizedRate = normalized.value.periodicRateDecimal.mul(normalized.value.periodsPerYear)
  } else {
    const growthBase = new Decimal40(1).plus(normalized.value.periodicRateDecimal)
    if (growthBase.lte(0)) {
      return {
        value: {
          status: 'invalid-input',
          issues: [
            {
              code: 'invalid-compound-growth-base',
              path: '/periodicRate',
              actual: normalized.value.periodicRate,
              expected: '1 + periodicRate > 0',
            },
          ],
        },
        trace: annualizeFundingRateTrace(normalized.value, {
          status: 'incomplete',
          reason: reason('invalid-compound-growth-base', '/periodicRate'),
        }),
      }
    }
    annualizedRate = growthBase.pow(normalized.value.periodsPerYear).minus(1)
    rounding.push({
      path: '/value/data/annualizedRate',
      input: `pow(1+${normalized.value.periodicRate},${normalized.value.periodsPerYear})-1`,
      output: annualizedRate.toFixed(),
      mode: 'half-even',
      reasonCode: 'decimal40-power',
    })
  }

  const data: AnnualizedFundingRate = {
    periodicRate: normalized.value.periodicRate,
    periodsPerYear: normalized.value.periodsPerYear,
    convention: normalized.value.convention,
    annualizedRate: annualizedRate.toFixed(),
  }

  return {
    value: { status: 'ok', data },
    trace: annualizeFundingRateTrace(
      normalized.value,
      { status: 'complete' },
      [
        {
          stepId: 'annualize-funding-rate',
          inputs: {
            periodicRate: normalized.value.periodicRate,
            periodsPerYear: normalized.value.periodsPerYear,
            convention: normalized.value.convention,
          },
          output: data.annualizedRate,
        },
      ],
      rounding,
    ),
  }
}
