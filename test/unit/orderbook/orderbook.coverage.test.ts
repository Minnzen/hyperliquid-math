import { describe, expect, it } from 'vitest'
import { calculateBookMetrics, simulateBookFill } from '../../../src/orderbook/index.js'

const twoSidedBook = {
  levels: [[{ px: '99', sz: '2', n: 1 }], [{ px: '101', sz: '2', n: 1 }]],
} as const

function expectInvalidPath(
  result: ReturnType<typeof calculateBookMetrics> | ReturnType<typeof simulateBookFill>,
  path: string,
) {
  expect(result.value.status).toBe('invalid-input')
  if (result.value.status !== 'invalid-input') return
  expect(result.value.issues[0]?.path).toBe(path)
}

describe('calculateBookMetrics edge coverage', () => {
  it('reports both sides missing when the book has no bid or ask depth', () => {
    const result = calculateBookMetrics({ levels: [[], []] })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: { code: 'two-sided-book-required', path: '/levels' },
      missing: ['/levels/0', '/levels/1'],
    })
  })

  it('rejects a metrics input that is not a plain object', () => {
    expectInvalidPath(calculateBookMetrics(null as never), '')
  })
})

describe('simulateBookFill edge coverage', () => {
  it('walks bids for a sell size fill and reports bid-side slippage', () => {
    const result = simulateBookFill({
      ...twoSidedBook,
      side: 'sell',
      amount: { kind: 'size', value: '1.5' },
      referencePrice: '100',
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data).toMatchObject({
      completion: 'full',
      fills: [{ px: '99', sz: '1.5', notional: '148.5' }],
      filledSize: '1.5',
      filledNotional: '148.5',
      unfilledAmount: '0',
      vwap: '99',
      worstPrice: '99',
      slippageBps: '100',
    })
    expect(result.trace.rounding).toContainEqual({
      path: '/value/data/slippageBps',
      input: '1-99/100*10000',
      output: '100',
      mode: 'half-even',
      reasonCode: 'decimal40-division',
    })
  })

  it('fully consumes exact notional when the amount equals available depth', () => {
    const result = simulateBookFill({
      levels: [[{ px: '99', sz: '1', n: 1 }], [{ px: '101', sz: '2', n: 1 }]],
      side: 'buy',
      amount: { kind: 'notional', value: '202', szDecimals: 2 },
      referencePrice: '100',
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data).toMatchObject({
      completion: 'full',
      fills: [{ px: '101', sz: '2', notional: '202' }],
      filledSize: '2',
      filledNotional: '202',
      unfilledAmount: '0',
    })
  })

  it('leaves notional dust unfilled when final size rounds to zero', () => {
    const result = simulateBookFill({
      ...twoSidedBook,
      side: 'buy',
      amount: { kind: 'notional', value: '0.9', szDecimals: 0 },
      referencePrice: '100',
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data).toEqual({
      completion: 'none',
      fills: [],
      filledSize: '0',
      filledNotional: '0',
      unfilledAmount: '0.9',
    })
    expect(result.trace.rounding).toContainEqual({
      path: '/value/data/fills/0/sz',
      input: '0.9/101',
      output: '0',
      mode: 'down',
      reasonCode: 'notional-partial-size-quantization',
    })
  })

  it('returns a partial size fill when requested size exceeds available depth', () => {
    const result = simulateBookFill({
      ...twoSidedBook,
      side: 'buy',
      amount: { kind: 'size', value: '3' },
      referencePrice: '100',
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.completion).toBe('partial')
    expect(result.value.data.filledSize).toBe('2')
    expect(result.value.data.unfilledAmount).toBe('1')
  })
})

describe('orderbook plain-data validation', () => {
  it('accepts a null-prototype book object as plain data', () => {
    const result = calculateBookMetrics(nullPrototypeBook() as never)

    expect(result.value.status).toBe('indeterminate')
  })

  it.each([
    ['rejects an accessor levels field', objectWithAccessor('levels'), '/levels', undefined],
    ['rejects an input with an extra symbol key', objectWithSymbolKey(), '', undefined],
    [
      'rejects an array subclass for levels',
      { levels: new (class extends Array {})() },
      '/levels',
      undefined,
    ],
    ['rejects a levels array with the wrong length', { levels: [[]] }, '/levels', undefined],
    [
      'rejects a side array with too many levels',
      { levels: [manyLevels(), []] },
      '/levels/0',
      undefined,
    ],
    ['rejects a sparse side array', { levels: [sparseLevelSide(), []] }, '/levels/0', undefined],
    [
      'rejects a non-enumerable side entry',
      { levels: [nonEnumerableLevelSide(), []] },
      '/levels/0/0',
      undefined,
    ],
    [
      'rejects a side array with a custom key',
      { levels: [arrayWithCustomKey(), []] },
      '/levels/0',
      undefined,
    ],
    [
      'rejects a level missing a data field',
      { levels: [[objectWithAccessor('px')], []] },
      '/levels/0/0',
      undefined,
    ],
    [
      'rejects a level with a nested accessor field',
      { levels: [[levelWithAccessorPrice()], []] },
      '/levels/0/0/px',
      undefined,
    ],
    [
      'rejects a level with a non-string price',
      { levels: [[{ px: 1, sz: '1', n: 1 }], []] },
      '/levels/0/0/px',
      undefined,
    ],
    [
      'rejects a level with an unparsable size',
      { levels: [[{ px: '1', sz: 'abc', n: 1 }], []] },
      '/levels/0/0/sz',
      undefined,
    ],
    [
      'rejects a level with a negative price',
      { levels: [[{ px: '-1', sz: '1', n: 1 }], []] },
      '/levels/0/0/px',
      undefined,
    ],
    [
      'rejects a level with a negative size',
      { levels: [[{ px: '1', sz: '-1', n: 1 }], []] },
      '/levels/0/0/sz',
      undefined,
    ],
    [
      'rejects a non-safe level count',
      { levels: [[{ px: '1', sz: '1', n: 1.5 }], []] },
      '/levels/0/0/n',
      undefined,
    ],
    [
      'rejects a fill input that is not a plain object',
      null,
      '',
      (input: unknown) => simulateBookFill(input as never),
    ],
    [
      'rejects an invalid fill side',
      {
        ...twoSidedBook,
        side: 'hold',
        amount: { kind: 'size', value: '1' },
        referencePrice: '100',
      },
      '/side',
      (input: unknown) => simulateBookFill(input as never),
    ],
    [
      'rejects fill input with an invalid nested book',
      { levels: [[]], side: 'buy', amount: { kind: 'size', value: '1' }, referencePrice: '100' },
      '/levels',
      (input: unknown) => simulateBookFill(input as never),
    ],
    [
      'rejects a zero reference price',
      {
        ...twoSidedBook,
        side: 'buy',
        amount: { kind: 'size', value: '1' },
        referencePrice: '0',
      },
      '/referencePrice',
      (input: unknown) => simulateBookFill(input as never),
    ],
    [
      'rejects a non-plain amount',
      { ...twoSidedBook, side: 'buy', amount: [], referencePrice: '100' },
      '/amount',
      (input: unknown) => simulateBookFill(input as never),
    ],
    [
      'rejects a size amount with an extra field',
      {
        ...twoSidedBook,
        side: 'buy',
        amount: { kind: 'size', value: '1', szDecimals: 2 },
        referencePrice: '100',
      },
      '/amount',
      (input: unknown) => simulateBookFill(input as never),
    ],
    [
      'rejects a negative size amount',
      {
        ...twoSidedBook,
        side: 'buy',
        amount: { kind: 'size', value: '-1' },
        referencePrice: '100',
      },
      '/amount/value',
      (input: unknown) => simulateBookFill(input as never),
    ],
    [
      'rejects a notional amount with an invalid kind field',
      {
        ...twoSidedBook,
        side: 'buy',
        amount: { value: '1', szDecimals: 2 },
        referencePrice: '100',
      },
      '/amount/kind',
      (input: unknown) => simulateBookFill(input as never),
    ],
    [
      'rejects a notional amount with an extra field',
      {
        ...twoSidedBook,
        side: 'buy',
        amount: { kind: 'notional', value: '1', szDecimals: 2, extra: true },
        referencePrice: '100',
      },
      '/amount',
      (input: unknown) => simulateBookFill(input as never),
    ],
    [
      'rejects a notional amount with a negative value',
      {
        ...twoSidedBook,
        side: 'buy',
        amount: { kind: 'notional', value: '-1', szDecimals: 2 },
        referencePrice: '100',
      },
      '/amount/value',
      (input: unknown) => simulateBookFill(input as never),
    ],
    [
      'rejects a notional amount with negative size decimals',
      {
        ...twoSidedBook,
        side: 'buy',
        amount: { kind: 'notional', value: '1', szDecimals: -1 },
        referencePrice: '100',
      },
      '/amount/szDecimals',
      (input: unknown) => simulateBookFill(input as never),
    ],
    [
      'rejects a notional amount with fractional size decimals',
      {
        ...twoSidedBook,
        side: 'buy',
        amount: { kind: 'notional', value: '1', szDecimals: 1.5 },
        referencePrice: '100',
      },
      '/amount/szDecimals',
      (input: unknown) => simulateBookFill(input as never),
    ],
    [
      'rejects a notional amount with non-numeric size decimals',
      {
        ...twoSidedBook,
        side: 'buy',
        amount: { kind: 'notional', value: '1', szDecimals: '2' },
        referencePrice: '100',
      },
      '/amount/szDecimals',
      (input: unknown) => simulateBookFill(input as never),
    ],
  ] as const)('%s', (_name, input, path, call) => {
    const result = call === undefined ? calculateBookMetrics(input as never) : call(input as never)
    expectInvalidPath(result, path)
  })

  it('rejects an uninspectable object as invalid input shape', () => {
    expectInvalidPath(calculateBookMetrics(uninspectableObject() as never), '')
  })

  it('rejects an uninspectable array as invalid levels shape', () => {
    expectInvalidPath(calculateBookMetrics({ levels: uninspectableArray() } as never), '/levels')
  })
})

function objectWithAccessor(key: string) {
  const object: Record<string, unknown> = {}
  Object.defineProperty(object, key, {
    enumerable: true,
    get() {
      return 'not-data'
    },
  })
  return object
}

function levelWithAccessorPrice() {
  const level: Record<string, unknown> = { sz: '1', n: 1 }
  Object.defineProperty(level, 'px', {
    enumerable: true,
    get() {
      return '100'
    },
  })
  return level
}

function objectWithSymbolKey() {
  return { levels: [[], []], [Symbol('extra')]: true }
}

function nullPrototypeBook() {
  const book = Object.create(null) as { levels: [[], []] }
  book.levels = [[], []]
  return book
}

function manyLevels() {
  return Array.from({ length: 21 }, (_value, index) => ({ px: String(100 - index), sz: '1', n: 1 }))
}

function sparseLevelSide() {
  const side = new Array(1)
  return side
}

function nonEnumerableLevelSide() {
  const side = [{}]
  Object.defineProperty(side, '0', { value: {}, enumerable: false })
  return side
}

function arrayWithCustomKey() {
  const target = [{}]
  return new Proxy(target, {
    ownKeys() {
      return ['length', 'custom']
    },
    getOwnPropertyDescriptor(source, key) {
      if (key === '0') {
        return { configurable: true, enumerable: true, value: source[0], writable: true }
      }
      if (key === 'custom') {
        return { configurable: true, enumerable: true, value: true, writable: true }
      }
      return Reflect.getOwnPropertyDescriptor(source, key)
    },
  })
}

function uninspectableObject() {
  return new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error('boom')
      },
    },
  )
}

function uninspectableArray() {
  return new Proxy([], {
    getOwnPropertyDescriptor(_source, key) {
      if (key === 'length') throw new Error('boom')
      return undefined
    },
  })
}
