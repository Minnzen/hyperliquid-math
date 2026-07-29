import { describe, expect, it } from 'vitest'
import { calculateUnifiedAccountRatio } from '../../../src/margin/index.js'

function expectInvalid(result: { value: { status: string } }) {
  expect(result.value.status).toBe('invalid-input')
}

const validDex = {
  dexIndex: 0,
  collateralToken: 0,
  crossMaintenanceMarginUsed: '1',
  isolatedMarginUsed: '0',
} as const
const validSpot = { token: 0, total: '2' } as const

describe('unified account ratio validation boundaries', () => {
  it('rejects duplicate DEX indexes even when collateral tokens differ', () => {
    expectInvalid(
      calculateUnifiedAccountRatio({
        dexes: [validDex, { ...validDex, collateralToken: 1 }],
        spotBalances: [validSpot, { token: 1, total: '2' }],
      }),
    )
  })

  it('rejects duplicate Spot token rows', () => {
    expectInvalid(
      calculateUnifiedAccountRatio({
        dexes: [validDex],
        spotBalances: [validSpot, { ...validSpot, total: '3' }],
      }),
    )
  })

  it.each([
    { ...validDex, crossMaintenanceMarginUsed: '-1' },
    { ...validDex, isolatedMarginUsed: '-1' },
    { ...validDex, dexIndex: -1 },
    { ...validDex, collateralToken: -1 },
  ])('rejects invalid DEX row %j', (dex) => {
    expectInvalid(
      calculateUnifiedAccountRatio({
        dexes: [dex],
        spotBalances: [validSpot],
      }),
    )
  })

  it('rejects sparse DEX and Spot arrays', () => {
    const sparseDexes = new Array(1)
    const sparseSpotBalances = new Array(1)

    expectInvalid(
      calculateUnifiedAccountRatio({
        dexes: sparseDexes,
        spotBalances: [],
      } as never),
    )
    expectInvalid(
      calculateUnifiedAccountRatio({
        dexes: [],
        spotBalances: sparseSpotBalances,
      } as never),
    )
  })

  it('rejects more than 1024 DEX or Spot rows before aggregation', () => {
    const dexes = Array.from({ length: 1025 }, (_, dexIndex) => ({
      ...validDex,
      dexIndex,
    }))
    const spotBalances = Array.from({ length: 1025 }, (_, token) => ({
      token,
      total: '0',
    }))

    expectInvalid(
      calculateUnifiedAccountRatio({
        dexes,
        spotBalances: [validSpot],
      }),
    )
    expectInvalid(
      calculateUnifiedAccountRatio({
        dexes: [],
        spotBalances,
      }),
    )
  })

  it('enforces exact input and row key sets', () => {
    expectInvalid(
      calculateUnifiedAccountRatio({
        dexes: [{ ...validDex, extra: true }],
        spotBalances: [validSpot],
      } as never),
    )
    expectInvalid(
      calculateUnifiedAccountRatio({
        dexes: [validDex],
        spotBalances: [{ ...validSpot, extra: true }],
      } as never),
    )
    expectInvalid(
      calculateUnifiedAccountRatio({
        dexes: [validDex],
        spotBalances: [validSpot],
        extra: true,
      } as never),
    )
  })
})
