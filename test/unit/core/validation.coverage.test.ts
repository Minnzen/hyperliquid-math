import { describe, expect, it } from 'vitest'
import {
  exactPlainArray,
  exactPlainObject,
  isPlainObject,
  issue,
  normalizeDecimalAt,
  ownDataValue,
  reason,
} from '../../../src/core/validation.js'

describe('validation issue helpers', () => {
  it('describes issue actual values before returning them', () => {
    expect(issue('bad-field', '/input', ['not', 'plain'], 'plain scalar')).toEqual({
      code: 'bad-field',
      path: '/input',
      actual: 'array',
      expected: 'plain scalar',
    })
  })

  it('returns compact machine-readable reasons', () => {
    expect(reason('missing-oracle', '/source')).toEqual({ code: 'missing-oracle', path: '/source' })
  })
})

describe('isPlainObject', () => {
  it.each([null, [], '1'])('rejects %j as not a plain object', (input) => {
    expect(isPlainObject(input)).toBe(false)
  })

  it('accepts objects with null prototypes', () => {
    expect(isPlainObject(Object.create(null))).toBe(true)
  })
})

describe('ownDataValue', () => {
  it('returns own data descriptor values without invoking inherited getters', () => {
    const input = Object.create({
      get price() {
        throw new Error('inherited getter must not run')
      },
    })
    Object.defineProperty(input, 'price', {
      enumerable: true,
      value: '100',
    })

    expect(ownDataValue(input, 'price')).toBe('100')
  })

  it('returns undefined for accessor descriptors', () => {
    const input = {}
    Object.defineProperty(input, 'price', {
      enumerable: true,
      get() {
        return '100'
      },
    })

    expect(ownDataValue(input, 'price')).toBeUndefined()
  })
})

describe('exactPlainObject', () => {
  it('returns the original object when it has exactly enumerable data fields', () => {
    const input = { price: '100', size: '2' }

    expect(exactPlainObject(input, ['price', 'size'], '/order')).toEqual({
      ok: true,
      object: input,
    })
  })

  it('rejects primitive inputs with the expected key list', () => {
    expect(exactPlainObject('not-object', ['price'], '/order')).toEqual({
      ok: false,
      issue: {
        code: 'invalid-input-shape',
        path: '/order',
        actual: 'not-object',
        expected: 'plain object with exactly keys price',
      },
    })
  })

  it('rejects objects with symbol keys', () => {
    const input = { price: '100', [Symbol('hidden')]: 'x' }

    expect(exactPlainObject(input, ['price'], '/order')).toEqual({
      ok: false,
      issue: {
        code: 'invalid-input-shape',
        path: '/order',
        actual: 'Symbol(hidden),price',
        expected: 'plain object with exactly keys price',
      },
    })
  })

  it('rejects missing root data fields at a child path', () => {
    const input = {}
    Object.defineProperty(input, 'price', {
      enumerable: true,
      get() {
        return '100'
      },
    })

    expect(exactPlainObject(input, ['price'], '')).toEqual({
      ok: false,
      issue: {
        code: 'invalid-input-shape',
        path: '/price',
        actual: 'price',
        expected: 'enumerable own data field',
      },
    })
  })

  it('rejects non-enumerable data fields at a nested path', () => {
    const input = {}
    Object.defineProperty(input, 'price', {
      enumerable: false,
      value: '100',
    })

    expect(exactPlainObject(input, ['price'], '/order')).toEqual({
      ok: false,
      issue: {
        code: 'invalid-input-shape',
        path: '/order/price',
        actual: 'price',
        expected: 'enumerable own data field',
      },
    })
  })

  it('reports uninspectable objects instead of throwing', () => {
    const input = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('prototype unavailable')
        },
      },
    )

    expect(exactPlainObject(input, ['price'], '/order')).toEqual({
      ok: false,
      issue: {
        code: 'invalid-input-shape',
        path: '/order',
        actual: 'uninspectable-object',
        expected: 'plain data object',
      },
    })
  })
})

describe('exactPlainArray', () => {
  it('returns dense values for a plain array at the exact length', () => {
    expect(exactPlainArray(['100', '2'], '/levels', { exactLength: 2, maxLength: 2 })).toEqual({
      ok: true,
      values: ['100', '2'],
    })
  })

  it('rejects subclasses instead of accepting array-like prototypes', () => {
    class Levels extends Array<string> {}

    expect(exactPlainArray(new Levels('100'), '/levels', { maxLength: 2 })).toMatchObject({
      ok: false,
      issue: {
        code: 'invalid-input-shape',
        path: '/levels',
        expected: 'plain array',
      },
    })
  })

  it('rejects arrays longer than the maximum', () => {
    expect(exactPlainArray(['100', '2', '1'], '/levels', { maxLength: 2 })).toEqual({
      ok: false,
      issue: {
        code: 'invalid-input-shape',
        path: '/levels',
        actual: '3',
        expected: 'plain array with at most 2 entries',
      },
    })
  })

  it('rejects arrays that do not match the exact length', () => {
    expect(exactPlainArray(['100'], '/level', { exactLength: 2, maxLength: 2 })).toEqual({
      ok: false,
      issue: {
        code: 'invalid-input-shape',
        path: '/level',
        actual: '1',
        expected: 'plain array with exactly 2 entries',
      },
    })
  })

  it('rejects sparse arrays before reading entries', () => {
    const input = new Array(2)

    expect(exactPlainArray(input, '/levels', { maxLength: 2 })).toEqual({
      ok: false,
      issue: {
        code: 'invalid-input-shape',
        path: '/levels',
        actual: 'extra-or-missing-keys',
        expected: 'dense plain array',
      },
    })
  })

  it('rejects accessor array entries as non-data entries', () => {
    const input = ['100']
    Object.defineProperty(input, '0', {
      enumerable: true,
      get() {
        return '100'
      },
    })

    expect(exactPlainArray(input, '/levels', { maxLength: 1 })).toEqual({
      ok: false,
      issue: {
        code: 'invalid-input-shape',
        path: '/levels/0',
        actual: '0',
        expected: 'dense enumerable own data entry',
      },
    })
  })

  it('rejects arrays with custom keys even when descriptors look dense', () => {
    const input = new Proxy(['100', '2'], {
      ownKeys() {
        return ['length', '0', 'custom']
      },
      getOwnPropertyDescriptor(target, key) {
        if (key === 'custom') return { configurable: true, enumerable: true, value: 'x' }
        if (key === '1') return { configurable: true, enumerable: true, value: '2' }
        return Reflect.getOwnPropertyDescriptor(target, key)
      },
    })

    expect(exactPlainArray(input, '/levels', { maxLength: 2 })).toEqual({
      ok: false,
      issue: {
        code: 'invalid-input-shape',
        path: '/levels',
        actual: 'custom-array-key',
        expected: 'dense plain array',
      },
    })
  })

  it('reports uninspectable arrays instead of throwing', () => {
    const input = new Proxy(['100'], {
      getOwnPropertyDescriptor(_target, key) {
        if (key === 'length') throw new Error('length unavailable')
        return undefined
      },
    })

    expect(exactPlainArray(input, '/levels', { maxLength: 1 })).toEqual({
      ok: false,
      issue: {
        code: 'invalid-input-shape',
        path: '/levels',
        actual: 'uninspectable-array',
        expected: 'plain data array',
      },
    })
  })
})

describe('normalizeDecimalAt', () => {
  it('rejects non-string inputs', () => {
    expect(normalizeDecimalAt(1, '/price', 'signed')).toEqual({
      ok: false,
      issue: {
        code: 'invalid-decimal-string',
        path: '/price',
        actual: '1',
        expected: 'plain decimal string',
      },
    })
  })

  it('returns parser issues at the requested path', () => {
    expect(normalizeDecimalAt('1e3', '/price', 'signed')).toEqual({
      ok: false,
      issue: {
        code: 'invalid-decimal-string',
        path: '/price',
        actual: '1e3',
        expected: 'plain decimal string without exponent, sign +, or whitespace',
      },
    })
  })

  it('allows negative values in signed mode', () => {
    expect(normalizeDecimalAt('-1.2300', '/price', 'signed')).toMatchObject({
      ok: true,
      value: '-1.23',
    })
  })

  it('rejects zero in positive mode', () => {
    expect(normalizeDecimalAt('0.000', '/price', 'positive')).toEqual({
      ok: false,
      issue: {
        code: 'non-positive-decimal',
        path: '/price',
        actual: '0',
        expected: 'positive decimal string',
      },
    })
  })

  it('rejects negative values in positive mode', () => {
    expect(normalizeDecimalAt('-0.01', '/price', 'positive')).toEqual({
      ok: false,
      issue: {
        code: 'non-positive-decimal',
        path: '/price',
        actual: '-0.01',
        expected: 'positive decimal string',
      },
    })
  })

  it('rejects negative values in non-negative mode', () => {
    expect(normalizeDecimalAt('-0.01', '/price', 'non-negative')).toEqual({
      ok: false,
      issue: {
        code: 'negative-decimal',
        path: '/price',
        actual: '-0.01',
        expected: 'non-negative decimal string',
      },
    })
  })

  it('allows zero in non-negative mode', () => {
    expect(normalizeDecimalAt('0.000', '/price', 'non-negative')).toMatchObject({
      ok: true,
      value: '0',
    })
  })
})
