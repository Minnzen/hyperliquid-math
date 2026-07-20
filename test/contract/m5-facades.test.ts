import { describe, expect, it } from 'vitest'
import {
  calculateHip3FeeRates,
  calculateSpotOrderDeltas,
  calculateSpotPortfolioValue,
  convertSpotTokenUnits,
  evaluateHip1AnchorGenesisEligibility,
  evaluateHip3MarginMode,
  evaluateSpotDustEligibility,
  projectSpotDustAllocation,
  projectSpotPositionEvent,
  resolveHip3CollateralSource,
  validateHip1Deployment,
} from '../../src/index.js'
import { m5Results } from '../helpers/m5-results.js'

const facades = [
  ['convertSpotTokenUnits', convertSpotTokenUnits],
  ['calculateSpotOrderDeltas', calculateSpotOrderDeltas],
  ['projectSpotPositionEvent', projectSpotPositionEvent],
  ['calculateSpotPortfolioValue', calculateSpotPortfolioValue],
  ['evaluateSpotDustEligibility', evaluateSpotDustEligibility],
  ['projectSpotDustAllocation', projectSpotDustAllocation],
  ['validateHip1Deployment', validateHip1Deployment],
  ['evaluateHip1AnchorGenesisEligibility', evaluateHip1AnchorGenesisEligibility],
  ['resolveHip3CollateralSource', resolveHip3CollateralSource],
  ['evaluateHip3MarginMode', evaluateHip3MarginMode],
  ['calculateHip3FeeRates', calculateHip3FeeRates],
] as const

const expectedSourceRefs = {
  spotUnits: 'HLM.SPEC.SPOT.UNITS_CONVERT.V1',
  spotOrderDeltas: 'HLM.SPEC.SPOT.ORDER_DELTAS.V1',
  spotPositionEvent: 'HLM.SPEC.SPOT.POSITION_EVENT_PROJECT.V1',
  spotPortfolioValue: 'HLM.SPEC.SPOT.PORTFOLIO_VALUE.V1',
  spotDustEligibility: 'HLM.SPEC.SPOT.DUST_ELIGIBILITY.V1',
  spotDustAllocation: 'HLM.SPEC.SPOT.DUST_ALLOCATION_PROJECT.V1',
  hip1Deployment: 'HLM.SPEC.HIP1.DEPLOYMENT_VALIDATE.V1',
  hip1AnchorGenesis: 'HLM.SPEC.HIP1.ANCHOR_GENESIS_EVALUATE.V1',
  hip3CollateralSource: 'HLM.SPEC.HIP3.COLLATERAL_SOURCE.V1',
  hip3MarginMode: 'HLM.SPEC.HIP3.MARGIN_MODE.V1',
  hip3FeeRates: 'HLM.SPEC.HIP3.FEE_RATES.V1',
} as const

function accessorValue(reads: { count: number }, value: string) {
  return Object.defineProperty({}, 'kind', {
    enumerable: true,
    get() {
      reads.count += 1
      return value
    },
  })
}

describe('M5 public facade safety', () => {
  it.each(facades)('%s rejects a revoked root proxy without throwing', (_name, facade) => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()

    expect(() => (facade as (input: never) => unknown)(proxy as never)).not.toThrow()
    const result = (facade as (input: never) => { value: { status: string } })(proxy as never)
    expect(result.value.status).toBe('invalid-input')
  })

  it('keeps invalid M5 traces assumption-free', () => {
    const invalidResults = facades.map(([, facade]) =>
      (
        facade as (input: never) => {
          value: { status: string }
          trace: { completion: { status: string }; assumptions: readonly unknown[] }
        }
      )(null as never),
    )

    for (const result of invalidResults) {
      expect(result.value.status).toBe('invalid-input')
      expect(result.trace.completion.status).toBe('incomplete')
      expect(result.trace.assumptions).toEqual([])
    }
  })

  it('rejects hostile and revoked nested inputs without accessor leaks', () => {
    const reads = { count: 0 }
    const { proxy: revokedEvent, revoke: revokeEvent } = Proxy.revocable({}, {})
    const { proxy: revokedBalance, revoke: revokeBalance } = Proxy.revocable({}, {})
    revokeEvent()
    revokeBalance()

    const calls = [
      () =>
        convertSpotTokenUnits({
          value: '1',
          weiDecimals: 6,
          direction: accessorValue(reads, 'human-to-minimal'),
        } as never),
      () =>
        calculateSpotOrderDeltas({
          side: accessorValue(reads, 'buy'),
          baseSize: '1',
          price: '1',
        } as never),
      () =>
        projectSpotPositionEvent({
          position: { kind: 'flat' },
          event: revokedEvent,
        } as never),
      () =>
        calculateSpotPortfolioValue({
          balances: [revokedBalance],
        } as never),
      () =>
        projectSpotDustAllocation({
          aggregateDustSize: '1',
          executedProceeds: '1',
          userDustSize: accessorValue(reads, '1'),
          aggregateLotSize: '1',
        } as never),
      () =>
        resolveHip3CollateralSource({
          accountAbstractionMode: accessorValue(reads, 'standard'),
          dex: 'dex:blue',
          collateralTokenIndex: 0,
          validatorPerpUsdcTokenIndex: 0,
        } as never),
      () =>
        evaluateHip3MarginMode({
          assetMarginMode: accessorValue(reads, 'normal'),
          requestedMode: 'cross',
        } as never),
    ]

    for (const call of calls) {
      expect(call).not.toThrow()
      expect(call().value.status).toBe('invalid-input')
    }
    expect(reads.count).toBe(0)
  })

  it('records normalized inputs and source references for every successful M5 trace', () => {
    const results = m5Results()

    expect(results.traceContracts).toEqual({
      spotUnits: expect.objectContaining({
        formulaId: 'hl.spot.units.convert',
        authority: 'local-exact',
        maturity: 'stable',
        sourceRefs: expect.arrayContaining([expectedSourceRefs.spotUnits, 'DECIMALJS.10.6.0']),
      }),
      spotOrderDeltas: expect.objectContaining({
        formulaId: 'hl.spot.order-deltas.calculate',
        authority: 'local-exact',
        maturity: 'stable',
        sourceRefs: expect.arrayContaining([
          expectedSourceRefs.spotOrderDeltas,
          'DECIMALJS.10.6.0',
        ]),
      }),
      spotPositionEvent: expect.objectContaining({
        formulaId: 'hl.spot.position-event.project',
        authority: 'local-exact',
        maturity: 'stable',
        sourceRefs: expect.arrayContaining([
          expectedSourceRefs.spotPositionEvent,
          'DECIMALJS.10.6.0',
        ]),
      }),
      spotPortfolioValue: expect.objectContaining({
        formulaId: 'hl.spot.portfolio-value.calculate',
        authority: 'local-exact',
        maturity: 'stable',
        sourceRefs: expect.arrayContaining([
          expectedSourceRefs.spotPortfolioValue,
          'DECIMALJS.10.6.0',
        ]),
      }),
      spotDustEligibility: expect.objectContaining({
        formulaId: 'hl.spot.dust-eligibility.evaluate',
        authority: 'local-exact',
        maturity: 'stable',
        sourceRefs: expect.arrayContaining([
          expectedSourceRefs.spotDustEligibility,
          'DECIMALJS.10.6.0',
        ]),
      }),
      spotDustAllocation: expect.objectContaining({
        formulaId: 'hl.spot.dust-allocation.project',
        authority: 'local-exact',
        maturity: 'experimental',
        sourceRefs: expect.arrayContaining([
          expectedSourceRefs.spotDustAllocation,
          'DECIMALJS.10.6.0',
        ]),
      }),
      hip1Deployment: expect.objectContaining({
        formulaId: 'hl.hip1.deployment.validate',
        authority: 'local-exact',
        maturity: 'experimental',
        sourceRefs: expect.arrayContaining([expectedSourceRefs.hip1Deployment, 'DECIMALJS.10.6.0']),
      }),
      hip1AnchorGenesis: expect.objectContaining({
        formulaId: 'hl.hip1.anchor-genesis.evaluate',
        authority: 'local-exact',
        maturity: 'experimental',
        sourceRefs: expect.arrayContaining([
          expectedSourceRefs.hip1AnchorGenesis,
          'DECIMALJS.10.6.0',
        ]),
      }),
      hip3CollateralSource: expect.objectContaining({
        formulaId: 'hl.hip3.collateral-source.resolve',
        authority: 'local-exact',
        maturity: 'experimental',
        sourceRefs: expect.arrayContaining([expectedSourceRefs.hip3CollateralSource]),
      }),
      hip3MarginMode: expect.objectContaining({
        formulaId: 'hl.hip3.margin-mode.evaluate',
        authority: 'local-exact',
        maturity: 'experimental',
        sourceRefs: expect.arrayContaining([expectedSourceRefs.hip3MarginMode]),
      }),
      hip3FeeRates: expect.objectContaining({
        formulaId: 'hl.hip3.fee-rates.calculate',
        authority: 'local-exact',
        maturity: 'experimental',
        sourceRefs: expect.arrayContaining([expectedSourceRefs.hip3FeeRates, 'DECIMALJS.10.6.0']),
      }),
    })
  })

  it('returns explicit deterministic M5 values for representative fixtures', () => {
    expect(m5Results().values).toEqual({
      spotUnits: { status: 'ok', data: { value: '123456000' } },
      spotOrderDeltas: {
        status: 'ok',
        data: { notional: '10', baseDelta: '2.5', quoteDelta: '-10' },
      },
      spotPositionEvent: {
        status: 'ok',
        data: {
          previousState: { kind: 'open', balance: '2', entryPrice: '10' },
          nextState: { kind: 'open', balance: '1.5', entryPrice: '10' },
          classification: 'reduce',
          grossRealizedPnl: '1',
          feeAmount: '0.1',
          feeAccountValueDelta: '-0.1',
          closedPnl: '0.9',
          openedSize: '0',
          closedSize: '0.5',
        },
      },
      spotPortfolioValue: {
        status: 'ok',
        data: {
          tokens: [
            {
              tokenKey: 'hl:mainnet:spot:PURR%2FUSDC:0',
              balance: '3',
              entryPrice: '2',
              markPrice: '2.5',
              tokenValue: '7.5',
              entryNotional: '6',
              unrealizedPnl: '1.5',
            },
            {
              tokenKey: 'hl:mainnet:spot:HFUN%2FUSDC:1',
              balance: '4',
              entryPrice: '1',
              markPrice: '0.75',
              tokenValue: '3',
              entryNotional: '4',
              unrealizedPnl: '-1',
            },
          ],
          portfolioValue: '10.5',
          entryNotional: '10',
          unrealizedPnl: '0.5',
        },
      },
      spotDustEligibility: {
        status: 'ok',
        data: {
          lotSizeWei: '10000',
          lotSize: '0.0001',
          notionalUsd: '0.09',
          eligible: true,
          checks: [
            { status: 'satisfied', ruleId: 'hl.spot.dust.balance-below-lot' },
            { status: 'satisfied', ruleId: 'hl.spot.dust.notional-threshold' },
          ],
        },
      },
      spotDustAllocation: {
        status: 'ok',
        data: { mode: 'converted', allocationRatio: '0.2', userProceeds: '5' },
      },
      hip1Deployment: {
        status: 'ok',
        data: {
          lotSizeWei: '100000',
          totalGenesisWei: '1000000000000',
          checks: [
            { status: 'satisfied', ruleId: 'hl.hip1.deployment.name-code-points' },
            { status: 'satisfied', ruleId: 'hl.hip1.deployment.decimal-range' },
            { status: 'satisfied', ruleId: 'hl.hip1.deployment.sz-decimals-within-wei' },
            { status: 'satisfied', ruleId: 'hl.hip1.deployment.positive-max-supply' },
            { status: 'satisfied', ruleId: 'hl.hip1.deployment.genesis-max-supply-checksum' },
          ],
        },
      },
      hip1AnchorGenesis: {
        status: 'ok',
        data: { thresholdWei: '1.000001', weightWei: '0.999999', eligible: true },
      },
      hip3CollateralSource: {
        status: 'ok',
        data: {
          route: { kind: 'spot-balance', collateralTokenIndex: 7 },
          checks: [{ status: 'satisfied', ruleId: 'hl.hip3.collateral-source.mode-supported' }],
        },
      },
      hip3MarginMode: {
        status: 'ok',
        data: {
          supportedLocally: true,
          effectiveMarginMode: 'isolated',
          marginRemoval: 'strict',
          checks: [{ status: 'satisfied', ruleId: 'hl.hip3.margin-mode.local-support' }],
        },
      },
      hip3FeeRates: {
        status: 'ok',
        data: {
          effectiveMakerRate: '-0.00001333333333333333333333333333333333333333',
          effectiveTakerRate: '0.00004992',
          hip3Scale: '1.5',
          deployerShare: '0.3333333333333333333333333333333333333333',
          growthMultiplier: '0.1',
          alignedMakerScale: '1.333333333333333333333333333333333333333',
          alignedTakerScale: '0.8666666666666666666666666666666666666667',
          checks: [
            { status: 'satisfied', ruleId: 'hl.hip3.referral-discount-range' },
            { status: 'satisfied', ruleId: 'hl.hip3.deployer-fee-scale-range' },
            { status: 'satisfied', ruleId: 'hl.hip3.growth-mode-scale-range' },
          ],
        },
      },
    })
  })

  it('states material caller evidence in successful M5 assumptions', () => {
    const results = [
      convertSpotTokenUnits({ value: '1', weiDecimals: 6, direction: 'minimal-to-human' }),
      calculateSpotOrderDeltas({ side: 'sell', baseSize: '2', price: '5' }),
      projectSpotPositionEvent({
        position: { kind: 'flat' },
        event: { kind: 'transfer', size: '1', markPrice: '3', direction: 'in' },
      }),
      calculateSpotPortfolioValue({
        balances: [{ tokenKey: 'PURR', balance: '1', entryPrice: '2', markPrice: '3' }],
      }),
      evaluateSpotDustEligibility({
        balance: '0.00009',
        midPrice: '1000',
        weiDecimals: 8,
        szDecimals: 4,
        usdThreshold: '1',
      }),
      projectSpotDustAllocation({
        aggregateDustSize: '10',
        executedProceeds: '25',
        userDustSize: '2',
        aggregateLotSize: '1',
      }),
      validateHip1Deployment({
        name: 'HYPE',
        weiDecimals: 8,
        szDecimals: 3,
        maxSupplyWei: '1000000000000',
        userGenesisWei: '600000000000',
        anchorGenesisWei: '400000000000',
      }),
      resolveHip3CollateralSource({
        accountAbstractionMode: 'standard',
        dex: 'dex:blue',
        collateralTokenIndex: 7,
        validatorPerpUsdcTokenIndex: 0,
      }),
      calculateHip3FeeRates({
        makerRate: '-0.0001',
        takerRate: '0.0004',
        activeReferralDiscount: '0.04',
        isAlignedQuoteToken: true,
        deployerFeeScale: '0.5',
        growthMode: true,
      }),
    ]

    expect(results.map((result) => result.trace.assumptions)).toEqual([
      [{ kind: 'frozen-input', path: '/weiDecimals', value: 'caller-provided-token-metadata' }],
      [{ kind: 'frozen-input', path: '', value: 'caller-provided-spot-order-input' }],
      [
        { kind: 'frozen-input', path: '/event', value: 'caller-provided-explicit-spot-event' },
        {
          kind: 'frozen-input',
          path: '/event/markPrice',
          value: 'caller-provided-unverified-mark',
        },
      ],
      [
        {
          kind: 'frozen-input',
          path: '/balances/*/markPrice',
          value: 'caller-provided-unverified-mark',
        },
      ],
      [
        { kind: 'frozen-input', path: '/weiDecimals', value: 'caller-provided-token-metadata' },
        { kind: 'frozen-input', path: '/szDecimals', value: 'caller-provided-token-metadata' },
        { kind: 'frozen-input', path: '/midPrice', value: 'caller-provided-unverified-mid' },
      ],
      [
        {
          kind: 'frozen-input',
          path: '/executedProceeds',
          value: 'caller-provided-aggregate-sale-outcome',
        },
      ],
      [
        {
          kind: 'frozen-input',
          path: '',
          value: {
            name: 'HYPE',
            weiDecimals: 8,
            szDecimals: 3,
            maxSupplyWei: '1000000000000',
            userGenesisWei: '600000000000',
            anchorGenesisWei: '400000000000',
          },
        },
        {
          kind: 'frozen-input',
          path: '/nameCharacterCounting',
          value: 'ECMAScript Unicode code points; no trim, normalization, or case folding',
        },
      ],
      [
        {
          kind: 'frozen-input',
          path: '/accountAbstractionMode',
          value: 'caller-provided-mode',
        },
        {
          kind: 'frozen-input',
          path: '/dex',
          value: 'caller-provided-dated-dex-snapshot',
        },
        {
          kind: 'frozen-input',
          path: '/collateralTokenIndex',
          value: 'caller-provided-dated-token-index',
        },
        {
          kind: 'frozen-input',
          path: '/validatorPerpUsdcTokenIndex',
          value: 'caller-provided-dated-token-index',
        },
      ],
      [
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
      ],
    ])
  })
})
