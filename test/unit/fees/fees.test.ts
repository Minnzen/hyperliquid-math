import { describe, expect, it } from 'vitest'
import {
  calculateTradeFee,
  calculateWeightedFeeVolume,
  selectFeeTier,
} from '../../../src/fees/index.js'

describe('calculateTradeFee', () => {
  it('computes a signed account delta from an explicit trade rate', () => {
    expect(calculateTradeFee({ price: '100', size: '2', rate: '0.001' })).toMatchObject({
      value: {
        status: 'ok',
        data: {
          notional: '200',
          feeAmount: '0.2',
          accountValueDelta: '-0.2',
        },
      },
      trace: {
        formulaId: 'hl.fees.trade-fee.calculate',
        completion: { status: 'complete' },
        normalizedInputs: {
          price: '100',
          size: '2',
          rate: '0.001',
        },
      },
    })
  })

  it('returns not-applicable for a zero-size trade', () => {
    const result = calculateTradeFee({ price: '100', size: '0', rate: '0.001' })

    expect(result.value).toEqual({
      status: 'not-applicable',
      reason: { code: 'zero-trade-size', path: '/size' },
    })
    expect(result.trace.completion).toEqual({ status: 'complete' })
  })

  it('rejects accessor inputs without invoking them', () => {
    let reads = 0
    const input = Object.defineProperties(
      {},
      {
        price: {
          enumerable: true,
          get() {
            reads += 1
            return '100'
          },
        },
        size: { enumerable: true, value: '2' },
        rate: { enumerable: true, value: '0.001' },
      },
    )

    const result = calculateTradeFee(input as Parameters<typeof calculateTradeFee>[0])

    expect(result.value.status).toBe('invalid-input')
    expect(reads).toBe(0)
  })
})

describe('calculateWeightedFeeVolume', () => {
  it('weights spot volume twice', () => {
    expect(calculateWeightedFeeVolume({ perpsVolume: '100', spotVolume: '12.5' })).toMatchObject({
      value: {
        status: 'ok',
        data: { weightedVolume: '125' },
      },
      trace: {
        formulaId: 'hl.fees.weighted-volume.calculate',
        completion: { status: 'complete' },
        normalizedInputs: {
          perpsVolume: '100',
          spotVolume: '12.5',
        },
      },
    })
  })

  it('rejects negative volume', () => {
    expect(calculateWeightedFeeVolume({ perpsVolume: '-1', spotVolume: '0' }).value.status).toBe(
      'invalid-input',
    )
  })
})

describe('selectFeeTier', () => {
  it('selects the highest activated tier with strict greater-than thresholds', () => {
    expect(
      selectFeeTier({
        weightedVolume: '150',
        baseRates: { makerRate: '-0.0001', takerRate: '0.0005' },
        tiers: [
          {
            minimumWeightedVolume: '100',
            makerRate: '-0.0002',
            takerRate: '0.0004',
          },
          {
            minimumWeightedVolume: '150',
            makerRate: '-0.0003',
            takerRate: '0.0003',
          },
          {
            minimumWeightedVolume: '200',
            makerRate: '-0.0004',
            takerRate: '0.0002',
          },
        ],
      }),
    ).toMatchObject({
      value: {
        status: 'ok',
        data: {
          selection: {
            kind: 'volume',
            index: 0,
            minimumWeightedVolume: '100',
          },
          makerRate: '-0.0002',
          takerRate: '0.0004',
        },
      },
      trace: {
        formulaId: 'hl.fees.tier.select',
        completion: { status: 'complete' },
        normalizedInputs: {
          weightedVolume: '150',
          baseRates: { makerRate: '-0.0001', takerRate: '0.0005' },
          tierCount: 3,
        },
      },
    })
  })

  it('selects base at an exact threshold and rejects unsorted schedules', () => {
    const exactThreshold = selectFeeTier({
      weightedVolume: '100',
      baseRates: { makerRate: '0.0001', takerRate: '0.0005' },
      tiers: [
        {
          minimumWeightedVolume: '100',
          makerRate: '0',
          takerRate: '0.0004',
        },
      ],
    })
    expect(exactThreshold).toMatchObject({
      value: {
        status: 'ok',
        data: {
          selection: { kind: 'base' },
          makerRate: '0.0001',
          takerRate: '0.0005',
        },
      },
    })

    expect(
      selectFeeTier({
        weightedVolume: '1000',
        baseRates: { makerRate: '0.0001', takerRate: '0.0005' },
        tiers: [
          { minimumWeightedVolume: '200', makerRate: '0', takerRate: '0.0004' },
          { minimumWeightedVolume: '100', makerRate: '0', takerRate: '0.0003' },
        ],
      }).value.status,
    ).toBe('invalid-input')
  })
})
