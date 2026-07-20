import { Decimal } from 'decimal.js'
import { expect } from 'vitest'

export type SpotApiName =
  | 'convertSpotTokenUnits'
  | 'calculateSpotOrderDeltas'
  | 'projectSpotPositionEvent'
  | 'calculateSpotPortfolioValue'
  | 'evaluateSpotDustEligibility'
  | 'projectSpotDustAllocation'

export type SpotFacade = (input: unknown) => {
  value: {
    status: 'ok' | 'invalid-input' | 'not-applicable' | 'indeterminate'
    data?: unknown
    issues?: ReadonlyArray<{ code: string; path: string }>
    reason?: { code: string; path?: string }
  }
  trace: {
    formulaId: string
    formulaVersion: number
    authority: string
    maturity: string
    completion: { status: string; reason?: { code: string; path?: string } }
    normalizedInputs: Record<string, unknown>
    intermediates: readonly unknown[]
    rounding: readonly unknown[]
    assumptions: readonly unknown[]
    sourceRefs: readonly string[]
  }
}

export async function spotFunction(name: SpotApiName): Promise<SpotFacade> {
  const module = (await import('../../src/index.js')) as Record<string, unknown>
  const candidate = module[name]
  expect(candidate, `${name} must be exported from the package root`).toEqual(expect.any(Function))
  if (typeof candidate !== 'function') {
    throw new Error(`${name} is not exported`)
  }
  return candidate as SpotFacade
}

export function expectOk<T>(
  result: ReturnType<SpotFacade>,
): asserts result is ReturnType<SpotFacade> & {
  value: { status: 'ok'; data: T }
} {
  expect(result.value.status).toBe('ok')
}

export function expectInvalid(
  result: ReturnType<SpotFacade>,
  expected: { code: string; path: string },
) {
  expect(result.value).toMatchObject({
    status: 'invalid-input',
    issues: [expect.objectContaining(expected)],
  })
  expect(result.trace).toMatchObject({
    completion: { status: 'incomplete' },
    assumptions: [],
  })
}

export function expectStableTrace(
  result: ReturnType<SpotFacade>,
  expected: { formulaId: string; sourceId: string },
) {
  expect(result.trace).toMatchObject({
    formulaId: expected.formulaId,
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'stable',
    completion: { status: 'complete' },
  })
  expect(result.trace.sourceRefs).toEqual(expect.arrayContaining([expected.sourceId]))
}

export function expectNoRounding(result: ReturnType<SpotFacade>) {
  expect(result.trace.rounding).toEqual([])
}

export function decimalFromUnits(units: bigint, scale: bigint) {
  return new Decimal(units.toString()).div(scale.toString()).toFixed()
}
