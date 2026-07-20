import { describe, expect, it } from 'vitest'
import { canonicalizeDecimalString } from '../../../src/precision/index.js'

describe('canonicalizeDecimalString', () => {
  it('returns canonical data and a complete trace', () => {
    expect(canonicalizeDecimalString({ value: '001.2300' })).toEqual({
      value: { status: 'ok', data: '1.23' },
      trace: {
        formulaId: 'hl.precision.decimal.canonicalize',
        formulaVersion: 1,
        authority: 'local-exact',
        maturity: 'stable',
        completion: { status: 'complete' },
        normalizedInputs: { value: '1.23' },
        intermediates: [
          {
            stepId: 'canonicalize-decimal',
            inputs: { value: '001.2300' },
            output: '1.23',
          },
        ],
        rounding: [],
        assumptions: [],
        sourceRefs: ['HLM.SPEC.PRECISION.CANONICAL_DECIMAL.V1', 'DECIMALJS.10.6.0'],
      },
    })
  })

  it('returns invalid-input and an incomplete serializable trace', () => {
    const result = canonicalizeDecimalString({ value: '1e3' })
    expect(result.value).toEqual({
      status: 'invalid-input',
      issues: [
        {
          code: 'invalid-decimal-string',
          path: '/value',
          actual: '1e3',
          expected: 'plain decimal string without exponent, sign +, or whitespace',
        },
      ],
    })
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'invalid-decimal-string', path: '/value' },
    })
    expect(() => JSON.stringify(result)).not.toThrow()
  })

  it.each([null, [], {}, { value: 1 }, { value: '1', extra: true }])(
    'rejects an invalid plain-data shape: %j',
    (input) => {
      const result = canonicalizeDecimalString(
        input as unknown as Parameters<typeof canonicalizeDecimalString>[0],
      )
      expect(result.value.status).toBe('invalid-input')
    },
  )

  it('rejects class instances even when their own fields match', () => {
    class DecimalInput {
      readonly value = '1'
    }

    const result = canonicalizeDecimalString(
      new DecimalInput() as unknown as Parameters<typeof canonicalizeDecimalString>[0],
    )

    expect(result.value.status).toBe('invalid-input')
  })

  it('rejects accessors without invoking them', () => {
    let reads = 0
    const input = Object.defineProperty({}, 'value', {
      enumerable: true,
      get() {
        reads += 1
        return '1'
      },
    })

    const result = canonicalizeDecimalString(
      input as Parameters<typeof canonicalizeDecimalString>[0],
    )

    expect(result.value.status).toBe('invalid-input')
    expect(reads).toBe(0)
  })

  it('rejects reflective traps without throwing', () => {
    const input = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('must not escape the public facade')
        },
      },
    )

    expect(() =>
      canonicalizeDecimalString(input as Parameters<typeof canonicalizeDecimalString>[0]),
    ).not.toThrow()
    expect(
      canonicalizeDecimalString(input as Parameters<typeof canonicalizeDecimalString>[0]).value
        .status,
    ).toBe('invalid-input')
  })

  it.each([
    Object.assign({ value: '1' }, { [Symbol('extra')]: true }),
    Object.defineProperty({ value: '1' }, 'extra', { value: true }),
  ])('rejects hidden own fields outside the declared input', (input) => {
    const result = canonicalizeDecimalString(
      input as Parameters<typeof canonicalizeDecimalString>[0],
    )

    expect(result.value.status).toBe('invalid-input')
  })

  it('rejects a non-enumerable declared field that JSON cannot replay', () => {
    const input = Object.defineProperty({}, 'value', { value: '1' })
    const result = canonicalizeDecimalString(
      input as Parameters<typeof canonicalizeDecimalString>[0],
    )

    expect(JSON.stringify(input)).toBe('{}')
    expect(result.value.status).toBe('invalid-input')
  })

  it('accepts a null-prototype plain-data object', () => {
    const input = Object.assign(Object.create(null) as object, { value: '001.00' })
    const result = canonicalizeDecimalString(
      input as Parameters<typeof canonicalizeDecimalString>[0],
    )

    expect(result.value).toEqual({ status: 'ok', data: '1' })
  })
})
