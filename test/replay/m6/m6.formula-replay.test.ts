import { describe, expect, it } from 'vitest'
import {
  calculateOutcomeDualPrice,
  calculateOutcomeSettlement,
  calculateUnifiedAccountRatio,
  decodeAssetId,
  encodeAssetId,
  evaluateRecurringOutcome,
} from '../../../src/index.js'

describe('M6 deterministic formula replay', () => {
  it('replays identifier v2 outcome encoding in both directions', () => {
    const encoded = encodeAssetId({ kind: 'outcome', outcome: 42, side: 1 } as never)
    const decoded = decodeAssetId({ assetId: 100_000_421 })

    expect(encoded.value).toEqual({ status: 'ok', data: 100_000_421 })
    expect(decoded.value).toEqual({
      status: 'ok',
      data: { kind: 'outcome', outcome: 42, side: 1 },
    })
    expect(encoded.trace).toMatchObject({
      formulaId: 'hl.identifiers.asset-id.encode',
      formulaVersion: 2,
      maturity: 'experimental',
      sourceRefs: expect.arrayContaining([
        'HLM.SPEC.IDENTIFIERS.ASSET_ID.V2',
        'HL.DOC.ASSET_IDS.2026-07-30',
      ]),
    })
    expect(decoded.trace).toMatchObject({
      formulaId: 'hl.identifiers.asset-id.decode',
      formulaVersion: 2,
      maturity: 'experimental',
      sourceRefs: expect.arrayContaining([
        'HLM.SPEC.IDENTIFIERS.ASSET_ID.V2',
        'HL.DOC.ASSET_IDS.2026-07-30',
      ]),
    })
  })

  it('replays complementary outcome pricing and settlement projections', () => {
    const dual = calculateOutcomeDualPrice({ price: '0.37' })
    const settlement = calculateOutcomeSettlement({
      tokenSide: 'no',
      settleFraction: '0.8',
      size: '10',
      entryPrice: '0.63',
    })

    expect(dual.value).toEqual({ status: 'ok', data: { dualPrice: '0.63' } })
    expect(settlement.value).toEqual({
      status: 'ok',
      data: {
        payoutFraction: '0.2',
        settlementValue: '2',
        entryNotional: '6.3',
        grossPnl: '-4.3',
      },
    })
  })

  it('replays binary and bucket settlement boundaries from the same mark pair', () => {
    const binary = evaluateRecurringOutcome({
      class: 'priceBinary',
      markPrice0: '100',
      t0: 0,
      markPrice1: '110',
      t1: 10,
      settlementTime: 5,
      targetPrice: '105',
    })
    const bucket = evaluateRecurringOutcome({
      class: 'priceBucket',
      markPrice0: '100',
      t0: 0,
      markPrice1: '110',
      t1: 10,
      settlementTime: 5,
      priceThresholds: ['105', '110'],
    })

    expect(binary.value).toEqual({
      status: 'ok',
      data: {
        class: 'priceBinary',
        interpolatedMarkPrice: '105',
        settlesTo: 'yes',
        settleFraction: '1',
      },
    })
    expect(bucket.value).toEqual({
      status: 'ok',
      data: {
        class: 'priceBucket',
        interpolatedMarkPrice: '105',
        settledBucket: 1,
        settleFractions: ['0', '1', '0'],
      },
    })
  })

  it('replays Decimal40 unified aggregation without a binary float oracle', () => {
    const result = calculateUnifiedAccountRatio({
      dexes: [
        {
          dexIndex: 0,
          collateralToken: 0,
          crossMaintenanceMarginUsed: '1',
          isolatedMarginUsed: '1',
        },
      ],
      spotBalances: [{ token: 0, total: '4' }],
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        tokens: [
          {
            collateralToken: 0,
            spotTotal: '4',
            crossMaintenanceMarginUsed: '1',
            isolatedMarginUsed: '1',
            available: '3',
            ratio: '0.3333333333333333333333333333333333333333',
          },
        ],
        accountRatio: '0.3333333333333333333333333333333333333333',
      },
    })
    expect(result.trace).toMatchObject({
      formulaId: 'hl.margin.unified-account-ratio.calculate',
      formulaVersion: 1,
      authority: 'local-exact',
      maturity: 'experimental',
      sourceRefs: expect.arrayContaining([
        'HLM.SPEC.MARGIN.UNIFIED_ACCOUNT_RATIO.V1',
        'HL.DOC.ACCOUNT_ABSTRACTION.2026-07-30',
        'DECIMALJS.10.6.0',
      ]),
    })
  })
})
