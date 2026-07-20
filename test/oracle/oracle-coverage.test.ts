import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

type OracleCoverage = 'full' | 'partial' | 'not-supported'

interface OracleEntry {
  coverage: OracleCoverage
  slice?: string
  reason?: string
}

interface CoverageFixture {
  schemaVersion: 1
  scope: string
  pinnedImplementations: {
    officialPythonSdk: { version: string; commit: string }
    liveFixtures: { mainnet: string; testnet?: string }
  }
  functions: Array<{
    exportName: string
    formulaId: string
    oracles: Record<'official-python-sdk' | 'live-fixtures', OracleEntry>
  }>
}

interface PublicFunctionsManifest {
  functions: Array<{
    exportName: string
    formulaId: string
    oracles: Record<'official-python-sdk' | 'live-fixtures', OracleCoverage>
  }>
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

describe('oracle coverage contract', () => {
  it('pins all offline oracle implementations and live fixture sources', async () => {
    const coverages = await Promise.all([
      readJson<CoverageFixture>('fixtures/oracles/m1-oracle-coverage.json'),
      readJson<CoverageFixture>('fixtures/oracles/m2-oracle-coverage.json'),
      readJson<CoverageFixture>('fixtures/oracles/m3-oracle-coverage.json'),
      readJson<CoverageFixture>('fixtures/oracles/m4-oracle-coverage.json'),
      readJson<CoverageFixture>('fixtures/oracles/m5-oracle-coverage.json'),
    ])

    for (const coverage of coverages) {
      expect(coverage.schemaVersion).toBe(1)
      expect(coverage.pinnedImplementations.officialPythonSdk).toMatchObject({
        version: '0.24.0',
        commit: '2fdb18f9517675ea03695a0962bd19eece9c83f0',
      })
    }

    expect(coverages.map((coverage) => coverage.pinnedImplementations.liveFixtures)).toEqual([
      {
        mainnet: 'fixtures/live/2026-07-19-mainnet-m1.json',
        testnet: 'fixtures/live/2026-07-19-testnet-m1.json',
        usage: 'offline replay of captured protocol metadata and L2 book responses',
      },
      {
        mainnet: 'fixtures/live/2026-07-19-mainnet-m2.json',
        testnet: 'fixtures/live/2026-07-19-testnet-m2.json',
        usage: 'offline replay of captured public positions, fills, funding, and fee schedules',
      },
      {
        mainnet: 'fixtures/live/2026-07-19-mainnet-m3.json',
        testnet: 'fixtures/live/2026-07-19-testnet-m3.json',
        usage:
          'offline replay of public meta, margin tiers, asset contexts, clearinghouse margin summaries, selected server liquidationPx observations, and official isolated-position schema mapping',
      },
      {
        mainnet: 'fixtures/live/2026-07-19-mainnet-m4.json',
        usage:
          'offline schema and completeness replay for bounded fills, order status, open orders, and the historicalOrders cap',
      },
      {
        mainnet: 'fixtures/live/2026-07-19-mainnet-m5.json',
        testnet: 'fixtures/live/2026-07-19-testnet-m5.json',
        usage:
          'offline schema and dated observation replay for spot metadata, spot asset contexts, allMids, HIP-3 DEX metadata, HIP-3 asset contexts, and empty public spotClearinghouseState',
      },
    ])
    expect(
      coverages.find((coverage) => coverage.scope === 'M4')?.pinnedImplementations.liveFixtures,
    ).not.toHaveProperty('testnet')
  })

  it('matches public function oracle statuses without implicit support', async () => {
    const [m1Coverage, m2Coverage, m3Coverage, m4Coverage, m5Coverage, manifest] =
      await Promise.all([
        readJson<CoverageFixture>('fixtures/oracles/m1-oracle-coverage.json'),
        readJson<CoverageFixture>('fixtures/oracles/m2-oracle-coverage.json'),
        readJson<CoverageFixture>('fixtures/oracles/m3-oracle-coverage.json'),
        readJson<CoverageFixture>('fixtures/oracles/m4-oracle-coverage.json'),
        readJson<CoverageFixture>('fixtures/oracles/m5-oracle-coverage.json'),
        readJson<PublicFunctionsManifest>('spec/public-functions.json'),
      ])
    const coverageByName = new Map(
      [
        ...m1Coverage.functions,
        ...m2Coverage.functions,
        ...m3Coverage.functions,
        ...m4Coverage.functions,
        ...m5Coverage.functions,
      ].map((entry) => [entry.exportName, entry]),
    )

    expect([...coverageByName.keys()].sort()).toEqual(
      manifest.functions.map((entry) => entry.exportName).sort(),
    )

    for (const publicFunction of manifest.functions) {
      const coverageEntry = coverageByName.get(publicFunction.exportName)
      expect(coverageEntry?.formulaId).toBe(publicFunction.formulaId)
      for (const oracleName of ['official-python-sdk', 'live-fixtures'] as const) {
        const oracle = coverageEntry?.oracles[oracleName]
        expect(oracle?.coverage).toBe(publicFunction.oracles[oracleName])
        if (oracle?.coverage === 'partial') {
          expect(oracle.slice, `${publicFunction.exportName}:${oracleName}`).toBeTypeOf('string')
          expect(oracle.slice?.length).toBeGreaterThan(0)
          expect(oracle.slice, `${publicFunction.exportName}:${oracleName}`).not.toMatch(
            /schema only|when available|no independent (?:helper|implementation|validator|oracle)/i,
          )
        }
        if (oracle?.coverage === 'not-supported') {
          expect(oracle.reason, `${publicFunction.exportName}:${oracleName}`).toBeTypeOf('string')
          expect(oracle.reason?.length).toBeGreaterThan(0)
        }
      }
    }
  })
})
