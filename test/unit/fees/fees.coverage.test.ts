import { describe, expect, it } from 'vitest'
import {
  calculateTradeFee,
  calculateWeightedFeeVolume,
  selectFeeTier,
} from '../../../src/fees/index.js'

const baseRates = { makerRate: '0.0001', takerRate: '0.0005' }

describe('calculateTradeFee validation coverage', () => {
  it('rejects a non-object root as invalid input', () => {
    const result = calculateTradeFee(null as never)

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-input-shape', path: '' }],
    })
    expect(result.trace).toMatchObject({
      completion: {
        status: 'incomplete',
        reason: { code: 'invalid-input-shape', path: '' },
      },
      normalizedInputs: {},
    })
  })

  it('rejects a missing size field before reading decimal values', () => {
    const result = calculateTradeFee({ price: '100', rate: '0.001' } as never)

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-input-shape', path: '' }],
    })
  })

  it('rejects a non-positive price decimal', () => {
    const result = calculateTradeFee({ price: '0', size: '1', rate: '0.001' })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'non-positive-decimal', path: '/price' }],
    })
  })

  it('rejects a negative size decimal', () => {
    const result = calculateTradeFee({ price: '100', size: '-1', rate: '0.001' })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'negative-decimal', path: '/size' }],
    })
  })

  it('rejects a non-string fee rate', () => {
    const result = calculateTradeFee({ price: '100', size: '1', rate: 0.001 } as never)

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-decimal-string', path: '/rate' }],
    })
  })

  it('records all fee calculation trace steps for a non-zero trade', () => {
    const result = calculateTradeFee({ price: '12.5', size: '3', rate: '-0.0001' })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        notional: '37.5',
        feeAmount: '-0.00375',
        accountValueDelta: '0.00375',
      },
    })
    expect(result.trace.intermediates).toEqual([
      { stepId: 'notional', inputs: { price: '12.5', size: '3' }, output: '37.5' },
      { stepId: 'fee-amount', inputs: { notional: '37.5', rate: '-0.0001' }, output: '-0.00375' },
      { stepId: 'account-value-delta', inputs: { feeAmount: '-0.00375' }, output: '0.00375' },
    ])
    expect(result.trace.sourceRefs).toContain('HL.DOC.FEES.2026-07-19')
  })
})

describe('calculateWeightedFeeVolume validation coverage', () => {
  it('rejects an extra root key', () => {
    const result = calculateWeightedFeeVolume({
      perpsVolume: '1',
      spotVolume: '2',
      extra: '3',
    } as never)

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-input-shape', path: '' }],
    })
  })

  it('rejects a non-string perps volume', () => {
    const result = calculateWeightedFeeVolume({ perpsVolume: 1, spotVolume: '2' } as never)

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-decimal-string', path: '/perpsVolume' }],
    })
  })

  it('rejects a negative spot volume', () => {
    const result = calculateWeightedFeeVolume({ perpsVolume: '1', spotVolume: '-0.01' })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'negative-decimal', path: '/spotVolume' }],
    })
  })

  it('returns zero when both source volumes are zero', () => {
    const result = calculateWeightedFeeVolume({ perpsVolume: '0', spotVolume: '0' })

    expect(result).toMatchObject({
      value: { status: 'ok', data: { weightedVolume: '0' } },
      trace: {
        completion: { status: 'complete' },
        intermediates: [
          {
            stepId: 'weighted-volume',
            inputs: { perpsVolume: '0', spotVolume: '0' },
            output: '0',
          },
        ],
      },
    })
  })
})

describe('selectFeeTier validation coverage', () => {
  it('rejects a missing tiers root field', () => {
    const result = selectFeeTier({ weightedVolume: '100', baseRates } as never)

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-input-shape', path: '' }],
    })
  })

  it('rejects a negative weighted volume', () => {
    const result = selectFeeTier({ weightedVolume: '-1', baseRates, tiers: [] })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'negative-decimal', path: '/weightedVolume' }],
    })
  })

  it('rejects an invalid base maker rate', () => {
    const result = selectFeeTier({
      weightedVolume: '100',
      baseRates: { makerRate: 0, takerRate: '0.0005' },
      tiers: [],
    } as never)

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-decimal-string', path: '/baseRates/makerRate' }],
    })
  })

  it('rejects a base rate schedule with extra fields', () => {
    const result = selectFeeTier({
      weightedVolume: '100',
      baseRates: { makerRate: '0', takerRate: '0.0005', vip: '0' },
      tiers: [],
    } as never)

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-input-shape', path: '/baseRates' }],
    })
  })

  it('rejects a tier without an enumerable data threshold', () => {
    const tier = Object.defineProperty(
      { makerRate: '0', takerRate: '0.0004' },
      'minimumWeightedVolume',
      { enumerable: true, get: () => '100' },
    )

    const result = selectFeeTier({ weightedVolume: '1000', baseRates, tiers: [tier] } as never)

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-input-shape', path: '/tiers/0/minimumWeightedVolume' }],
    })
  })

  it('rejects a zero tier threshold', () => {
    const result = selectFeeTier({
      weightedVolume: '1000',
      baseRates,
      tiers: [{ minimumWeightedVolume: '0', makerRate: '0', takerRate: '0.0004' }],
    })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'non-positive-decimal', path: '/tiers/0/minimumWeightedVolume' }],
    })
  })

  it('rejects an invalid tier taker rate', () => {
    const result = selectFeeTier({
      weightedVolume: '1000',
      baseRates,
      tiers: [{ minimumWeightedVolume: '100', makerRate: '0', takerRate: {} }],
    } as never)

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-decimal-string', path: '/tiers/0/takerRate' }],
    })
  })

  it('rejects tier arrays above the documented single response cap', () => {
    const tiers = Array.from({ length: 129 }, (_, index) => ({
      minimumWeightedVolume: String(index + 1),
      makerRate: '0',
      takerRate: '0.0004',
    }))

    const result = selectFeeTier({ weightedVolume: '1000', baseRates, tiers })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-input-shape', path: '/tiers' }],
    })
  })

  it('rejects sparse tier arrays', () => {
    const tiers = new Array(1)
    const result = selectFeeTier({ weightedVolume: '1000', baseRates, tiers } as never)

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-input-shape', path: '/tiers' }],
    })
  })

  it('selects the last tier whose threshold is strictly exceeded', () => {
    const result = selectFeeTier({
      weightedVolume: '250',
      baseRates,
      tiers: [
        { minimumWeightedVolume: '100', makerRate: '0', takerRate: '0.0004' },
        { minimumWeightedVolume: '200', makerRate: '-0.0001', takerRate: '0.0003' },
      ],
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        selection: { kind: 'volume', index: 1, minimumWeightedVolume: '200' },
        makerRate: '-0.0001',
        takerRate: '0.0003',
      },
    })
    expect(result.trace.intermediates).toEqual([
      {
        stepId: 'selected-tier',
        inputs: { weightedVolume: '250' },
        output: { kind: 'volume', index: 1, minimumWeightedVolume: '200' },
      },
    ])
  })
})
