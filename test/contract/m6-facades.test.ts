import { describe, expect, it } from 'vitest'
import {
  calculateOutcomeDualPrice,
  calculateOutcomeSettlement,
  calculateUnifiedAccountRatio,
  evaluateRecurringOutcome,
} from '../../src/index.js'

const facades = [
  calculateOutcomeDualPrice,
  calculateOutcomeSettlement,
  evaluateRecurringOutcome,
  calculateUnifiedAccountRatio,
] as const

describe('M6 public facade safety', () => {
  it.each(facades)('never throws for a revoked root proxy', (facade) => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()

    expect(() => (facade as (input: never) => unknown)(proxy as never)).not.toThrow()
    expect(
      (facade as (input: never) => { value: { status: string } })(proxy as never).value.status,
    ).toBe('invalid-input')
  })

  it.each(facades)('keeps invalid traces incomplete and assumption-free', (facade) => {
    const result = (
      facade as (input: never) => {
        value: { status: string }
        trace: { completion: { status: string }; assumptions: readonly unknown[] }
      }
    )(null as never)

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion.status).toBe('incomplete')
    expect(result.trace.assumptions).toEqual([])
  })
})
