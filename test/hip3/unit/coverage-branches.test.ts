import { describe, expect, it } from 'vitest'
import {
  calculateHip3FeeRates,
  evaluateHip3MarginMode,
  resolveHip3CollateralSource,
} from '../../../src/hip3/index.js'

const collateralInput = {
  accountAbstractionMode: 'standard',
  dex: 'dex:builder-alpha',
  collateralTokenIndex: 7,
  validatorPerpUsdcTokenIndex: 0,
} as const

const feeInput = {
  makerRate: '0.0001',
  takerRate: '0.0004',
  activeReferralDiscount: '0.04',
  isAlignedQuoteToken: false,
  deployerFeeScale: '0.25',
  growthMode: false,
} as const

describe('HIP-3 branch coverage hardening', () => {
  it('rejects non-string account abstraction modes', () => {
    const result = resolveHip3CollateralSource({
      ...collateralInput,
      accountAbstractionMode: 1,
    } as never)

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues[0]).toMatchObject({
      code: 'invalid-enum-value',
      path: '/accountAbstractionMode',
    })
  })

  it('rejects unknown account abstraction mode strings', () => {
    const result = resolveHip3CollateralSource({
      ...collateralInput,
      accountAbstractionMode: 'crossDex',
    } as never)

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues[0]).toMatchObject({
      code: 'invalid-enum-value',
      path: '/accountAbstractionMode',
    })
  })

  it('rejects non-string dex names', () => {
    const result = resolveHip3CollateralSource({ ...collateralInput, dex: 3 } as never)

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues[0]).toMatchObject({ code: 'invalid-dex', path: '/dex' })
  })

  it('rejects non-number collateral token indexes', () => {
    const result = resolveHip3CollateralSource({
      ...collateralInput,
      collateralTokenIndex: '7',
    } as never)

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues[0]).toMatchObject({
      code: 'invalid-token-index',
      path: '/collateralTokenIndex',
    })
  })

  it('rejects unknown requested margin modes', () => {
    const result = evaluateHip3MarginMode({
      assetMarginMode: 'normal',
      requestedMode: 'portfolio',
    } as never)

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues[0]).toMatchObject({
      code: 'invalid-enum-value',
      path: '/requestedMode',
    })
  })

  it('rejects non-string asset margin modes', () => {
    const result = evaluateHip3MarginMode({
      assetMarginMode: null,
      requestedMode: 'cross',
    } as never)

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues[0]).toMatchObject({
      code: 'invalid-enum-value',
      path: '/assetMarginMode',
    })
  })

  it('rejects malformed maker rates before fee arithmetic', () => {
    const result = calculateHip3FeeRates({ ...feeInput, makerRate: '1e-4' })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues[0]).toMatchObject({
      code: 'invalid-decimal-string',
      path: '/makerRate',
    })
  })

  it('rejects malformed taker rates before fee arithmetic', () => {
    const result = calculateHip3FeeRates({ ...feeInput, takerRate: '0.0004 ' })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues[0]).toMatchObject({
      code: 'invalid-decimal-string',
      path: '/takerRate',
    })
  })

  it('rejects malformed referral discounts before range checks', () => {
    const result = calculateHip3FeeRates({ ...feeInput, activeReferralDiscount: '+0.1' })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues[0]).toMatchObject({
      code: 'invalid-decimal-string',
      path: '/activeReferralDiscount',
    })
  })

  it('rejects referral discounts above one', () => {
    const result = calculateHip3FeeRates({ ...feeInput, activeReferralDiscount: '1.000001' })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues[0]).toMatchObject({
      code: 'invalid-referral-discount',
      path: '/activeReferralDiscount',
    })
  })

  it('rejects negative deployer fee scales before growth range checks', () => {
    const result = calculateHip3FeeRates({ ...feeInput, deployerFeeScale: '-0.1' })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues[0]).toMatchObject({
      code: 'negative-decimal',
      path: '/deployerFeeScale',
    })
  })

  it('rejects non-boolean growth mode inputs', () => {
    const result = calculateHip3FeeRates({ ...feeInput, growthMode: 'false' } as never)

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues[0]).toMatchObject({ code: 'invalid-boolean', path: '/growthMode' })
  })

  it('serializes growth mode negative maker rebates by exact decimal shifting', () => {
    const result = calculateHip3FeeRates({
      ...feeInput,
      makerRate: '-10',
      takerRate: '10',
      activeReferralDiscount: '0',
      isAlignedQuoteToken: true,
      deployerFeeScale: '0',
      growthMode: true,
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.effectiveMakerRate).toBe('-1.5')
    expect(result.value.data.effectiveTakerRate).toBe('0.8')
  })

  it('serializes growth mode whole-number positive fees without a fractional tail', () => {
    const result = calculateHip3FeeRates({
      ...feeInput,
      makerRate: '10',
      takerRate: '10',
      activeReferralDiscount: '0',
      deployerFeeScale: '0',
      growthMode: true,
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.effectiveMakerRate).toBe('1')
    expect(result.value.data.effectiveTakerRate).toBe('1')
  })

  it('serializes growth mode zero rates without decimal shifting noise', () => {
    const result = calculateHip3FeeRates({
      ...feeInput,
      makerRate: '0',
      takerRate: '0',
      activeReferralDiscount: '0',
      growthMode: true,
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.effectiveMakerRate).toBe('0')
    expect(result.value.data.effectiveTakerRate).toBe('0')
  })
})
