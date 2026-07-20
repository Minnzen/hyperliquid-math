import { describe, expect, it } from 'vitest'
import {
  evaluateHip1AnchorGenesisEligibility,
  validateHip1Deployment,
} from '../../../src/hip1/index.js'

const validDeploymentInput = {
  name: 'HYPE',
  weiDecimals: 8,
  szDecimals: 3,
  maxSupplyWei: '1000000000000',
  userGenesisWei: '600000000000',
  anchorGenesisWei: '400000000000',
} as const

function expectInvalidInput(result: ReturnType<typeof validateHip1Deployment>, path: string) {
  expect(result.value.status).toBe('invalid-input')
  if (result.value.status !== 'invalid-input') return
  expect(result.value.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path })]))
}

describe('validateHip1Deployment', () => {
  it('returns satisfied objective checks and lot-size derivation for a valid deployment', () => {
    const result = validateHip1Deployment(validDeploymentInput)

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        lotSizeWei: '100000',
        totalGenesisWei: '1000000000000',
        checks: expect.arrayContaining([
          { status: 'satisfied', ruleId: 'hl.hip1.deployment.name-code-points' },
          { status: 'satisfied', ruleId: 'hl.hip1.deployment.decimal-range' },
          { status: 'satisfied', ruleId: 'hl.hip1.deployment.sz-decimals-within-wei' },
          { status: 'satisfied', ruleId: 'hl.hip1.deployment.positive-max-supply' },
          { status: 'satisfied', ruleId: 'hl.hip1.deployment.genesis-max-supply-checksum' },
        ]),
      },
    })
    expect(result.trace).toMatchObject({
      formulaId: 'hl.hip1.deployment.validate',
      formulaVersion: 1,
      authority: 'local-exact',
      maturity: 'experimental',
      completion: { status: 'complete' },
      normalizedInputs: validDeploymentInput,
      sourceRefs: expect.arrayContaining([
        'HL.DOC.HIP1.2026-07-19',
        'HL.DOC.HIP1_DEPLOY.2026-07-19',
      ]),
    })
    expect(result.trace.intermediates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'hip1.name.code-point-count',
          output: 4,
        }),
        expect.objectContaining({
          stepId: 'hip1.deployment.lot-size',
          output: '100000',
        }),
        expect.objectContaining({
          stepId: 'hip1.deployment.genesis-checksum',
          output: { totalGenesisWei: '1000000000000', maxSupplyWei: '1000000000000' },
        }),
      ]),
    )
    expect(result.trace.assumptions).toEqual(
      expect.arrayContaining([
        {
          kind: 'frozen-input',
          path: '',
          value: validDeploymentInput,
        },
        {
          kind: 'frozen-input',
          path: '/nameCharacterCounting',
          value: 'ECMAScript Unicode code points; no trim, normalization, or case folding',
        },
      ]),
    )
  })

  it('returns ok with violated checks for objective deployment failures', () => {
    const result = validateHip1Deployment({
      ...validDeploymentInput,
      name: 'TOOLONG',
      weiDecimals: 7,
      szDecimals: 3,
      maxSupplyWei: '1000000000000',
      userGenesisWei: '600000000000',
      anchorGenesisWei: '399999999999',
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.lotSizeWei).toBe('10000')
    expect(result.value.data.totalGenesisWei).toBe('999999999999')
    expect(result.value.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'violated',
          violation: expect.objectContaining({
            ruleId: 'hl.hip1.deployment.name-code-points',
            actual: '7',
            limit: '6',
          }),
        }),
        expect.objectContaining({
          status: 'violated',
          violation: expect.objectContaining({
            ruleId: 'hl.hip1.deployment.sz-decimals-within-wei',
            actual: '8',
            limit: '7',
          }),
        }),
        expect.objectContaining({
          status: 'violated',
          violation: expect.objectContaining({
            ruleId: 'hl.hip1.deployment.genesis-max-supply-checksum',
            actual: '999999999999',
            limit: '1000000000000',
          }),
        }),
      ]),
    )
  })

  it('derives sub-wei lot size for valid-shape decimal metadata that violates deployment rules', () => {
    const result = validateHip1Deployment({
      ...validDeploymentInput,
      weiDecimals: 3,
      szDecimals: 4,
      maxSupplyWei: '1',
      userGenesisWei: '1',
      anchorGenesisWei: '0',
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.lotSizeWei).toBe('0.1')
    expect(result.value.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'violated',
          violation: expect.objectContaining({
            ruleId: 'hl.hip1.deployment.sz-decimals-within-wei',
            actual: '9',
            limit: '3',
          }),
        }),
      ]),
    )
  })

  it('derives unit lot size when wei and size decimals are equal', () => {
    const result = validateHip1Deployment({
      ...validDeploymentInput,
      weiDecimals: 5,
      szDecimals: 5,
      maxSupplyWei: '1',
      userGenesisWei: '1',
      anchorGenesisWei: '0',
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.lotSizeWei).toBe('1')
    expect(result.value.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'violated',
          violation: expect.objectContaining({
            ruleId: 'hl.hip1.deployment.sz-decimals-within-wei',
            actual: '10',
            limit: '5',
          }),
        }),
      ]),
    )
  })

  it('rejects genesis arithmetic overflow after canonical integer inputs pass field guards', () => {
    const result = validateHip1Deployment({
      ...validDeploymentInput,
      maxSupplyWei: '1',
      userGenesisWei: '9'.repeat(40),
      anchorGenesisWei: '1',
    })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [expect.objectContaining({ code: 'integer-overflow', path: '/genesisWei' })],
    })
    expect(result.trace).toMatchObject({
      formulaId: 'hl.hip1.deployment.validate',
      completion: {
        status: 'incomplete',
        reason: { code: 'integer-overflow', path: '/genesisWei' },
      },
    })
  })

  it('treats zero max supply as an objective violation when the plain input is otherwise valid', () => {
    const result = validateHip1Deployment({
      ...validDeploymentInput,
      maxSupplyWei: '0',
      userGenesisWei: '0',
      anchorGenesisWei: '0',
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'violated',
          violation: expect.objectContaining({
            ruleId: 'hl.hip1.deployment.positive-max-supply',
            actual: '0',
          }),
        }),
      ]),
    )
  })

  it('uses only user and anchor genesis totals for the Genesis.maxSupply checksum', () => {
    const result = validateHip1Deployment({
      ...validDeploymentInput,
      maxSupplyWei: '101',
      userGenesisWei: '40',
      anchorGenesisWei: '60',
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.totalGenesisWei).toBe('100')
    expect(result.value.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'violated',
          violation: expect.objectContaining({
            ruleId: 'hl.hip1.deployment.genesis-max-supply-checksum',
            actual: '100',
            limit: '101',
          }),
        }),
      ]),
    )
  })

  it('rejects a hyperliquidity field instead of including it in deployment checksum math', () => {
    const result = validateHip1Deployment({
      ...validDeploymentInput,
      hyperliquidityWei: '1',
    } as never)

    expectInvalidInput(result, '')
  })

  it.each([
    ['missing field', { ...validDeploymentInput, name: undefined }, '/name'],
    [
      'unsafe weiDecimals',
      { ...validDeploymentInput, weiDecimals: Number.MAX_SAFE_INTEGER + 1 },
      '/weiDecimals',
    ],
    ['negative szDecimals', { ...validDeploymentInput, szDecimals: -1 }, '/szDecimals'],
    ['decimal weiDecimals', { ...validDeploymentInput, weiDecimals: 1.5 }, '/weiDecimals'],
    ['negative integer string', { ...validDeploymentInput, maxSupplyWei: '-1' }, '/maxSupplyWei'],
    [
      'fractional integer string',
      { ...validDeploymentInput, userGenesisWei: '1.0' },
      '/userGenesisWei',
    ],
    [
      'exponent integer string',
      { ...validDeploymentInput, anchorGenesisWei: '1e6' },
      '/anchorGenesisWei',
    ],
    [
      'leading plus integer string',
      { ...validDeploymentInput, maxSupplyWei: '+1' },
      '/maxSupplyWei',
    ],
    ['whitespace integer string', { ...validDeploymentInput, maxSupplyWei: ' 1' }, '/maxSupplyWei'],
    [
      'overflowing max supply',
      { ...validDeploymentInput, maxSupplyWei: `1${'0'.repeat(41)}` },
      '/maxSupplyWei',
    ],
  ])('returns invalid-input for %s', (_caseName, input, path) => {
    expectInvalidInput(validateHip1Deployment(input as never), path)
  })

  it('preserves trailing spaces in token names for the local code-point count', () => {
    const result = validateHip1Deployment({
      ...validDeploymentInput,
      name: 'ABC   ',
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.checks).toEqual(
      expect.arrayContaining([
        { status: 'satisfied', ruleId: 'hl.hip1.deployment.name-code-points' },
      ]),
    )
    expect(result.trace.normalizedInputs.name).toBe('ABC   ')
    expect(result.trace.intermediates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stepId: 'hip1.name.code-point-count', output: 6 }),
      ]),
    )
  })

  it('counts emoji as one ECMAScript code point for the local name-length assumption', () => {
    const result = validateHip1Deployment({
      ...validDeploymentInput,
      name: 'AB😀CD',
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.trace.intermediates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stepId: 'hip1.name.code-point-count', output: 5 }),
      ]),
    )
  })

  it('rejects unpaired surrogate spellings as invalid plain text', () => {
    const result = validateHip1Deployment({
      ...validDeploymentInput,
      name: 'BAD\uD800',
    })

    expectInvalidInput(result, '/name')
  })

  it('rejects isolated low surrogate spellings as invalid plain text', () => {
    const result = validateHip1Deployment({
      ...validDeploymentInput,
      name: '\uDC00BAD',
    })

    expectInvalidInput(result, '/name')
  })
})

describe('evaluateHip1AnchorGenesisEligibility', () => {
  it('returns exact rational threshold, positive weight, and trace metadata above threshold', () => {
    const result = evaluateHip1AnchorGenesisEligibility({
      holderBalanceWei: '2',
      anchorTokenMaxSupplyWei: '1000001',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        thresholdWei: '1.000001',
        weightWei: '0.999999',
        eligible: true,
      },
    })
    expect(result.trace).toMatchObject({
      formulaId: 'hl.hip1.anchor-genesis.evaluate',
      formulaVersion: 1,
      authority: 'local-exact',
      maturity: 'experimental',
      completion: { status: 'complete' },
      normalizedInputs: {
        holderBalanceWei: '2',
        anchorTokenMaxSupplyWei: '1000001',
      },
      sourceRefs: expect.arrayContaining(['HL.DOC.HIP1.2026-07-19']),
    })
    expect(result.trace.intermediates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'hip1.anchor-genesis.threshold',
          output: '1.000001',
        }),
        expect.objectContaining({
          stepId: 'hip1.anchor-genesis.weight',
          output: '0.999999',
        }),
      ]),
    )
  })

  it('is not eligible exactly at an integer threshold boundary', () => {
    const result = evaluateHip1AnchorGenesisEligibility({
      holderBalanceWei: '2',
      anchorTokenMaxSupplyWei: '2000000',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        thresholdWei: '2',
        weightWei: '0',
        eligible: false,
      },
    })
  })

  it('is not eligible below a fractional threshold and does not floor the threshold first', () => {
    const result = evaluateHip1AnchorGenesisEligibility({
      holderBalanceWei: '1',
      anchorTokenMaxSupplyWei: '1000001',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        thresholdWei: '1.000001',
        weightWei: '0',
        eligible: false,
      },
    })
  })

  it('preserves the exact 40-significant-digit anchor weight boundary', () => {
    const holderBalanceWei = '9'.repeat(34)
    const result = evaluateHip1AnchorGenesisEligibility({
      holderBalanceWei,
      anchorTokenMaxSupplyWei: '1',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        thresholdWei: '0.000001',
        weightWei: `${'9'.repeat(33)}8.999999`,
        eligible: true,
      },
    })
  })

  it('rejects an anchor weight that Decimal40 cannot represent exactly', () => {
    const result = evaluateHip1AnchorGenesisEligibility({
      holderBalanceWei: '9'.repeat(35),
      anchorTokenMaxSupplyWei: '1',
    })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [expect.objectContaining({ code: 'integer-overflow', path: '/weightWei' })],
    })
  })

  it.each([
    ['extra field', { holderBalanceWei: '1', anchorTokenMaxSupplyWei: '1', extra: '1' }, ''],
    [
      'negative holder balance',
      { holderBalanceWei: '-1', anchorTokenMaxSupplyWei: '1' },
      '/holderBalanceWei',
    ],
    [
      'fractional holder balance',
      { holderBalanceWei: '1.5', anchorTokenMaxSupplyWei: '1' },
      '/holderBalanceWei',
    ],
    [
      'exponent max supply',
      { holderBalanceWei: '1', anchorTokenMaxSupplyWei: '1e6' },
      '/anchorTokenMaxSupplyWei',
    ],
    [
      'overflowing max supply',
      { holderBalanceWei: '1', anchorTokenMaxSupplyWei: `1${'0'.repeat(41)}` },
      '/anchorTokenMaxSupplyWei',
    ],
  ])('returns invalid-input for %s', (_caseName, input, path) => {
    const result = evaluateHip1AnchorGenesisEligibility(input)

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path })]))
  })
})
