import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

interface VerificationFixture {
  readonly serverLiquidationPrice: string | null
  readonly serverMaintenanceMargin: string
  readonly serverInitialMargin: string
  readonly leverageType?: 'cross' | 'isolated'
}

function runVerification(fixture: VerificationFixture, declareStandardAccount = true) {
  const meta = {
    universe: [
      {
        name: 'BTC',
        szDecimals: 5,
        maxLeverage: 20,
        marginTableId: 20,
      },
    ],
    marginTables: [],
  }
  const clearinghouseState = {
    assetPositions: [
      {
        position: {
          coin: 'BTC',
          szi: '1',
          entryPx: '100',
          positionValue: '100',
          liquidationPx: fixture.serverLiquidationPrice,
          marginUsed: '10',
          leverage: { type: fixture.leverageType ?? 'cross', value: 10 },
        },
      },
    ],
    crossMarginSummary: {
      accountValue: '10',
      totalMarginUsed: fixture.serverInitialMargin,
    },
    crossMaintenanceMarginUsed: fixture.serverMaintenanceMargin,
    marginSummary: { totalMarginUsed: fixture.serverInitialMargin },
  }
  const preload = `
    const meta = ${JSON.stringify(meta)};
    const state = ${JSON.stringify(clearinghouseState)};
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      const payload =
        body.type === 'meta' ? meta :
        body.type === 'metaAndAssetCtxs' ? [meta, [{ markPx: '100' }]] :
        body.type === 'clearinghouseState' ? state :
        (() => { throw new Error('unexpected request: ' + body.type) })();
      return { ok: true, status: 200, json: async () => payload };
    };
  `

  const args = [
    '--import',
    `data:text/javascript,${encodeURIComponent(preload)}`,
    'scripts/oracles/manual-live-verify.mjs',
    '0x0000000000000000000000000000000000000001',
  ]
  if (declareStandardAccount) args.push('--standard-account')

  return spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' })
}

describe('manual live differential CLI', () => {
  it('requires the operator to assert standard account mode', () => {
    const run = runVerification(
      {
        serverLiquidationPrice: null,
        serverMaintenanceMargin: '2.5',
        serverInitialMargin: '10',
      },
      false,
    )

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('--standard-account')
  })

  it('rejects a fixture with no cross positions instead of reporting a vacuous pass', () => {
    const run = runVerification({
      serverLiquidationPrice: null,
      serverMaintenanceMargin: '0',
      serverInitialMargin: '0',
      leverageType: 'isolated',
    })

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('at least one cross position')
  })

  it('exits zero when standard-account cross comparisons match', () => {
    const run = runVerification({
      serverLiquidationPrice: null,
      serverMaintenanceMargin: '2.5',
      serverInitialMargin: '10',
    })

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('margin aggregates: 2 pass / 0 fail')
  })

  it('exits nonzero when server margin aggregates differ', () => {
    const run = runVerification({
      serverLiquidationPrice: null,
      serverMaintenanceMargin: '999',
      serverInitialMargin: '999',
    })

    expect(run.status).toBe(1)
    expect(run.stdout).toContain('margin aggregates: 0 pass / 2 fail')
  })

  it('exits nonzero when a server liquidation price differs beyond tolerance', () => {
    const run = runVerification({
      serverLiquidationPrice: '50',
      serverMaintenanceMargin: '2.5',
      serverInitialMargin: '10',
    })

    expect(run.status).toBe(1)
    expect(run.stdout).toContain('liquidationPx: 0 pass / 1 fail')
  })
})
