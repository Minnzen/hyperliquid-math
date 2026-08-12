import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import {
  buildPerpScaleLadder,
  calculatePerpMaxOrderSize,
  calculatePerpSlippagePrice,
  calculatePerpTwapExecutionTarget,
  evaluatePerpReduceOnly,
} from '../../../src/orders/index.js'

function d(value: string) {
  return new Decimal(value)
}

describe('orders metamorphic behavior', () => {
  it('preserves total scale size exactly while keeping quantized prices strictly increasing', () => {
    const result = buildPerpScaleLadder({
      side: 'buy',
      lowerPrice: '100.12345',
      upperPrice: '103.98765',
      totalSize: '1.2345',
      legCount: 4,
      distribution: 'linear',
      szDecimals: 4,
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    const legs = result.value.data.legs
    expect(result.value.data.totalAllocatedSize).toBe('1.2345')
    expect(legs.map((leg) => leg.size)).toEqual(['0.3086', '0.3086', '0.3086', '0.3087'])
    expect(legs.reduce((total, leg) => total.plus(leg.size), new Decimal(0)).toFixed()).toBe(
      '1.2345',
    )
    for (let index = 1; index < legs.length; index += 1) {
      const previous = legs[index - 1]
      const current = legs[index]
      expect(previous).toBeDefined()
      expect(current).toBeDefined()
      if (previous === undefined || current === undefined) return
      expect(d(current.price).gt(previous.price)).toBe(true)
    }
  })

  it('rejects a scale ladder when conservative price quantization collapses adjacent levels', () => {
    const buy = buildPerpScaleLadder({
      side: 'buy',
      lowerPrice: '1.00001',
      upperPrice: '1.00002',
      totalSize: '1',
      legCount: 3,
      distribution: 'linear',
      szDecimals: 2,
    })
    const sell = buildPerpScaleLadder({
      side: 'sell',
      lowerPrice: '1.00001',
      upperPrice: '1.00002',
      totalSize: '1',
      legCount: 3,
      distribution: 'linear',
      szDecimals: 2,
    })

    expect(buy.value.status).toBe('invalid-input')
    expect(sell.value.status).toBe('invalid-input')
  })

  it('scales geometric ladder prices by the same factor without changing leg sizes', () => {
    const base = buildPerpScaleLadder({
      side: 'sell',
      lowerPrice: '100',
      upperPrice: '400',
      totalSize: '3',
      legCount: 3,
      distribution: 'geometric',
      szDecimals: 2,
    })
    const scaled = buildPerpScaleLadder({
      side: 'sell',
      lowerPrice: '1000',
      upperPrice: '4000',
      totalSize: '3',
      legCount: 3,
      distribution: 'geometric',
      szDecimals: 2,
    })

    expect(base.value.status).toBe('ok')
    expect(scaled.value.status).toBe('ok')
    if (base.value.status !== 'ok' || scaled.value.status !== 'ok') return
    expect(base.value.data.legs.map((leg) => leg.price)).toEqual(['100', '200', '400'])
    expect(scaled.value.data.legs.map((leg) => leg.price)).toEqual(['1000', '2000', '4000'])
    expect(scaled.value.data.legs.map((leg) => leg.size)).toEqual(
      base.value.data.legs.map((leg) => leg.size),
    )
  })

  it('keeps the TWAP execution target monotone and proportional without a discrete schedule', () => {
    const durationMs = 345_600_000
    const quarter = calculatePerpTwapExecutionTarget({
      totalSize: '10',
      durationMs,
      elapsedMs: 86_400_000,
    })
    const half = calculatePerpTwapExecutionTarget({
      totalSize: '10',
      durationMs,
      elapsedMs: 172_800_000,
    })
    const scaled = calculatePerpTwapExecutionTarget({
      totalSize: '30',
      durationMs,
      elapsedMs: 172_800_000,
    })

    expect(quarter.value).toEqual({ status: 'ok', data: { cumulativeTargetSize: '2.5' } })
    expect(half.value).toEqual({ status: 'ok', data: { cumulativeTargetSize: '5' } })
    expect(scaled.value).toEqual({ status: 'ok', data: { cumulativeTargetSize: '15' } })
  })

  it('kills slippage mutants that invert conservative rounding or use percent instead of bps', () => {
    const buy = calculatePerpSlippagePrice({
      side: 'buy',
      referencePrice: '100.123',
      slippageBps: '12.5',
      szDecimals: 2,
    })
    const sell = calculatePerpSlippagePrice({
      side: 'sell',
      referencePrice: '100.123',
      slippageBps: '12.5',
      szDecimals: 2,
    })

    expect(buy.value.status).toBe('ok')
    expect(sell.value.status).toBe('ok')
    if (buy.value.status !== 'ok' || sell.value.status !== 'ok') return
    expect(buy.value.data.rawPrice).toBe('100.24815375')
    expect(buy.value.data.protectionPrice).toBe('100.24')
    expect(buy.value.data.protectionPrice).not.toBe('101.37')
    expect(sell.value.data.rawPrice).toBe('99.99784625')
    expect(sell.value.data.protectionPrice).toBe('99.998')
    expect(sell.value.data.protectionPrice).not.toBe('98.872')
  })

  it('kills max-size mutants that ignore order-value limits or reduce-only direction', () => {
    const capped = calculatePerpMaxOrderSize({
      availableCollateral: '1000',
      leverage: '10',
      referencePrice: '100',
      currentSignedSize: '2',
      side: 'sell',
      reduceOnly: false,
      szDecimals: 2,
      orderValueLimit: { kind: 'available', value: '150' },
    })
    const wrongSideReduceOnly = calculatePerpMaxOrderSize({
      availableCollateral: '1000',
      leverage: '10',
      referencePrice: '100',
      currentSignedSize: '2',
      side: 'buy',
      reduceOnly: true,
      szDecimals: 2,
      orderValueLimit: { kind: 'available', value: '1000000' },
    })

    expect(capped.value.status).toBe('ok')
    expect(wrongSideReduceOnly.value.status).toBe('ok')
    if (capped.value.status !== 'ok' || wrongSideReduceOnly.value.status !== 'ok') return
    expect(capped.value.data.collateralBoundSize).toBe('102')
    expect(capped.value.data.orderValueBoundSize).toBe('1.5')
    expect(capped.value.data.localUpperBoundSize).toBe('1.5')
    expect(capped.value.data.localUpperBoundSize).not.toBe('102')
    expect(wrongSideReduceOnly.value.data.localUpperBoundSize).toBe('0')
  })

  it('kills reduce-only mutants that clamp flips into closes', () => {
    const result = evaluatePerpReduceOnly({
      currentSignedSize: '-2',
      side: 'buy',
      requestedSize: '2.0001',
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.reducibleSize).toBe('2')
    expect(result.value.data.requestedEffect).toBe('would-flip')
    expect(result.value.data.acceptedTransitionSize).toBeNull()
    expect(result.value.data.check.status).toBe('violated')
  })
})
