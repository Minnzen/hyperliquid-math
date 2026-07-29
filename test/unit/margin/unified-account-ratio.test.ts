import { describe, expect, it } from 'vitest'
import { calculateUnifiedAccountRatio } from '../../../src/margin/index.js'

describe('calculateUnifiedAccountRatio', () => {
  it('aggregates DEX maintenance by collateral token and returns the maximum ratio', () => {
    const result = calculateUnifiedAccountRatio({
      dexes: [
        {
          dexIndex: 0,
          collateralToken: 0,
          crossMaintenanceMarginUsed: '2',
          isolatedMarginUsed: '1',
        },
        {
          dexIndex: 1,
          collateralToken: 0,
          crossMaintenanceMarginUsed: '3',
          isolatedMarginUsed: '0.5',
        },
        {
          dexIndex: 2,
          collateralToken: 1,
          crossMaintenanceMarginUsed: '1',
          isolatedMarginUsed: '0',
        },
      ],
      spotBalances: [
        { token: 0, total: '11.5' },
        { token: 1, total: '4' },
      ],
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        tokens: [
          {
            collateralToken: 0,
            spotTotal: '11.5',
            crossMaintenanceMarginUsed: '5',
            isolatedMarginUsed: '1.5',
            available: '10',
            ratio: '0.5',
          },
          {
            collateralToken: 1,
            spotTotal: '4',
            crossMaintenanceMarginUsed: '1',
            isolatedMarginUsed: '0',
            available: '4',
            ratio: '0.25',
          },
        ],
        accountRatio: '0.5',
      },
    })
    expect(result.trace).toMatchObject({
      formulaId: 'hl.margin.unified-account-ratio.calculate',
      formulaVersion: 1,
      authority: 'local-exact',
      maturity: 'experimental',
      completion: { status: 'complete' },
      sourceRefs: expect.arrayContaining([
        'HLM.SPEC.MARGIN.UNIFIED_ACCOUNT_RATIO.V1',
        'HL.DOC.ACCOUNT_ABSTRACTION.2026-07-30',
        'DECIMALJS.10.6.0',
      ]),
    })
  })

  it('returns zero for an empty DEX set and excludes unreferenced spot rows', () => {
    const result = calculateUnifiedAccountRatio({
      dexes: [],
      spotBalances: [{ token: 7, total: '100' }],
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: { tokens: [], accountRatio: '0' },
    })
  })

  it.each(['0', '-5'])(
    'returns ratio zero without division for a zero-occupation token with total %s',
    (total) => {
      const result = calculateUnifiedAccountRatio({
        dexes: [
          {
            dexIndex: 0,
            collateralToken: 0,
            crossMaintenanceMarginUsed: '0',
            isolatedMarginUsed: '0',
          },
        ],
        spotBalances: [{ token: 0, total }],
      })

      expect(result.value).toEqual({
        status: 'ok',
        data: {
          tokens: [
            {
              collateralToken: 0,
              spotTotal: total,
              crossMaintenanceMarginUsed: '0',
              isolatedMarginUsed: '0',
              available: total,
              ratio: '0',
            },
          ],
          accountRatio: '0',
        },
      })
    },
  )

  it.each([
    {
      crossMaintenanceMarginUsed: '1',
      isolatedMarginUsed: '0',
      total: '0',
    },
    {
      crossMaintenanceMarginUsed: '0',
      isolatedMarginUsed: '2',
      total: '1',
    },
  ])('fails closed for occupied non-positive available input %j', (amounts) => {
    const result = calculateUnifiedAccountRatio({
      dexes: [
        {
          dexIndex: 0,
          collateralToken: 0,
          crossMaintenanceMarginUsed: amounts.crossMaintenanceMarginUsed,
          isolatedMarginUsed: amounts.isolatedMarginUsed,
        },
      ],
      spotBalances: [{ token: 0, total: amounts.total }],
    })

    expect(result.value).toMatchObject({
      status: 'indeterminate',
      reason: {
        code: 'non-positive-unified-available-balance',
        path: '/spotBalances/0/total',
      },
    })
    expect(result.value).not.toHaveProperty('data')
  })

  it('rejects a missing referenced spot row instead of defaulting it to zero', () => {
    const result = calculateUnifiedAccountRatio({
      dexes: [
        {
          dexIndex: 0,
          collateralToken: 0,
          crossMaintenanceMarginUsed: '0',
          isolatedMarginUsed: '0',
        },
      ],
      spotBalances: [],
    })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [
        expect.objectContaining({
          code: 'missing-unified-spot-balance',
          path: '/spotBalances',
        }),
      ],
    })
  })
})
