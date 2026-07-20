import { describe, expect, it } from 'vitest'
import { evaluateHip3MarginMode } from '../../../src/hip3/index.js'

describe('HIP-3 margin mode directed mutation-kill vectors', () => {
  it('kills a normal cross eligibility-as-satisfied mutant', () => {
    const result = evaluateHip3MarginMode({ assetMarginMode: 'normal', requestedMode: 'cross' })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.checks).toContainEqual({
      status: 'not-evaluated',
      ruleId: 'hl.hip3.cross-margin-server-eligibility',
      reason: { code: 'server-authoritative', path: '/requestedMode' },
    })
  })

  it('kills a strictIsolated margin-removal allowed mutant', () => {
    const result = evaluateHip3MarginMode({
      assetMarginMode: 'strictIsolated',
      requestedMode: 'isolated',
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.marginRemoval).toBe('strict')
  })
})
