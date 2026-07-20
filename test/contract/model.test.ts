import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  CalculationTrace,
  ConstraintCheck,
  JsonObject,
  MathResult,
  ScenarioConstraintCheck,
} from '../../src/model/index.js'

describe('public model', () => {
  it('serializes a complete ok result without runtime instances', () => {
    const trace: CalculationTrace = {
      formulaId: 'hl.test.identity',
      formulaVersion: 1,
      authority: 'local-exact',
      maturity: 'stable',
      completion: { status: 'complete' },
      normalizedInputs: { value: '1' },
      intermediates: [],
      rounding: [],
      assumptions: [],
      sourceRefs: ['HLM.TEST'],
    }
    const result: MathResult<string> = {
      value: { status: 'ok', data: '1' },
      trace,
    }

    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expectTypeOf(trace.normalizedInputs).toMatchTypeOf<JsonObject>()
  })

  it('keeps scenario transition effects out of generic checks', () => {
    expectTypeOf<ConstraintCheck>().not.toMatchTypeOf<ScenarioConstraintCheck>()
  })
})
