import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  calculateHip3FeeRates,
  calculatePerpInitialMargin,
  calculatePerpLiquidationPrice,
  canonicalizeDecimalString,
  projectPerpFill,
  projectSpotPositionEvent,
  quantizePrice,
  simulateBookFill,
} from '../../src/index.js'

interface PublicFunctionManifest {
  functions: Array<{ exportName: string; formulaId: string; specPath: string }>
}

interface ExecutableExample {
  function: string
  input: unknown
  expectedValue: unknown
}

describe('formula manual', () => {
  it('indexes and exemplifies every public runtime function', async () => {
    const manifest = JSON.parse(
      await readFile('spec/public-functions.json', 'utf8'),
    ) as PublicFunctionManifest
    const [index, examples] = await Promise.all([
      readFile('spec/README.md', 'utf8'),
      readFile('spec/WORKED-EXAMPLES.md', 'utf8'),
    ])

    expect(manifest.functions).toHaveLength(45)
    for (const entry of manifest.functions) {
      expect(index, entry.exportName).toContain(`\`${entry.exportName}\``)
      expect(index, entry.formulaId).toContain(`\`${entry.formulaId}\``)
      expect(index, entry.specPath).toContain(entry.specPath.replace('spec/', ''))
      expect(examples, entry.exportName).toContain(`\`${entry.exportName}\``)
    }
  })

  it('keeps the numerical and Kit-boundary chapters present', async () => {
    const [numerics, kitMapping] = await Promise.all([
      readFile('spec/NUMERICS.md', 'utf8'),
      readFile('spec/KIT-MAPPING.md', 'utf8'),
    ])

    expect(numerics).toContain('40 significant digits')
    expect(numerics).toContain('ROUND_HALF_EVEN')
    expect(numerics).toContain('integer-price exemption')
    expect(kitMapping).toContain('Math has no network')
    expect(kitMapping).toContain('An `ok` Math result is not an execution authorization')
  })

  it('executes representative worked examples across the public domains', async () => {
    const vectors = JSON.parse(
      await readFile('spec/WORKED-EXAMPLES.json', 'utf8'),
    ) as ExecutableExample[]
    const runners: Record<string, (input: never) => unknown> = {
      canonicalizeDecimalString,
      quantizePrice,
      simulateBookFill,
      projectPerpFill,
      calculatePerpInitialMargin,
      calculatePerpLiquidationPrice,
      projectSpotPositionEvent,
      calculateHip3FeeRates,
    }

    expect(vectors.map((vector) => vector.function)).toEqual(Object.keys(runners))
    for (const vector of vectors) {
      const runner = runners[vector.function]
      expect(runner, vector.function).toBeTypeOf('function')
      if (runner === undefined) continue
      const result = runner(vector.input as never)
      expect(result, vector.function).toMatchObject({ value: vector.expectedValue })
    }
  })
})
