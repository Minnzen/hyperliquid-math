import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { calculateHip3FeeRates } from '../../../src/hip3/index.js'

type FeeInput = {
  readonly makerRate: string
  readonly takerRate: string
  readonly activeReferralDiscount: string
  readonly isAlignedQuoteToken: boolean
  readonly deployerFeeScale: string
  readonly growthMode: boolean
}

const OracleDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN })

function expectedRates(input: FeeInput) {
  const makerRate = new OracleDecimal(input.makerRate)
  const takerRate = new OracleDecimal(input.takerRate)
  const activeReferralDiscount = new OracleDecimal(input.activeReferralDiscount)
  const deployerFeeScale = new OracleDecimal(input.deployerFeeScale)
  const growthMultiplier = input.growthMode ? new OracleDecimal('0.1') : new OracleDecimal(1)
  const hip3Scale = deployerFeeScale.lt(1) ? deployerFeeScale.plus(1) : deployerFeeScale.mul(2)
  const deployerShare = deployerFeeScale.lt(1)
    ? deployerFeeScale.div(new OracleDecimal(1).plus(deployerFeeScale))
    : new OracleDecimal('0.5')

  const makerRateBeforeAdjustments = makerRate.mul(growthMultiplier)
  const effectiveMakerRate = makerRateBeforeAdjustments.gt(0)
    ? makerRateBeforeAdjustments
        .mul(hip3Scale)
        .mul(new OracleDecimal(1).minus(activeReferralDiscount))
    : makerRateBeforeAdjustments.mul(
        input.isAlignedQuoteToken
          ? new OracleDecimal(1).minus(deployerShare).mul('1.5').plus(deployerShare)
          : 1,
      )
  const effectiveTakerRate = takerRate
    .mul(hip3Scale)
    .mul(growthMultiplier)
    .mul(new OracleDecimal(1).minus(activeReferralDiscount))
    .mul(
      input.isAlignedQuoteToken
        ? new OracleDecimal(1).minus(deployerShare).mul('0.8').plus(deployerShare)
        : 1,
    )

  return {
    effectiveMakerRate: effectiveMakerRate.toFixed(),
    effectiveTakerRate: effectiveTakerRate.toFixed(),
    hip3Scale: hip3Scale.toFixed(),
    deployerShare: deployerShare.toFixed(),
    growthMultiplier: growthMultiplier.toFixed(),
    alignedMakerScale: (input.isAlignedQuoteToken
      ? new OracleDecimal(1).minus(deployerShare).mul('1.5').plus(deployerShare)
      : new OracleDecimal(1)
    ).toFixed(),
    alignedTakerScale: (input.isAlignedQuoteToken
      ? new OracleDecimal(1).minus(deployerShare).mul('0.8').plus(deployerShare)
      : new OracleDecimal(1)
    ).toFixed(),
  }
}

const baseInput: FeeInput = {
  makerRate: '0.0001',
  takerRate: '0.0004',
  activeReferralDiscount: '0.04',
  isAlignedQuoteToken: false,
  deployerFeeScale: '0.25',
  growthMode: false,
}

describe('calculateHip3FeeRates', () => {
  it('applies the scale less than one branch to positive maker and taker fees', () => {
    const result = calculateHip3FeeRates(baseInput)

    expect(result).toMatchObject({
      value: {
        status: 'ok',
        data: {
          ...expectedRates(baseInput),
          checks: expect.arrayContaining([
            { status: 'satisfied', ruleId: 'hl.hip3.deployer-fee-scale-range' },
            { status: 'satisfied', ruleId: 'hl.hip3.referral-discount-range' },
          ]),
        },
      },
      trace: {
        formulaId: 'hl.hip3.fee-rates.calculate',
        formulaVersion: 1,
        authority: 'local-exact',
        maturity: 'experimental',
        completion: { status: 'complete' },
        normalizedInputs: baseInput,
        sourceRefs: expect.arrayContaining(['HLM.SPEC.HIP3.FEE_RATES.V1']),
        rounding: [
          expect.objectContaining({
            path: '/value/data/deployerShare',
            input: '0.25/(1+0.25)',
            mode: 'half-even',
            reasonCode: 'decimal40-division',
          }),
        ],
      },
    })
  })

  it('uses the scale equals one high branch rather than the less-than-one branch', () => {
    const input = { ...baseInput, deployerFeeScale: '1' }
    const result = calculateHip3FeeRates(input)

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        effectiveMakerRate: '0.000192',
        effectiveTakerRate: '0.000768',
        hip3Scale: '2',
        deployerShare: '0.5',
      },
    })
    expect(result.trace.rounding).toEqual([])
  })

  it('does not apply referral or hip3Scale adjustments to a zero maker rate', () => {
    const input = {
      ...baseInput,
      makerRate: '0',
      deployerFeeScale: '3',
      activeReferralDiscount: '1',
    }
    const result = calculateHip3FeeRates(input)

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        effectiveMakerRate: '0',
        hip3Scale: '6',
        deployerShare: '0.5',
      },
    })
  })

  it('keeps negative maker rebates negative and bypasses referral discounts', () => {
    const input = { ...baseInput, makerRate: '-0.0002', activeReferralDiscount: '1' }
    const result = calculateHip3FeeRates(input)

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        effectiveMakerRate: '-0.0002',
        effectiveTakerRate: '0',
      },
    })
  })

  it('applies aligned quote maker rebate scaling and aligned taker scaling from the same deployer share', () => {
    const input = {
      ...baseInput,
      makerRate: '-0.0002',
      takerRate: '0.0005',
      isAlignedQuoteToken: true,
      deployerFeeScale: '0.25',
    }
    const result = calculateHip3FeeRates(input)

    expect(result.value).toMatchObject({
      status: 'ok',
      data: expectedRates(input),
    })
  })

  it('preserves the Decimal40 quotient when deployer share repeats', () => {
    const input = {
      ...baseInput,
      isAlignedQuoteToken: true,
      deployerFeeScale: '0.2',
    }
    const result = calculateHip3FeeRates(input)

    expect(result.value).toMatchObject({
      status: 'ok',
      data: expectedRates(input),
    })
  })

  it('applies growth mode to maker and taker rates with constrained deployer scale', () => {
    const input = {
      ...baseInput,
      makerRate: '0.0002',
      takerRate: '0.0007',
      deployerFeeScale: '0.75',
      growthMode: true,
    }
    const result = calculateHip3FeeRates(input)

    expect(result.value).toMatchObject({
      status: 'ok',
      data: expectedRates(input),
    })
  })

  it('accepts the exact range boundaries for discounts and deployer scales', () => {
    const low = calculateHip3FeeRates({
      ...baseInput,
      activeReferralDiscount: '0',
      deployerFeeScale: '0',
    })
    const high = calculateHip3FeeRates({
      ...baseInput,
      activeReferralDiscount: '1',
      deployerFeeScale: '3',
    })

    expect(low.value.status).toBe('ok')
    expect(high.value.status).toBe('ok')
  })

  it('returns indeterminate when official growth-mode scale sources conflict', () => {
    const result = calculateHip3FeeRates({
      ...baseInput,
      deployerFeeScale: '3.01',
      growthMode: true,
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: {
        code: 'official-source-conflict',
        path: '/deployerFeeScale',
        sourceRefs: ['HL.DOC.FEES.2026-08-12', 'HL.DOC.HIP3_DEPLOYER_ACTIONS.2026-08-12'],
      },
    })
    expect(result.trace).toMatchObject({
      completion: {
        status: 'incomplete',
        reason: { code: 'official-source-conflict', path: '/deployerFeeScale' },
      },
      normalizedInputs: { deployerFeeScale: '3.01', growthMode: true },
    })
  })

  it('keeps the documented growth-mode upper boundary fail-closed', () => {
    const sharedBoundary = calculateHip3FeeRates({
      ...baseInput,
      deployerFeeScale: '1',
      growthMode: true,
    })
    const belowUpperBound = calculateHip3FeeRates({
      ...baseInput,
      deployerFeeScale: '9.99',
      growthMode: true,
    })
    const upperBound = calculateHip3FeeRates({
      ...baseInput,
      deployerFeeScale: '10',
      growthMode: true,
    })

    expect(sharedBoundary.value.status).toBe('ok')
    expect(belowUpperBound.value).toMatchObject({
      status: 'indeterminate',
      reason: { code: 'official-source-conflict', path: '/deployerFeeScale' },
    })
    expect(upperBound.value).toMatchObject({
      status: 'invalid-input',
      issues: [
        expect.objectContaining({
          code: 'invalid-deployer-fee-scale',
          path: '/deployerFeeScale',
        }),
      ],
    })
  })

  it('rejects referral discounts below zero', () => {
    const result = calculateHip3FeeRates({ ...baseInput, activeReferralDiscount: '-0.0001' })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-referral-discount',
          path: '/activeReferralDiscount',
        }),
      ]),
    )
  })

  it('rejects deployer fee scales above three', () => {
    const result = calculateHip3FeeRates({ ...baseInput, deployerFeeScale: '3.0000001' })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-deployer-fee-scale',
          path: '/deployerFeeScale',
        }),
      ]),
    )
  })

  it('rejects non-boolean aligned quote evidence', () => {
    const result = calculateHip3FeeRates({ ...baseInput, isAlignedQuoteToken: 'true' } as never)

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-boolean',
          path: '/isAlignedQuoteToken',
        }),
      ]),
    )
  })

  it('rejects extra keys on the exact plain-data input object', () => {
    const result = calculateHip3FeeRates({ ...baseInput, stakingTier: 'platinum' } as never)

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid-input-shape', path: '' })]),
    )
  })

  it('rejects accessor properties without invoking them', () => {
    let reads = 0
    const input = Object.defineProperties(
      {},
      {
        makerRate: { enumerable: true, value: '0.0001' },
        takerRate: {
          enumerable: true,
          get() {
            reads += 1
            return '0.0004'
          },
        },
        activeReferralDiscount: { enumerable: true, value: '0.04' },
        isAlignedQuoteToken: { enumerable: true, value: false },
        deployerFeeScale: { enumerable: true, value: '0.25' },
        growthMode: { enumerable: true, value: false },
      },
    )

    const result = calculateHip3FeeRates(input as never)

    expect(result.value.status).toBe('invalid-input')
    expect(reads).toBe(0)
  })

  it('states explicit fee-tier, referral, staking, aligned-quote, growth, and deployer evidence assumptions', () => {
    const result = calculateHip3FeeRates(baseInput)

    expect(result.trace.assumptions).toEqual(
      expect.arrayContaining([
        { kind: 'frozen-input', path: '/makerRate', value: 'caller-provided-user-fees-evidence' },
        { kind: 'frozen-input', path: '/takerRate', value: 'caller-provided-user-fees-evidence' },
        {
          kind: 'frozen-input',
          path: '/activeReferralDiscount',
          value: 'caller-provided-referral-evidence',
        },
        {
          kind: 'frozen-input',
          path: '/isAlignedQuoteToken',
          value: 'caller-provided-aligned-quote-evidence',
        },
        {
          kind: 'frozen-input',
          path: '/growthMode',
          value: 'caller-provided-growth-mode-evidence',
        },
        {
          kind: 'frozen-input',
          path: '/deployerFeeScale',
          value: 'caller-provided-deployer-fee-scale',
        },
      ]),
    )
  })
})
