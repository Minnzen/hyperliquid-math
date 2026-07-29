import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { calculateUnifiedAccountRatio } from '../../../src/margin/index.js'

const orderingSeed = 0x6_6001
const splitSeed = 0x6_6002
const unrelatedSpotSeed = 0x6_6003

describe('unified account ratio properties', () => {
  it('is invariant to DEX and Spot row ordering and keeps token output sorted', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000 }),
        fc.integer({ min: 0, max: 1_000 }),
        (cross0, cross1) => {
          const dexes = [
            {
              dexIndex: 7,
              collateralToken: 5,
              crossMaintenanceMarginUsed: cross0.toString(),
              isolatedMarginUsed: '1',
            },
            {
              dexIndex: 2,
              collateralToken: 1,
              crossMaintenanceMarginUsed: cross1.toString(),
              isolatedMarginUsed: '2',
            },
          ] as const
          const spotBalances = [
            { token: 5, total: '2000' },
            { token: 1, total: '2000' },
          ] as const

          const forward = calculateUnifiedAccountRatio({ dexes, spotBalances })
          const reversed = calculateUnifiedAccountRatio({
            dexes: [...dexes].reverse(),
            spotBalances: [...spotBalances].reverse(),
          })

          expect(forward.value.status).toBe('ok')
          expect(reversed.value.status).toBe('ok')
          if (forward.value.status !== 'ok' || reversed.value.status !== 'ok') return
          expect(reversed.value.data).toEqual(forward.value.data)
          expect(
            forward.value.data.tokens.map(
              (row: { readonly collateralToken: number }) => row.collateralToken,
            ),
          ).toEqual([1, 5])
        },
      ),
      { numRuns: 300, seed: orderingSeed },
    )
  })

  it('is invariant when one DEX contribution is split across two unique DEX rows', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000 }),
        fc.integer({ min: 0, max: 1_000 }),
        fc.integer({ min: 0, max: 1_000 }),
        fc.integer({ min: 0, max: 1_000 }),
        (crossA, crossB, isolatedA, isolatedB) => {
          const combined = calculateUnifiedAccountRatio({
            dexes: [
              {
                dexIndex: 0,
                collateralToken: 3,
                crossMaintenanceMarginUsed: (crossA + crossB).toString(),
                isolatedMarginUsed: (isolatedA + isolatedB).toString(),
              },
            ],
            spotBalances: [{ token: 3, total: '5000' }],
          })
          const split = calculateUnifiedAccountRatio({
            dexes: [
              {
                dexIndex: 0,
                collateralToken: 3,
                crossMaintenanceMarginUsed: crossA.toString(),
                isolatedMarginUsed: isolatedA.toString(),
              },
              {
                dexIndex: 1,
                collateralToken: 3,
                crossMaintenanceMarginUsed: crossB.toString(),
                isolatedMarginUsed: isolatedB.toString(),
              },
            ],
            spotBalances: [{ token: 3, total: '5000' }],
          })

          expect(combined.value.status).toBe('ok')
          expect(split.value.status).toBe('ok')
          if (combined.value.status !== 'ok' || split.value.status !== 'ok') return
          expect(split.value.data).toEqual(combined.value.data)
        },
      ),
      { numRuns: 300, seed: splitSeed },
    )
  })

  it('ignores validated Spot rows that are not referenced by any DEX', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000, max: 1_000 }), (unreferencedTotal) => {
        const input = {
          dexes: [
            {
              dexIndex: 0,
              collateralToken: 0,
              crossMaintenanceMarginUsed: '3',
              isolatedMarginUsed: '1',
            },
          ],
          spotBalances: [{ token: 0, total: '10' }],
        } as const
        const base = calculateUnifiedAccountRatio(input)
        const extended = calculateUnifiedAccountRatio({
          ...input,
          spotBalances: [...input.spotBalances, { token: 99, total: unreferencedTotal.toString() }],
        })

        expect(base.value.status).toBe('ok')
        expect(extended.value.status).toBe('ok')
        if (base.value.status !== 'ok' || extended.value.status !== 'ok') return
        expect(extended.value.data).toEqual(base.value.data)
      }),
      { numRuns: 300, seed: unrelatedSpotSeed },
    )
  })
})
