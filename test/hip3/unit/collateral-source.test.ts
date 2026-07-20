import { describe, expect, it } from 'vitest'
import { resolveHip3CollateralSource } from '../../../src/hip3/index.js'

const baseInput = {
  accountAbstractionMode: 'standard',
  dex: 'dex:builder-alpha',
  collateralTokenIndex: 7,
  validatorPerpUsdcTokenIndex: 0,
} as const

describe('resolveHip3CollateralSource', () => {
  it('routes standard accounts to the per-DEX collateral balance', () => {
    const result = resolveHip3CollateralSource(baseInput)

    expect(result).toMatchObject({
      value: {
        status: 'ok',
        data: {
          route: {
            kind: 'per-dex-balance',
            dex: 'dex:builder-alpha',
            collateralTokenIndex: 7,
          },
          checks: [{ status: 'satisfied', ruleId: 'hl.hip3.collateral-source.mode-supported' }],
        },
      },
      trace: {
        formulaId: 'hl.hip3.collateral-source.resolve',
        formulaVersion: 1,
        authority: 'local-exact',
        maturity: 'experimental',
        completion: { status: 'complete' },
        normalizedInputs: baseInput,
        sourceRefs: expect.arrayContaining(['HLM.SPEC.HIP3.COLLATERAL_SOURCE.V1']),
      },
    })
  })

  it('routes unified accounts by token index without a DEX balance', () => {
    const result = resolveHip3CollateralSource({
      ...baseInput,
      accountAbstractionMode: 'unified',
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        route: { kind: 'unified-spot-balance', collateralTokenIndex: 7 },
      },
    })
    expect(result.value.status === 'ok' ? result.value.data.route : null).not.toHaveProperty('dex')
  })

  it('routes portfolio accounts to portfolio margin without local LTV evaluation', () => {
    const result = resolveHip3CollateralSource({
      ...baseInput,
      accountAbstractionMode: 'portfolio',
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        route: { kind: 'portfolio-margin', collateralTokenIndex: 7 },
        checks: expect.arrayContaining([
          {
            status: 'not-evaluated',
            ruleId: 'hl.hip3.portfolio-margin-eligibility',
            reason: {
              code: 'server-authoritative',
              path: '/accountAbstractionMode',
            },
          },
        ]),
      },
    })
  })

  it('routes deprecated DEX abstraction USDC by token index equality instead of display symbol', () => {
    const result = resolveHip3CollateralSource({
      accountAbstractionMode: 'dex-abstraction-deprecated',
      dex: 'dex:builder-alpha',
      collateralTokenIndex: 0,
      validatorPerpUsdcTokenIndex: 0,
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: { route: { kind: 'validator-perp-usdc-balance' } },
    })
  })

  it('routes deprecated DEX abstraction non-USDC collateral to spot by token index', () => {
    const result = resolveHip3CollateralSource({
      accountAbstractionMode: 'dex-abstraction-deprecated',
      dex: 'dex:builder-alpha',
      collateralTokenIndex: 7,
      validatorPerpUsdcTokenIndex: 0,
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: { route: { kind: 'spot-balance', collateralTokenIndex: 7 } },
    })
  })

  it('does not infer USDC from a symbol-looking dex name', () => {
    const result = resolveHip3CollateralSource({
      accountAbstractionMode: 'dex-abstraction-deprecated',
      dex: 'USDC',
      collateralTokenIndex: 7,
      validatorPerpUsdcTokenIndex: 0,
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: { route: { kind: 'spot-balance', collateralTokenIndex: 7 } },
    })
  })

  it('rejects an empty dex name', () => {
    const result = resolveHip3CollateralSource({ ...baseInput, dex: '' })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid-dex', path: '/dex' })]),
    )
    expect(result.trace.completion.status).toBe('incomplete')
    expect(result.trace.assumptions).toEqual([])
  })

  it.each([
    ['non-NFC Unicode', 'e\u0301'],
    ['C0 control characters', 'bad\nnamespace'],
    ['C1 control characters', 'bad\u007Fnamespace'],
    ['an unpaired high surrogate', '\uD800'],
    ['an invalid high-surrogate pair', '\uD800x'],
    ['an unpaired low surrogate', '\uDC00'],
  ])('rejects %s in a dex name', (_case, dex) => {
    const result = resolveHip3CollateralSource({ ...baseInput, dex })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [expect.objectContaining({ code: 'invalid-dex', path: '/dex' })],
    })
    expect(result.trace).toMatchObject({
      completion: {
        status: 'incomplete',
        reason: { code: 'invalid-dex', path: '/dex' },
      },
      assumptions: [],
    })
  })

  it('accepts a well-formed NFC surrogate pair in a dex name', () => {
    const result = resolveHip3CollateralSource({ ...baseInput, dex: 'dex:😀' })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: { route: { kind: 'per-dex-balance', dex: 'dex:😀' } },
    })
  })

  it('rejects negative token indexes', () => {
    const result = resolveHip3CollateralSource({ ...baseInput, collateralTokenIndex: -1 })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-token-index', path: '/collateralTokenIndex' }),
      ]),
    )
  })

  it('rejects unsafe validator USDC token indexes', () => {
    const result = resolveHip3CollateralSource({
      ...baseInput,
      validatorPerpUsdcTokenIndex: Number.MAX_SAFE_INTEGER + 1,
    })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-token-index',
          path: '/validatorPerpUsdcTokenIndex',
        }),
      ]),
    )
  })

  it('rejects extra keys on the exact plain-data input object', () => {
    const result = resolveHip3CollateralSource({
      ...baseInput,
      collateralSymbol: 'USDC',
    } as never)

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid-input-shape', path: '' })]),
    )
  })

  it('rejects accessor properties without invoking them', () => {
    let reads = 0
    const input = Object.defineProperties(
      {},
      {
        accountAbstractionMode: { enumerable: true, value: 'standard' },
        dex: {
          enumerable: true,
          get() {
            reads += 1
            return 'dex:builder-alpha'
          },
        },
        collateralTokenIndex: { enumerable: true, value: 7 },
        validatorPerpUsdcTokenIndex: { enumerable: true, value: 0 },
      },
    )

    const result = resolveHip3CollateralSource(input as never)

    expect(result.value.status).toBe('invalid-input')
    expect(reads).toBe(0)
  })

  it('states caller-supplied mode, DEX, and token snapshot assumptions', () => {
    const result = resolveHip3CollateralSource(baseInput)

    expect(result.trace.assumptions).toEqual(
      expect.arrayContaining([
        { kind: 'frozen-input', path: '/accountAbstractionMode', value: 'caller-provided-mode' },
        { kind: 'frozen-input', path: '/dex', value: 'caller-provided-dated-dex-snapshot' },
        {
          kind: 'frozen-input',
          path: '/collateralTokenIndex',
          value: 'caller-provided-dated-token-index',
        },
      ]),
    )
  })
})
