import { describe, expect, it } from 'vitest'
import { quantizePrice, quantizeSize } from '../../../src/precision/index.js'

describe('quantizePrice', () => {
  it('rounds decimal places before significant figures and records applied decisions', () => {
    expect(
      quantizePrice({ value: '12345.67891', marketKind: 'perp', szDecimals: 2, rounding: 'down' }),
    ).toEqual({
      value: { status: 'ok', data: { value: '12345', precisionChanged: true } },
      trace: {
        formulaId: 'hl.precision.price.quantize',
        formulaVersion: 1,
        authority: 'local-exact',
        maturity: 'stable',
        completion: { status: 'complete' },
        normalizedInputs: {
          value: '12345.67891',
          marketKind: 'perp',
          szDecimals: 2,
          rounding: 'down',
        },
        intermediates: [
          {
            stepId: 'price-decimal-places',
            inputs: { value: '12345.67891', decimalPlaces: 4, rounding: 'down' },
            output: '12345.6789',
          },
          {
            stepId: 'price-significant-figures',
            inputs: { value: '12345.6789', significantFigures: 5, rounding: 'down' },
            output: '12345',
          },
        ],
        rounding: [
          {
            path: '/value',
            input: '12345.67891',
            output: '12345.6789',
            mode: 'down',
            reasonCode: 'price-max-decimal-places',
          },
          {
            path: '/value',
            input: '12345.6789',
            output: '12345',
            mode: 'down',
            reasonCode: 'price-max-significant-figures',
          },
        ],
        assumptions: [],
        sourceRefs: [
          'HLM.SPEC.PRECISION.PRICE.V1',
          'HL.DOC.TICK_LOT.2026-07-19',
          'HL.DOC.SIGNING.2026-07-19',
          'DECIMALJS.10.6.0',
        ],
      },
    })
  })

  it('rounds up with the explicit caller direction', () => {
    const result = quantizePrice({
      value: '12345.67891',
      marketKind: 'perp',
      szDecimals: 2,
      rounding: 'up',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: { value: '12346', precisionChanged: true },
    })
    expect(result.trace.rounding.map((decision) => decision.mode)).toEqual(['up', 'up'])
  })

  it('exempts integer prices from significant-figure rounding', () => {
    const result = quantizePrice({
      value: '123456789',
      marketKind: 'spot',
      szDecimals: 8,
      rounding: 'down',
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: { value: '123456789', precisionChanged: false },
    })
    expect(result.trace.rounding).toEqual([])
  })

  it('chooses the tightest conservative candidate allowed by the integer-price exemption', () => {
    const down = quantizePrice({
      value: '123456.7',
      marketKind: 'perp',
      szDecimals: 2,
      rounding: 'down',
    })
    const up = quantizePrice({
      value: '123456.1',
      marketKind: 'perp',
      szDecimals: 2,
      rounding: 'up',
    })

    expect(down.value).toEqual({
      status: 'ok',
      data: { value: '123456', precisionChanged: true },
    })
    expect(up.value).toEqual({
      status: 'ok',
      data: { value: '123457', precisionChanged: true },
    })
  })

  it('rejects invalid shape, enum, bounds, non-positive values, and rounded zeroes', () => {
    expect(
      quantizePrice({ value: '1', marketKind: 'perp', szDecimals: 7, rounding: 'down' }).value,
    ).toMatchObject({ status: 'invalid-input' })
    expect(
      quantizePrice({ value: '1e3', marketKind: 'perp', szDecimals: 2, rounding: 'down' }).value,
    ).toMatchObject({ status: 'invalid-input' })
    expect(
      quantizePrice({ value: '0', marketKind: 'perp', szDecimals: 2, rounding: 'down' }).value,
    ).toMatchObject({ status: 'invalid-input' })
    expect(
      quantizePrice({ value: '0.00000001', marketKind: 'perp', szDecimals: 0, rounding: 'down' })
        .value,
    ).toMatchObject({ status: 'invalid-input' })
    expect(
      quantizePrice({
        value: '1',
        marketKind: 'perp',
        szDecimals: 2,
        rounding: 'down',
        extra: true,
      } as unknown as Parameters<typeof quantizePrice>[0]).value,
    ).toMatchObject({ status: 'invalid-input' })
    expect(
      quantizePrice({
        value: '1',
        marketKind: 'linear',
        szDecimals: 2,
        rounding: 'down',
      } as unknown as Parameters<typeof quantizePrice>[0]).value,
    ).toMatchObject({ status: 'invalid-input' })
  })

  it('rejects accessors without invoking them', () => {
    let reads = 0
    const input = Object.defineProperties(
      {},
      {
        value: {
          enumerable: true,
          get() {
            reads += 1
            return '1'
          },
        },
        marketKind: { enumerable: true, value: 'perp' },
        szDecimals: { enumerable: true, value: 2 },
        rounding: { enumerable: true, value: 'down' },
      },
    )

    const result = quantizePrice(input as Parameters<typeof quantizePrice>[0])

    expect(result.value.status).toBe('invalid-input')
    expect(reads).toBe(0)
  })

  it('rejects invalid rounding directions', () => {
    const result = quantizePrice({
      value: '1',
      marketKind: 'perp',
      szDecimals: 2,
      rounding: 'nearest',
    } as unknown as Parameters<typeof quantizePrice>[0])

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'invalid-rounding', path: '/rounding' },
    })
  })

  it('rejects non-plain price input objects', () => {
    const result = quantizePrice(new Date(0) as unknown as Parameters<typeof quantizePrice>[0])

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'invalid-input-shape', path: '' },
    })
  })

  it('rejects uninspectable price input objects', () => {
    const input = new Proxy(
      { value: '1', marketKind: 'perp', szDecimals: 2, rounding: 'down' },
      {
        ownKeys() {
          throw new Error('blocked')
        },
      },
    )

    const result = quantizePrice(input as unknown as Parameters<typeof quantizePrice>[0])

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'invalid-input-shape', path: '' },
    })
  })

  it('rejects price inputs with non-string decimal values', () => {
    const result = quantizePrice({
      value: 1,
      marketKind: 'perp',
      szDecimals: 2,
      rounding: 'down',
    } as unknown as Parameters<typeof quantizePrice>[0])

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'invalid-input-shape', path: '' },
    })
  })

  it('rejects null price input shapes', () => {
    const result = quantizePrice(null as unknown as Parameters<typeof quantizePrice>[0])

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'invalid-input-shape', path: '' },
    })
  })

  it('rejects array price input shapes', () => {
    const result = quantizePrice([] as unknown as Parameters<typeof quantizePrice>[0])

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'invalid-input-shape', path: '' },
    })
  })
})

describe('quantizeSize', () => {
  it('rounds positive size down to szDecimals and records the decision', () => {
    expect(quantizeSize({ value: '001.234567', szDecimals: 3 })).toEqual({
      value: { status: 'ok', data: { value: '1.234', precisionChanged: true } },
      trace: {
        formulaId: 'hl.precision.size.quantize',
        formulaVersion: 1,
        authority: 'local-exact',
        maturity: 'stable',
        completion: { status: 'complete' },
        normalizedInputs: { value: '1.234567', szDecimals: 3 },
        intermediates: [
          {
            stepId: 'size-decimal-places',
            inputs: { value: '1.234567', decimalPlaces: 3, rounding: 'down' },
            output: '1.234',
          },
        ],
        rounding: [
          {
            path: '/value',
            input: '1.234567',
            output: '1.234',
            mode: 'down',
            reasonCode: 'size-max-decimal-places',
          },
        ],
        assumptions: [],
        sourceRefs: [
          'HLM.SPEC.PRECISION.SIZE.V1',
          'HL.DOC.TICK_LOT.2026-07-19',
          'HL.DOC.SIGNING.2026-07-19',
          'DECIMALJS.10.6.0',
        ],
      },
    })
  })

  it('returns no rounding decision when numeric value is unchanged', () => {
    const result = quantizeSize({ value: '001.2300', szDecimals: 4 })

    expect(result.value).toEqual({
      status: 'ok',
      data: { value: '1.23', precisionChanged: false },
    })
    expect(result.trace.rounding).toEqual([])
  })

  it('rejects invalid size inputs and rounded zeroes', () => {
    expect(quantizeSize({ value: '1', szDecimals: 9 }).value).toMatchObject({
      status: 'invalid-input',
    })
    expect(quantizeSize({ value: '-1', szDecimals: 2 }).value).toMatchObject({
      status: 'invalid-input',
    })
    expect(quantizeSize({ value: '0.0001', szDecimals: 3 }).value).toMatchObject({
      status: 'invalid-input',
    })
    expect(
      quantizeSize({ value: '1', szDecimals: 2, extra: true } as unknown as Parameters<
        typeof quantizeSize
      >[0]).value,
    ).toMatchObject({ status: 'invalid-input' })
  })

  it('rejects size inputs with non-string decimal values', () => {
    const result = quantizeSize({
      value: 1,
      szDecimals: 2,
    } as unknown as Parameters<typeof quantizeSize>[0])

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'invalid-input-shape', path: '' },
    })
  })

  it('rejects invalid size decimal strings', () => {
    const result = quantizeSize({ value: '1e3', szDecimals: 2 })

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'invalid-decimal-string', path: '/value' },
    })
  })

  it('rejects non-plain size input objects', () => {
    const result = quantizeSize(new Date(0) as unknown as Parameters<typeof quantizeSize>[0])

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'invalid-input-shape', path: '' },
    })
  })

  it('rejects uninspectable size input objects', () => {
    const input = new Proxy(
      { value: '1', szDecimals: 2 },
      {
        ownKeys() {
          throw new Error('blocked')
        },
      },
    )

    const result = quantizeSize(input as unknown as Parameters<typeof quantizeSize>[0])

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'invalid-input-shape', path: '' },
    })
  })
})
