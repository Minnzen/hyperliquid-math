import { describe, expect, it } from 'vitest'
import { evaluateHip3MarginMode } from '../../../src/hip3/index.js'

describe('evaluateHip3MarginMode', () => {
  it('supports normal cross locally and records server eligibility as not evaluated', () => {
    const result = evaluateHip3MarginMode({ assetMarginMode: 'normal', requestedMode: 'cross' })

    expect(result).toMatchObject({
      value: {
        status: 'ok',
        data: {
          supportedLocally: true,
          effectiveMarginMode: 'cross',
          marginRemoval: 'not-applicable',
          checks: [
            { status: 'satisfied', ruleId: 'hl.hip3.margin-mode.local-support' },
            {
              status: 'not-evaluated',
              ruleId: 'hl.hip3.cross-margin-server-eligibility',
              reason: { code: 'server-authoritative', path: '/requestedMode' },
            },
          ],
        },
      },
      trace: {
        formulaId: 'hl.hip3.margin-mode.evaluate',
        formulaVersion: 1,
        authority: 'local-exact',
        maturity: 'experimental',
        completion: { status: 'complete' },
        normalizedInputs: { assetMarginMode: 'normal', requestedMode: 'cross' },
        sourceRefs: expect.arrayContaining(['HLM.SPEC.HIP3.MARGIN_MODE.V1']),
      },
    })
  })

  it('supports normal isolated with removable isolated margin', () => {
    const result = evaluateHip3MarginMode({ assetMarginMode: 'normal', requestedMode: 'isolated' })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        supportedLocally: true,
        effectiveMarginMode: 'isolated',
        marginRemoval: 'allowed',
        checks: [{ status: 'satisfied', ruleId: 'hl.hip3.margin-mode.local-support' }],
      },
    })
    expect(result.value.status === 'ok' ? result.value.data.checks : []).not.toContainEqual(
      expect.objectContaining({ ruleId: 'hl.hip3.cross-margin-server-eligibility' }),
    )
  })

  it('violates noCross cross requests', () => {
    const result = evaluateHip3MarginMode({ assetMarginMode: 'noCross', requestedMode: 'cross' })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        supportedLocally: false,
        effectiveMarginMode: null,
        marginRemoval: 'not-applicable',
        checks: [
          {
            status: 'violated',
            ruleId: 'hl.hip3.margin-mode.local-support',
            violation: {
              ruleId: 'hl.hip3.margin-mode.local-support',
              code: 'cross-margin-not-supported',
              path: '/requestedMode',
            },
          },
        ],
      },
    })
  })

  it('supports noCross isolated with removable isolated margin', () => {
    const result = evaluateHip3MarginMode({ assetMarginMode: 'noCross', requestedMode: 'isolated' })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        supportedLocally: true,
        effectiveMarginMode: 'isolated',
        marginRemoval: 'allowed',
      },
    })
  })

  it('violates strictIsolated cross requests', () => {
    const result = evaluateHip3MarginMode({
      assetMarginMode: 'strictIsolated',
      requestedMode: 'cross',
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        supportedLocally: false,
        effectiveMarginMode: null,
        marginRemoval: 'not-applicable',
        checks: [
          {
            status: 'violated',
            violation: {
              ruleId: 'hl.hip3.margin-mode.local-support',
              code: 'cross-margin-not-supported',
              path: '/requestedMode',
            },
          },
        ],
      },
    })
  })

  it('supports strictIsolated isolated with strict margin removal', () => {
    const result = evaluateHip3MarginMode({
      assetMarginMode: 'strictIsolated',
      requestedMode: 'isolated',
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        supportedLocally: true,
        effectiveMarginMode: 'isolated',
        marginRemoval: 'strict',
      },
    })
  })

  it.each([
    ['normal', 'cross', true, 'cross', 'not-applicable'],
    ['normal', 'isolated', true, 'isolated', 'allowed'],
    ['noCross', 'cross', false, null, 'not-applicable'],
    ['noCross', 'isolated', true, 'isolated', 'allowed'],
    ['strictIsolated', 'cross', false, null, 'not-applicable'],
    ['strictIsolated', 'isolated', true, 'isolated', 'strict'],
  ] as const)(
    'maps %s assets with %s requests to the complete local matrix',
    (assetMarginMode, requestedMode, supportedLocally, effectiveMarginMode, marginRemoval) => {
      const result = evaluateHip3MarginMode({ assetMarginMode, requestedMode })

      expect(result.value).toMatchObject({
        status: 'ok',
        data: { supportedLocally, effectiveMarginMode, marginRemoval },
      })
    },
  )

  it('rejects unknown asset margin modes', () => {
    const result = evaluateHip3MarginMode({
      assetMarginMode: 'crossOnly',
      requestedMode: 'cross',
    } as never)

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-enum-value', path: '/assetMarginMode' }),
      ]),
    )
  })

  it('rejects extra keys on the exact plain-data input object', () => {
    const result = evaluateHip3MarginMode({
      assetMarginMode: 'normal',
      requestedMode: 'cross',
      serverEligible: true,
    } as never)

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid-input-shape', path: '' })]),
    )
  })

  it('keeps invalid traces incomplete and assumption-free', () => {
    const result = evaluateHip3MarginMode(null as never)

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion.status).toBe('incomplete')
    expect(result.trace.assumptions).toEqual([])
  })

  it('states that setMarginModes, leverage updates, and transfers are not submitted', () => {
    const result = evaluateHip3MarginMode({ assetMarginMode: 'normal', requestedMode: 'cross' })

    expect(result.trace.assumptions).toEqual(
      expect.arrayContaining([
        {
          kind: 'frozen-input',
          path: '/assetMarginMode',
          value: 'caller-provided-dex-margin-mode',
        },
        { kind: 'frozen-input', path: '/requestedMode', value: 'caller-requested-margin-mode' },
      ]),
    )
    expect(result.trace.intermediates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'hip3-margin-actions-not-submitted',
          output: 'local-capability-check-only',
        }),
      ]),
    )
  })
})
