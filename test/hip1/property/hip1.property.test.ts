import { Decimal } from 'decimal.js'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  evaluateHip1AnchorGenesisEligibility,
  validateHip1Deployment,
} from '../../../src/hip1/index.js'
import type { ConstraintCheck } from '../../../src/model/index.js'

const deploymentSeed = 0x481001
const anchorSeed = 0x481002

function ruleId(check: ConstraintCheck): string {
  return check.status === 'violated' ? check.violation.ruleId : check.ruleId
}

function integerString(value: bigint) {
  return value.toString()
}

function decimal(value: string | bigint) {
  return new Decimal(value.toString())
}

describe('HIP-1 deployment properties', () => {
  it('derives lotSizeWei as ten to the wei-minus-size decimal difference', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 30 }),
        fc.integer({ min: 0, max: 25 }),
        fc.bigInt({ min: 1n, max: 1_000_000_000_000n }),
        (weiDecimals, szDecimalsCandidate, supplyWei) => {
          const szDecimals = Math.min(szDecimalsCandidate, weiDecimals - 5)
          const userGenesisWei = supplyWei / 2n
          const anchorGenesisWei = supplyWei - userGenesisWei

          const result = validateHip1Deployment({
            name: 'PROP',
            weiDecimals,
            szDecimals,
            maxSupplyWei: integerString(supplyWei),
            userGenesisWei: integerString(userGenesisWei),
            anchorGenesisWei: integerString(anchorGenesisWei),
          })

          expect(result.value.status).toBe('ok')
          if (result.value.status !== 'ok') return
          expect(result.value.data.lotSizeWei).toBe(
            new Decimal(10).pow(weiDecimals - szDecimals).toFixed(),
          )
        },
      ),
      { numRuns: 300, seed: deploymentSeed },
    )
  })

  it('reports genesis checksum satisfied iff user plus anchor equals max supply', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000_000_000n }),
        fc.bigInt({ min: 0n, max: 1_000_000_000_000n }),
        fc.bigInt({ min: 0n, max: 1_000_000_000_000n }),
        (maxSupplyWei, userGenesisWei, anchorGenesisWei) => {
          const result = validateHip1Deployment({
            name: 'CHK',
            weiDecimals: 8,
            szDecimals: 3,
            maxSupplyWei: integerString(maxSupplyWei),
            userGenesisWei: integerString(userGenesisWei),
            anchorGenesisWei: integerString(anchorGenesisWei),
          })

          expect(result.value.status).toBe('ok')
          if (result.value.status !== 'ok') return
          const checksum = result.value.data.checks.find(
            (check) => ruleId(check) === 'hl.hip1.deployment.genesis-max-supply-checksum',
          )
          expect(checksum).toBeDefined()
          expect(checksum?.status).toBe(
            userGenesisWei + anchorGenesisWei === maxSupplyWei ? 'satisfied' : 'violated',
          )
        },
      ),
      { numRuns: 300, seed: deploymentSeed + 1 },
    )
  })
})

describe('HIP-1 anchor genesis properties', () => {
  it('computes exact rational threshold and max(holder minus threshold, zero) weight', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000_000_000n }),
        fc.bigInt({ min: 0n, max: 1_000_000_000_000n }),
        (holderBalanceWei, anchorTokenMaxSupplyWei) => {
          const result = evaluateHip1AnchorGenesisEligibility({
            holderBalanceWei: integerString(holderBalanceWei),
            anchorTokenMaxSupplyWei: integerString(anchorTokenMaxSupplyWei),
          })
          const thresholdWei = decimal(anchorTokenMaxSupplyWei).div(1_000_000)
          const rawWeightWei = decimal(holderBalanceWei).minus(thresholdWei)
          const expectedWeightWei = Decimal.max(rawWeightWei, 0)

          expect(result.value.status).toBe('ok')
          if (result.value.status !== 'ok') return
          expect(result.value.data.thresholdWei).toBe(thresholdWei.toFixed())
          expect(result.value.data.weightWei).toBe(expectedWeightWei.toFixed())
          expect(result.value.data.eligible).toBe(expectedWeightWei.gt(0))
        },
      ),
      { numRuns: 300, seed: anchorSeed },
    )
  })

  it('never marks a holder eligible when balance times one million is at or below max supply', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        fc.bigInt({ min: 0n, max: 999_999n }),
        (holderBalanceWei, remainderWei) => {
          const anchorTokenMaxSupplyWei = holderBalanceWei * 1_000_000n + remainderWei
          const result = evaluateHip1AnchorGenesisEligibility({
            holderBalanceWei: integerString(holderBalanceWei),
            anchorTokenMaxSupplyWei: integerString(anchorTokenMaxSupplyWei),
          })

          expect(result.value.status).toBe('ok')
          if (result.value.status !== 'ok') return
          expect(result.value.data.weightWei).toBe('0')
          expect(result.value.data.eligible).toBe(false)
        },
      ),
      { numRuns: 300, seed: anchorSeed + 1 },
    )
  })
})
