import { describe, expect, it } from 'vitest'
import {
  annualizeFundingRate,
  calculateFundingPayment,
  calculateFundingPremiumIndex,
  calculateFundingRate,
  calculatePerpBreakEvenPrice,
  calculatePerpUnrealizedPnl,
  calculateTradeFee,
  calculateWeightedFeeVolume,
  projectPerpFill,
  projectPerpFillSequence,
  selectFeeTier,
} from '../../src/index.js'

const facades = [
  ['calculateTradeFee', calculateTradeFee],
  ['calculateWeightedFeeVolume', calculateWeightedFeeVolume],
  ['selectFeeTier', selectFeeTier],
  ['calculatePerpUnrealizedPnl', calculatePerpUnrealizedPnl],
  ['projectPerpFill', projectPerpFill],
  ['projectPerpFillSequence', projectPerpFillSequence],
  ['calculatePerpBreakEvenPrice', calculatePerpBreakEvenPrice],
  ['calculateFundingPremiumIndex', calculateFundingPremiumIndex],
  ['calculateFundingRate', calculateFundingRate],
  ['calculateFundingPayment', calculateFundingPayment],
  ['annualizeFundingRate', annualizeFundingRate],
] as const

describe('M2 public facade safety', () => {
  it.each(facades)('%s rejects a revoked root proxy without throwing', (_name, facade) => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()

    expect(() => (facade as (input: never) => unknown)(proxy as never)).not.toThrow()
    const result = (facade as (input: never) => { value: { status: string } })(proxy as never)
    expect(result.value.status).toBe('invalid-input')
  })

  it('does not invoke nested accessors or hostile discriminator coercion', () => {
    let reads = 0
    const position = Object.defineProperties(
      {},
      {
        kind: {
          enumerable: true,
          get() {
            reads += 1
            return 'open'
          },
        },
        signedSize: { enumerable: true, value: '1' },
        entryPrice: { enumerable: true, value: '100' },
      },
    )
    const hostileConvention = {
      toString() {
        throw new Error('must not coerce discriminators')
      },
    }

    expect(() => calculatePerpUnrealizedPnl({ position, markPrice: '101' } as never)).not.toThrow()
    expect(reads).toBe(0)
    expect(() =>
      annualizeFundingRate({
        periodicRate: '0.01',
        periodsPerYear: 12,
        convention: hostileConvention,
      } as never),
    ).not.toThrow()
  })

  it('keeps invalid fee and funding traces assumption-free', () => {
    const invalidResults = [
      calculateTradeFee(null as never),
      calculateWeightedFeeVolume(null as never),
      selectFeeTier(null as never),
      calculateFundingPremiumIndex(null as never),
      calculateFundingRate(null as never),
      calculateFundingPayment(null as never),
      annualizeFundingRate(null as never),
      annualizeFundingRate({
        periodicRate: '-1',
        periodsPerYear: 2,
        convention: 'compound',
      }),
    ]

    for (const result of invalidResults) {
      expect(result.value.status).toBe('invalid-input')
      expect(result.trace.completion.status).toBe('incomplete')
      expect(result.trace.assumptions).toEqual([])
    }
  })

  it('rejects sparse, oversized, and custom-key fill arrays', () => {
    const sparse = new Array(2)
    sparse[0] = { side: 'buy', size: '1', price: '1', fee: { kind: 'none' } }
    expect(
      projectPerpFillSequence({ position: { kind: 'flat' }, fills: sparse } as never).value.status,
    ).toBe('invalid-input')

    const oversized = Array.from({ length: 2001 }, () => ({
      side: 'buy' as const,
      size: '0',
      price: '1',
      fee: { kind: 'none' as const },
    }))
    expect(
      projectPerpFillSequence({ position: { kind: 'flat' }, fills: oversized }).value.status,
    ).toBe('invalid-input')

    const custom = [
      { side: 'buy' as const, size: '1', price: '1', fee: { kind: 'none' as const } },
    ] as Array<unknown> & { extra?: string }
    custom.extra = 'unexpected'
    expect(
      projectPerpFillSequence({ position: { kind: 'flat' }, fills: custom } as never).value.status,
    ).toBe('invalid-input')
  })
})
