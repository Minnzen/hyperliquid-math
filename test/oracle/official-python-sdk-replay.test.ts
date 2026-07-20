import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

interface OfficialPythonFixture {
  source: {
    version: string
    commit: string
  }
  generation: {
    implementationCopied: boolean
  }
  preparedOrderCases: Array<{
    name: string
    asset: {
      kind: 'perp' | 'spot' | 'hip3-perp'
      index: number
      dexIndex?: number
      assetId: number
    }
    wire: {
      px: string
      sz: string
    }
    sdkOrderWire: {
      a: number
      p: string
      s: string
    }
    sdkOrderAction: {
      type: 'order'
      orders: Array<{
        a: number
        p: string
        s: string
      }>
      grouping: 'na'
    }
    coverage: {
      assetId: 'full' | 'partial'
      price: 'partial'
      size: 'partial'
    }
  }>
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function readPublicExports(): Promise<Record<string, unknown>> {
  return import('../../src/index.js') as Promise<Record<string, unknown>>
}

function okData(result: unknown): unknown {
  if (
    typeof result === 'object' &&
    result !== null &&
    'value' in result &&
    typeof result.value === 'object' &&
    result.value !== null &&
    'status' in result.value &&
    result.value.status === 'ok' &&
    'data' in result.value
  ) {
    return result.value.data
  }
  return undefined
}

describe('official Python SDK 0.24.0 golden replay', () => {
  it.skipIf(!process.env.HYPERLIQUID_PYTHON_SDK_PATH)(
    'reproduces fixture bytes from the pinned official SDK checkout',
    async () => {
      const python = process.env.HYPERLIQUID_PYTHON ?? 'python3'
      const sdkPath = process.env.HYPERLIQUID_PYTHON_SDK_PATH as string
      const { stdout } = await execFileAsync(python, [
        'scripts/oracles/generate-official-python-sdk-m1.py',
        '--sdk-path',
        sdkPath,
        '--check',
      ])

      expect(stdout).toContain('official-python-sdk-0.24.0-2fdb18f-m1.json')
    },
    20_000,
  )

  it('records source pinning without vendoring SDK implementation', async () => {
    const fixture = await readJson<OfficialPythonFixture>(
      'fixtures/oracles/official-python-sdk-0.24.0-2fdb18f-m1.json',
    )

    expect(fixture.source).toMatchObject({
      version: '0.24.0',
      commit: '2fdb18f9517675ea03695a0962bd19eece9c83f0',
    })
    expect(fixture.generation.implementationCopied).toBe(false)
  })

  it('marks every prepared wire replay as partial precision coverage', async () => {
    const fixture = await readJson<OfficialPythonFixture>(
      'fixtures/oracles/official-python-sdk-0.24.0-2fdb18f-m1.json',
    )

    for (const testCase of fixture.preparedOrderCases) {
      expect(testCase.coverage.price, testCase.name).toBe('partial')
      expect(testCase.coverage.size, testCase.name).toBe('partial')
      expect(testCase.wire.px, testCase.name).toMatch(/^[0-9]+(?:\.[0-9]+)?$/)
      expect(testCase.wire.sz, testCase.name).toMatch(/^[0-9]+(?:\.[0-9]+)?$/)
      expect(testCase.sdkOrderWire.a, testCase.name).toBe(testCase.asset.assetId)
      expect(testCase.sdkOrderWire.p, testCase.name).toBe(testCase.wire.px)
      expect(testCase.sdkOrderWire.s, testCase.name).toBe(testCase.wire.sz)
      expect(testCase.sdkOrderAction, testCase.name).toMatchObject({
        type: 'order',
        orders: [testCase.sdkOrderWire],
        grouping: 'na',
      })
    }
  })

  it('matches public encodeAssetId against golden SDK asset IDs', async () => {
    const [fixture, publicExports] = await Promise.all([
      readJson<OfficialPythonFixture>(
        'fixtures/oracles/official-python-sdk-0.24.0-2fdb18f-m1.json',
      ),
      readPublicExports(),
    ])

    expect(publicExports.encodeAssetId, 'export encodeAssetId from . and ./identifiers').toBeTypeOf(
      'function',
    )
    expect(publicExports.decodeAssetId, 'export decodeAssetId from . and ./identifiers').toBeTypeOf(
      'function',
    )
    for (const testCase of fixture.preparedOrderCases) {
      const input =
        testCase.asset.kind === 'hip3-perp'
          ? {
              kind: 'hip3-perp',
              dexIndex: testCase.asset.dexIndex,
              index: testCase.asset.index,
            }
          : { kind: testCase.asset.kind, index: testCase.asset.index }
      const result = (publicExports.encodeAssetId as (input: unknown) => unknown)(input)

      expect(okData(result), testCase.name).toBe(testCase.asset.assetId)
      const decoded = (publicExports.decodeAssetId as (input: unknown) => unknown)({
        assetId: testCase.asset.assetId,
      })
      expect(okData(decoded), `${testCase.name}:decode`).toEqual(
        testCase.asset.kind === 'hip3-perp'
          ? {
              kind: 'hip3-perp',
              dexIndex: testCase.asset.dexIndex,
              index: testCase.asset.index,
            }
          : { kind: testCase.asset.kind, index: testCase.asset.index },
      )
    }
  })
})
