import { describe, expect, it } from 'vitest'
import { calculateUnifiedAccountRatio } from '../../../src/margin/index.js'

type DexRow = {
  dexIndex: number
  collateralToken: number
  crossMaintenanceMarginUsed: string
  isolatedMarginUsed: string
}

type SpotRow = { token: number; total: string }

// Test-only number arithmetic copied from the official TypeScript reference documented by
// HL.DOC.ACCOUNT_ABSTRACTION.2026-07-30. It is comparison evidence, not normative truth.
function officialFloatReference(
  dexes: readonly DexRow[],
  spotBalances: readonly SpotRow[],
): number {
  const crossByToken = new Map<number, number>()
  const isolatedByToken = new Map<number, number>()
  for (const dex of dexes) {
    crossByToken.set(
      dex.collateralToken,
      (crossByToken.get(dex.collateralToken) ?? 0) + Number(dex.crossMaintenanceMarginUsed),
    )
    isolatedByToken.set(
      dex.collateralToken,
      (isolatedByToken.get(dex.collateralToken) ?? 0) + Number(dex.isolatedMarginUsed),
    )
  }

  let maximum = 0
  for (const [token, cross] of crossByToken) {
    const total = Number(spotBalances.find((row) => row.token === token)?.total ?? 0)
    const available = total - (isolatedByToken.get(token) ?? 0)
    if (available > 0) maximum = Math.max(maximum, cross / available)
  }
  return maximum
}

describe('unified account ratio official differential', () => {
  it('matches the official reference on the shared positive-available domain', () => {
    const dexes = [
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
    ] as const
    const spotBalances = [{ token: 0, total: '11.5' }] as const

    const result = calculateUnifiedAccountRatio({ dexes, spotBalances })
    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(Number(result.value.data.accountRatio)).toBe(officialFloatReference(dexes, spotBalances))
  })

  it('declares the occupied non-positive available divergence', () => {
    const dexes = [
      {
        dexIndex: 0,
        collateralToken: 0,
        crossMaintenanceMarginUsed: '1',
        isolatedMarginUsed: '0',
      },
    ] as const
    const spotBalances = [{ token: 0, total: '0' }] as const

    expect(officialFloatReference(dexes, spotBalances)).toBe(0)
    expect(calculateUnifiedAccountRatio({ dexes, spotBalances }).value.status).toBe('indeterminate')
  })

  it('declares the missing spot row divergence', () => {
    const dexes = [
      {
        dexIndex: 0,
        collateralToken: 0,
        crossMaintenanceMarginUsed: '0',
        isolatedMarginUsed: '0',
      },
    ] as const

    expect(officialFloatReference(dexes, [])).toBe(0)
    expect(calculateUnifiedAccountRatio({ dexes, spotBalances: [] }).value.status).toBe(
      'invalid-input',
    )
  })
})
