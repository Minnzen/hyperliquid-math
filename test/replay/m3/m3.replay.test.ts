import { readFile } from 'node:fs/promises'
import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'

interface M3LiveFixture {
  sourceId: string
  network: 'mainnet' | 'testnet'
  selection: {
    marginSummary: { accountValue: string }
    crossMarginSummary: { accountValue: string }
  }
  officialSchemaExamples?: {
    clearinghouseStateIsolatedPosition?: {
      position: {
        positionValue: string
        unrealizedPnl: string
        leverage: { type: 'isolated'; rawUsd: string }
      }
      accountSummaries: {
        crossMarginSummary: { accountValue: string }
        marginSummary: { accountValue: string }
      }
      mappingAssertions: {
        crossAccountValueSource: string
        isolatedMarginValueSource: string
        isolatedMarginValue: string
        isolatedMarginValueIncludesUnrealizedPnl: boolean
        isolatedPositionRawUsdField: string
      }
    }
  }
  liveActionGates?: Array<{ name: string; status: string; reason: string }>
}

interface UpdateLeverageHarness {
  status: string
  reason: string
  containsSecrets: boolean
  containsSignature: boolean
  containsNonce: boolean
  matrix: Array<{ status: string; reason: string; action: Record<string, unknown> }>
  executionGuard: {
    requiresExplicitCredentials: boolean
    requiresTestnetOnly: boolean
    forbiddenNetworks: readonly string[]
    forbiddenFields: readonly string[]
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

describe('M3 offline fixture replay', () => {
  it('maps scenario cross account value from crossMarginSummary rather than marginSummary', async () => {
    const mainnet = await readJson<M3LiveFixture>('fixtures/live/2026-07-19-mainnet-m3.json')

    expect(mainnet.selection.crossMarginSummary.accountValue).toBe('3001412.122254')
    expect(mainnet.selection.marginSummary.accountValue).toBe('3001412.122254')
  })

  it('maps the official isolated schema example without double-counting isolated value into cross', async () => {
    const mainnet = await readJson<M3LiveFixture>('fixtures/live/2026-07-19-mainnet-m3.json')
    const example = mainnet.officialSchemaExamples?.clearinghouseStateIsolatedPosition
    expect(example).toBeDefined()
    if (example === undefined) return

    const cross = new Decimal(example.accountSummaries.crossMarginSummary.accountValue)
    const total = new Decimal(example.accountSummaries.marginSummary.accountValue)
    const isolated = total.minus(cross)
    const rawPlusPositionValue = new Decimal(example.position.leverage.rawUsd).plus(
      example.position.positionValue,
    )

    expect(example.mappingAssertions.crossAccountValueSource).toBe(
      'crossMarginSummary.accountValue',
    )
    expect(example.mappingAssertions.isolatedMarginValueSource).toBe(
      'marginSummary.accountValue - crossMarginSummary.accountValue',
    )
    expect(isolated.toFixed(6)).toBe(example.mappingAssertions.isolatedMarginValue)
    expect(rawPlusPositionValue.toFixed(6)).toBe(example.mappingAssertions.isolatedMarginValue)
    expect(example.mappingAssertions.isolatedMarginValueIncludesUnrealizedPnl).toBe(true)
  })

  it('keeps M3 testnet live action gates explicit when credentials are missing', async () => {
    const testnet = await readJson<M3LiveFixture>('fixtures/live/2026-07-19-testnet-m3.json')

    expect(testnet.liveActionGates).toEqual([
      { name: 'updateLeverage', status: 'not-executed', reason: 'missing-testnet-credentials' },
      {
        name: 'updateIsolatedMargin',
        status: 'not-executed',
        reason: 'missing-testnet-credentials',
      },
      { name: 'actual-fill-replay', status: 'not-executed', reason: 'missing-testnet-credentials' },
    ])
  })

  it('keeps the updateLeverage harness offline and free of secret-bearing fields', async () => {
    const harness = await readJson<UpdateLeverageHarness>(
      'fixtures/testnet/update-leverage-m3-harness.json',
    )

    expect(harness).toMatchObject({
      status: 'not-executed',
      reason: 'missing-testnet-credentials',
      containsSecrets: false,
      containsSignature: false,
      containsNonce: false,
      executionGuard: {
        requiresExplicitCredentials: true,
        requiresTestnetOnly: true,
        forbiddenNetworks: ['mainnet'],
      },
    })
    expect(harness.executionGuard.forbiddenFields).toEqual(
      expect.arrayContaining(['signature', 'nonce', 'privateKey', 'secretKey']),
    )
    for (const entry of harness.matrix) {
      expect(entry.status).toBe('not-executed')
      expect(entry.reason).toBe('missing-testnet-credentials')
      expect(entry.action).not.toHaveProperty('signature')
      expect(entry.action).not.toHaveProperty('nonce')
      expect(entry.action).not.toHaveProperty('privateKey')
      expect(entry.action).not.toHaveProperty('secretKey')
    }
  })
})
