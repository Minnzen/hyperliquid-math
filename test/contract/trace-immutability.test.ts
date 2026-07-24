import { describe, expect, it } from 'vitest'
import * as publicApi from '../../src/index.js'
import {
  calculateBookMetrics,
  calculatePerpUnrealizedPnl,
  canonicalizeDecimalString,
} from '../../src/index.js'
import type { CalculationTrace, MathResult } from '../../src/model/index.js'

const publicFacades = Object.entries(publicApi).map(
  ([name, facade]) => [name, facade as unknown as (input: unknown) => MathResult<unknown>] as const,
)

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return

  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) {
    expectDeeplyFrozen(child)
  }
}

function mutableTrace(trace: CalculationTrace) {
  return trace as unknown as {
    sourceRefs: string[]
    assumptions: unknown[]
    normalizedInputs: Record<string, unknown>
  }
}

describe('public trace immutability', () => {
  it.each(publicFacades)('%s returns a deeply frozen trace for invalid input', (_name, facade) => {
    const result = facade(null)
    expectDeeplyFrozen(result.trace)
  })

  it('prevents one caller from contaminating later traces through shared provenance arrays', () => {
    const firstCanonical = canonicalizeDecimalString({ value: '1.0' })
    const firstPosition = calculatePerpUnrealizedPnl({
      position: { kind: 'open', signedSize: '1', entryPrice: '100' },
      markPrice: '110',
    })

    expect(() => mutableTrace(firstCanonical.trace).sourceRefs.push('MUTATED')).toThrow()
    expect(() => mutableTrace(firstPosition.trace).assumptions.push({ kind: 'mutated' })).toThrow()

    const secondCanonical = canonicalizeDecimalString({ value: '2.0' })
    const secondPosition = calculatePerpUnrealizedPnl({
      position: { kind: 'open', signedSize: '2', entryPrice: '100' },
      markPrice: '110',
    })

    expect(secondCanonical.trace.sourceRefs).not.toContain('MUTATED')
    expect(secondPosition.trace.assumptions).not.toContainEqual({ kind: 'mutated' })
  })

  it('deeply freezes complete and incomplete traces without freezing caller-owned input', () => {
    const input: {
      levels: [[{ px: string; sz: string; n: number }], [{ px: string; sz: string; n: number }]]
    } = {
      levels: [[{ px: '100', sz: '2', n: 1 }], [{ px: '101', sz: '3', n: 1 }]],
    }

    const complete = calculateBookMetrics(input)
    const incomplete = calculateBookMetrics(null as never)

    expectDeeplyFrozen(complete.trace)
    expectDeeplyFrozen(incomplete.trace)
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(input.levels)).toBe(false)

    input.levels[0][0].px = '999'
    expect(complete.trace.normalizedInputs.bestBid).toBe('100')
  })
})
