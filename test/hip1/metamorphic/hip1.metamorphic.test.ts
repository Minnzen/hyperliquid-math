import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import {
  evaluateHip1AnchorGenesisEligibility,
  validateHip1Deployment,
} from '../../../src/hip1/index.js'
import type { ConstraintCheck } from '../../../src/model/index.js'

function ruleId(check: ConstraintCheck): string {
  return check.status === 'violated' ? check.violation.ruleId : check.ruleId
}

describe('HIP-1 deployment metamorphic behavior', () => {
  it('preserves deployment validity when supply moves between user and anchor genesis buckets', () => {
    const userHeavy = validateHip1Deployment({
      name: 'SHIFT',
      weiDecimals: 10,
      szDecimals: 5,
      maxSupplyWei: '1000000',
      userGenesisWei: '900000',
      anchorGenesisWei: '100000',
    })
    const anchorHeavy = validateHip1Deployment({
      name: 'SHIFT',
      weiDecimals: 10,
      szDecimals: 5,
      maxSupplyWei: '1000000',
      userGenesisWei: '100000',
      anchorGenesisWei: '900000',
    })

    expect(userHeavy.value.status).toBe('ok')
    expect(anchorHeavy.value.status).toBe('ok')
    if (userHeavy.value.status !== 'ok' || anchorHeavy.value.status !== 'ok') return
    expect(anchorHeavy.value.data.lotSizeWei).toBe(userHeavy.value.data.lotSizeWei)
    expect(anchorHeavy.value.data.totalGenesisWei).toBe(userHeavy.value.data.totalGenesisWei)
    expect(
      anchorHeavy.value.data.checks.find(
        (check) => ruleId(check) === 'hl.hip1.deployment.genesis-max-supply-checksum',
      )?.status,
    ).toBe('satisfied')
  })

  it('kills checksum mutants that include later hyperliquidity supply as implicit genesis', () => {
    const result = validateHip1Deployment({
      name: 'HLQ',
      weiDecimals: 8,
      szDecimals: 3,
      maxSupplyWei: '1000001',
      userGenesisWei: '500000',
      anchorGenesisWei: '500000',
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.totalGenesisWei).toBe('1000000')
    expect(result.value.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'violated',
          violation: expect.objectContaining({
            ruleId: 'hl.hip1.deployment.genesis-max-supply-checksum',
            actual: '1000000',
            limit: '1000001',
          }),
        }),
      ]),
    )
  })

  it('classifies a six-code-point emoji name differently from a seven-code-point name', () => {
    const sixCodePoints = validateHip1Deployment({
      name: 'A😀BCDE',
      weiDecimals: 8,
      szDecimals: 3,
      maxSupplyWei: '1',
      userGenesisWei: '1',
      anchorGenesisWei: '0',
    })
    const sevenCodePoints = validateHip1Deployment({
      name: 'A😀BCDEF',
      weiDecimals: 8,
      szDecimals: 3,
      maxSupplyWei: '1',
      userGenesisWei: '1',
      anchorGenesisWei: '0',
    })

    expect(sixCodePoints.value.status).toBe('ok')
    expect(sevenCodePoints.value.status).toBe('ok')
    if (sixCodePoints.value.status !== 'ok' || sevenCodePoints.value.status !== 'ok') return
    expect(
      sixCodePoints.value.data.checks.find(
        (check) => ruleId(check) === 'hl.hip1.deployment.name-code-points',
      )?.status,
    ).toBe('satisfied')
    expect(
      sevenCodePoints.value.data.checks.find(
        (check) => ruleId(check) === 'hl.hip1.deployment.name-code-points',
      )?.status,
    ).toBe('violated')
  })
})

describe('HIP-1 anchor genesis metamorphic behavior', () => {
  it('scales threshold and weight linearly when holder balance and max supply scale together', () => {
    const base = evaluateHip1AnchorGenesisEligibility({
      holderBalanceWei: '2000001',
      anchorTokenMaxSupplyWei: '1000000000000',
    })
    const scaled = evaluateHip1AnchorGenesisEligibility({
      holderBalanceWei: '6000003',
      anchorTokenMaxSupplyWei: '3000000000000',
    })

    expect(base.value.status).toBe('ok')
    expect(scaled.value.status).toBe('ok')
    if (base.value.status !== 'ok' || scaled.value.status !== 'ok') return
    expect(scaled.value.data.thresholdWei).toBe(
      new Decimal(base.value.data.thresholdWei).times(3).toFixed(),
    )
    expect(scaled.value.data.weightWei).toBe(
      new Decimal(base.value.data.weightWei).times(3).toFixed(),
    )
    expect(scaled.value.data.eligible).toBe(base.value.data.eligible)
  })

  it('kills mutants that use greater-than-or-equal eligibility at the threshold', () => {
    const result = evaluateHip1AnchorGenesisEligibility({
      holderBalanceWei: '1000',
      anchorTokenMaxSupplyWei: '1000000000',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        thresholdWei: '1000',
        weightWei: '0',
        eligible: false,
      },
    })
  })

  it('kills mutants that floor the rational threshold before subtracting holder balance', () => {
    const result = evaluateHip1AnchorGenesisEligibility({
      holderBalanceWei: '1',
      anchorTokenMaxSupplyWei: '1999999',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        thresholdWei: '1.999999',
        weightWei: '0',
        eligible: false,
      },
    })
  })
})
