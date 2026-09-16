import { describe, expect, it } from 'vitest'
import { Decimal40 } from '../../../src/core/decimal.js'
import { calculateHip3FeeRates } from '../../../src/hip3/index.js'

/**
 * Official HIP-3 deployer fee worked-example table, re-verified 2026-09-17.
 *
 * Source: `HL.DOC.HIP3_DEPLOYER_ACTIONS.2026-08-12` (`SetDeployerFees` schema plus the worked
 * example table) and `HL.DOC.FEES.2026-08-12` (deployer fee share prose).
 *
 * The schema states the SCALE: `scale: string; // Decimal string in [0.0, 3.0], or [0.0, 10.0)
 * when growthMode is true`. The Fees page states the deployer SHARE: "HIP-3 deployers can configure
 * an additional fee share between 0-300% (0-100% for growth mode)". These are two units for one
 * limit, not two limits: growth mode multiplies every fee by 0.1, so growth scale 10 is a 300% x 0.1
 * = 100% share ceiling and non-growth scale 3 is the 300% share ceiling. They reconcile exactly.
 *
 * The rows below assume a positive normal user fee of 1 unit and non-aligned collateral (x = y = 1),
 * so `takerRate` is `1`, `activeReferralDiscount` is `0` and `isAlignedQuoteToken` is false.
 * `userFeeToProtocol` is the protocol leg P and `userFeeToDeployer` is the deployer leg D.
 *
 * `calculateHip3FeeRates` returns the all-in effective rate P + D. The split is derivable from the
 * returned `deployerShare`: D = allIn * deployerShare and P = allIn - D. Hand derivation for each
 * row, with `hip3Scale = scale < 1 ? scale + 1 : scale * 2`,
 * `deployerShare = scale < 1 ? scale / (1 + scale) : 0.5` and
 * `growthMultiplier = growthMode ? 0.1 : 1`:
 *
 *   false/0     -> hip3Scale 1,     allIn 1 * 1 * 1       = 1;     share 0    -> D 0,     P 1
 *   false/0.5   -> hip3Scale 1.5,   allIn 1 * 1.5 * 1     = 1.5;   share 1/3  -> D 0.5,   P 1
 *   false/1     -> hip3Scale 2,     allIn 1 * 2 * 1       = 2;     share 0.5  -> D 1,     P 1
 *   false/3     -> hip3Scale 6,     allIn 1 * 6 * 1       = 6;     share 0.5  -> D 3,     P 3
 *   true/0      -> hip3Scale 1,     allIn 1 * 1 * 0.1     = 0.1;   share 0    -> D 0,     P 0.1
 *   true/0.5    -> hip3Scale 1.5,   allIn 1 * 1.5 * 0.1   = 0.15;  share 1/3  -> D 0.05,  P 0.1
 *   true/1      -> hip3Scale 2,     allIn 1 * 2 * 0.1     = 0.2;   share 0.5  -> D 0.1,   P 0.1
 *   true/3.01   -> hip3Scale 6.02,  allIn 1 * 6.02 * 0.1  = 0.602; share 0.5  -> D 0.301, P 0.301
 *   true/9.99   -> hip3Scale 19.98, allIn 1 * 19.98 * 0.1 = 1.998; share 0.5  -> D 0.999, P 0.999
 */
const officialRows = [
  {
    growthMode: false,
    deployerFeeScale: '0',
    userFeeToProtocol: '1',
    userFeeToDeployer: '0',
    allInRate: '1',
  },
  {
    growthMode: false,
    deployerFeeScale: '0.5',
    userFeeToProtocol: '1',
    userFeeToDeployer: '0.5',
    allInRate: '1.5',
  },
  {
    growthMode: false,
    deployerFeeScale: '1',
    userFeeToProtocol: '1',
    userFeeToDeployer: '1',
    allInRate: '2',
  },
  {
    growthMode: false,
    deployerFeeScale: '3',
    userFeeToProtocol: '3',
    userFeeToDeployer: '3',
    allInRate: '6',
  },
  {
    growthMode: true,
    deployerFeeScale: '0',
    userFeeToProtocol: '0.1',
    userFeeToDeployer: '0',
    allInRate: '0.1',
  },
  {
    growthMode: true,
    deployerFeeScale: '0.5',
    userFeeToProtocol: '0.1',
    userFeeToDeployer: '0.05',
    allInRate: '0.15',
  },
  {
    growthMode: true,
    deployerFeeScale: '1',
    userFeeToProtocol: '0.1',
    userFeeToDeployer: '0.1',
    allInRate: '0.2',
  },
  {
    growthMode: true,
    deployerFeeScale: '3.01',
    userFeeToProtocol: '0.301',
    userFeeToDeployer: '0.301',
    allInRate: '0.602',
  },
  {
    growthMode: true,
    deployerFeeScale: '9.99',
    userFeeToProtocol: '0.999',
    userFeeToDeployer: '0.999',
    allInRate: '1.998',
  },
] as const

describe('HIP-3 official deployer fee worked-example table', () => {
  it.each(officialRows)(
    'reproduces growthMode $growthMode with feeScale $deployerFeeScale',
    ({ growthMode, deployerFeeScale, userFeeToProtocol, userFeeToDeployer, allInRate }) => {
      const result = calculateHip3FeeRates({
        makerRate: '0',
        takerRate: '1',
        activeReferralDiscount: '0',
        isAlignedQuoteToken: false,
        deployerFeeScale,
        growthMode,
      })

      expect(result.value.status).toBe('ok')
      if (result.value.status !== 'ok') return

      // The function returns the all-in rate, which is the official P + D.
      expect(new Decimal40(userFeeToProtocol).plus(userFeeToDeployer).toFixed()).toBe(allInRate)
      expect(result.value.data.effectiveTakerRate).toBe(allInRate)

      const deployerLeg = new Decimal40(result.value.data.effectiveTakerRate).mul(
        result.value.data.deployerShare,
      )
      const protocolLeg = new Decimal40(result.value.data.effectiveTakerRate).minus(deployerLeg)
      expect(deployerLeg.toFixed()).toBe(userFeeToDeployer)
      expect(protocolLeg.toFixed()).toBe(userFeeToProtocol)
    },
  )

  it('keeps the growth-mode share ceiling at the non-growth share ceiling times one tenth', () => {
    const nonGrowthCeiling = calculateHip3FeeRates({
      makerRate: '0',
      takerRate: '1',
      activeReferralDiscount: '0',
      isAlignedQuoteToken: false,
      deployerFeeScale: '3',
      growthMode: false,
    })
    const growthCeiling = calculateHip3FeeRates({
      makerRate: '0',
      takerRate: '1',
      activeReferralDiscount: '0',
      isAlignedQuoteToken: false,
      deployerFeeScale: '9.99',
      growthMode: true,
    })

    expect(nonGrowthCeiling.value.status).toBe('ok')
    expect(growthCeiling.value.status).toBe('ok')
    if (nonGrowthCeiling.value.status !== 'ok' || growthCeiling.value.status !== 'ok') return

    // 300% share ceiling: the deployer leg is three times the 1-unit normal user fee.
    const nonGrowthDeployerLeg = new Decimal40(nonGrowthCeiling.value.data.effectiveTakerRate).mul(
      nonGrowthCeiling.value.data.deployerShare,
    )
    expect(nonGrowthDeployerLeg.toFixed()).toBe('3')

    // 100% share ceiling under growth mode: scale 10 is excluded, so 9.99 approaches 0.999.
    const growthDeployerLeg = new Decimal40(growthCeiling.value.data.effectiveTakerRate).mul(
      growthCeiling.value.data.deployerShare,
    )
    expect(growthDeployerLeg.toFixed()).toBe('0.999')
  })
})
