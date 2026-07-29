import { describe, expect, it } from 'vitest'
import { calculateUnifiedAccountRatio } from '../../../src/margin/index.js'

describe('unified account ratio directed mutation-kill vectors', () => {
  it('kills a sum-of-token-ratios mutant by returning the maximum token ratio', () => {
    const result = calculateUnifiedAccountRatio({
      dexes: [
        {
          dexIndex: 0,
          collateralToken: 0,
          crossMaintenanceMarginUsed: '1',
          isolatedMarginUsed: '0',
        },
        {
          dexIndex: 1,
          collateralToken: 1,
          crossMaintenanceMarginUsed: '1',
          isolatedMarginUsed: '0',
        },
      ],
      spotBalances: [
        { token: 0, total: '2' },
        { token: 1, total: '4' },
      ],
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        tokens: [
          {
            collateralToken: 0,
            spotTotal: '2',
            crossMaintenanceMarginUsed: '1',
            isolatedMarginUsed: '0',
            available: '2',
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
  })

  it('kills an isolated-margin omission mutant by reducing available before division', () => {
    const withoutIsolated = calculateUnifiedAccountRatio({
      dexes: [
        {
          dexIndex: 0,
          collateralToken: 0,
          crossMaintenanceMarginUsed: '2',
          isolatedMarginUsed: '0',
        },
      ],
      spotBalances: [{ token: 0, total: '10' }],
    })
    const withIsolated = calculateUnifiedAccountRatio({
      dexes: [
        {
          dexIndex: 0,
          collateralToken: 0,
          crossMaintenanceMarginUsed: '2',
          isolatedMarginUsed: '2',
        },
      ],
      spotBalances: [{ token: 0, total: '10' }],
    })

    expect(withoutIsolated.value).toMatchObject({
      status: 'ok',
      data: { tokens: [{ available: '10', ratio: '0.2' }], accountRatio: '0.2' },
    })
    expect(withIsolated.value).toMatchObject({
      status: 'ok',
      data: { tokens: [{ available: '8', ratio: '0.25' }], accountRatio: '0.25' },
    })
  })

  it('keeps the whole call indeterminate when any occupied token has no positive available balance', () => {
    const dexes = [
      {
        dexIndex: 0,
        collateralToken: 0,
        crossMaintenanceMarginUsed: '1',
        isolatedMarginUsed: '0',
      },
      {
        dexIndex: 1,
        collateralToken: 1,
        crossMaintenanceMarginUsed: '1',
        isolatedMarginUsed: '0',
      },
    ] as const
    const spotBalances = [
      { token: 0, total: '2' },
      { token: 1, total: '0' },
    ] as const

    for (const result of [
      calculateUnifiedAccountRatio({ dexes, spotBalances }),
      calculateUnifiedAccountRatio({
        dexes: [...dexes].reverse(),
        spotBalances: [...spotBalances].reverse(),
      }),
    ]) {
      expect(result.value).toMatchObject({
        status: 'indeterminate',
        reason: { code: 'non-positive-unified-available-balance' },
      })
      expect(result.value).not.toHaveProperty('data')
    }
  })

  it('does not let a negative zero-occupation token change a positive account ratio', () => {
    const result = calculateUnifiedAccountRatio({
      dexes: [
        {
          dexIndex: 0,
          collateralToken: 0,
          crossMaintenanceMarginUsed: '1',
          isolatedMarginUsed: '0',
        },
        {
          dexIndex: 1,
          collateralToken: 1,
          crossMaintenanceMarginUsed: '0',
          isolatedMarginUsed: '0',
        },
      ],
      spotBalances: [
        { token: 0, total: '4' },
        { token: 1, total: '-100' },
      ],
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        tokens: [
          { collateralToken: 0, ratio: '0.25' },
          { collateralToken: 1, available: '-100', ratio: '0' },
        ],
        accountRatio: '0.25',
      },
    })
  })
})
