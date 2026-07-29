import { normalizeDecimalString } from '../core/decimal.js'
import { describePlainValue } from '../core/plain-data.js'
import type { MathIssue, MathReason } from '../model/index.js'
import type {
  DecimalValue,
  FillSide,
  NormalizedAmount,
  NormalizedBook,
  NormalizedLevel,
} from './types.js'

type OrderbookIssue = MathIssue & { readonly path: string }

export function issue(
  code: string,
  path: string,
  actual: string,
  expected: string,
): OrderbookIssue {
  return { code, path, actual, expected }
}

export function reason(code: string, path: string): MathReason {
  return { code, path }
}

function isPlainObject(input: unknown): input is Record<PropertyKey, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false

  const prototype = Object.getPrototypeOf(input) as object | null
  return prototype === Object.prototype || prototype === null
}

function ownDataField(
  input: object,
  key: string,
):
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false
    } {
  const descriptor = Reflect.getOwnPropertyDescriptor(input, key)
  if (
    descriptor === undefined ||
    !Object.hasOwn(descriptor, 'value') ||
    descriptor.enumerable !== true
  ) {
    return { ok: false }
  }

  return { ok: true, value: descriptor.value }
}

function ownDataValue(input: object, key: string): unknown {
  return Reflect.getOwnPropertyDescriptor(input, key)?.value
}

function exactPlainObject(
  input: unknown,
  keys: readonly string[],
  path: string,
):
  | { readonly ok: true; readonly object: Record<PropertyKey, unknown> }
  | {
      readonly ok: false
      readonly issue: OrderbookIssue
    } {
  try {
    if (!isPlainObject(input)) {
      return {
        ok: false,
        issue: issue(
          'invalid-input-shape',
          path,
          describePlainValue(input),
          `plain object with exactly keys ${keys.join(',')}`,
        ),
      }
    }

    const ownKeys = Reflect.ownKeys(input)
    const keySet = new Set(keys)
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !keySet.has(key))
    ) {
      return {
        ok: false,
        issue: issue(
          'invalid-input-shape',
          path,
          ownKeys.map(String).sort().join(','),
          `plain object with exactly keys ${keys.join(',')}`,
        ),
      }
    }

    const object: Record<PropertyKey, unknown> = {}
    for (const key of keys) {
      const field = ownDataField(input, key)
      if (!field.ok) {
        return {
          ok: false,
          issue: issue(
            'invalid-input-shape',
            path === '' ? `/${key}` : `${path}/${key}`,
            key,
            'enumerable own data field',
          ),
        }
      }
      Object.defineProperty(object, key, {
        value: field.value,
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }

    return { ok: true, object }
  } catch {
    return {
      ok: false,
      issue: issue('invalid-input-shape', path, 'uninspectable-object', 'plain data object'),
    }
  }
}

function exactPlainArray(
  input: unknown,
  path: string,
  options: { readonly exactLength?: number; readonly maxLength: number },
):
  | { readonly ok: true; readonly values: readonly unknown[] }
  | { readonly ok: false; readonly issue: OrderbookIssue } {
  try {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) {
      return {
        ok: false,
        issue: issue('invalid-levels-shape', path, describePlainValue(input), 'plain array'),
      }
    }

    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(input, 'length')
    const length = lengthDescriptor?.value
    if (
      lengthDescriptor === undefined ||
      !Object.hasOwn(lengthDescriptor, 'value') ||
      lengthDescriptor.enumerable !== false ||
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > options.maxLength ||
      (options.exactLength !== undefined && length !== options.exactLength)
    ) {
      return {
        ok: false,
        issue: issue(
          'invalid-levels-shape',
          path,
          describePlainValue(length),
          options.exactLength === undefined
            ? `plain array with at most ${options.maxLength} entries`
            : `plain array with exactly ${options.exactLength} entries`,
        ),
      }
    }

    const ownKeys = Reflect.ownKeys(input)
    if (ownKeys.length !== length + 1) {
      return {
        ok: false,
        issue: issue('invalid-levels-shape', path, 'extra-or-missing-keys', 'dense plain array'),
      }
    }

    const values: unknown[] = []
    for (let index = 0; index < length; index += 1) {
      const key = String(index)
      const descriptor = Reflect.getOwnPropertyDescriptor(input, key)
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.enumerable !== true
      ) {
        return {
          ok: false,
          issue: issue(
            'invalid-levels-shape',
            `${path}/${index}`,
            key,
            'dense enumerable own data entry',
          ),
        }
      }
      values.push(descriptor.value)
    }

    if (ownKeys.some((key) => key !== 'length' && !/^\d+$/.test(String(key)))) {
      return {
        ok: false,
        issue: issue('invalid-levels-shape', path, 'custom-array-key', 'dense plain array'),
      }
    }

    return { ok: true, values }
  } catch {
    return {
      ok: false,
      issue: issue('invalid-levels-shape', path, 'uninspectable-array', 'plain data array'),
    }
  }
}

function normalizeDecimalAt(
  input: unknown,
  path: string,
  allowZero: boolean,
):
  | { readonly ok: true; readonly value: string; readonly decimal: DecimalValue }
  | {
      readonly ok: false
      readonly issue: OrderbookIssue
    } {
  if (typeof input !== 'string') {
    return {
      ok: false,
      issue: issue('invalid-decimal-string', path, typeof input, 'plain decimal string'),
    }
  }

  const normalized = normalizeDecimalString(input)
  if (!normalized.ok) {
    return { ok: false, issue: { ...normalized.issue, path } }
  }

  if (normalized.decimal.isNegative() || (!allowZero && normalized.decimal.isZero())) {
    return {
      ok: false,
      issue: issue(
        allowZero ? 'negative-decimal' : 'non-positive-decimal',
        path,
        normalized.value,
        allowZero ? 'non-negative decimal string' : 'positive decimal string',
      ),
    }
  }

  return { ok: true, value: normalized.value, decimal: normalized.decimal }
}

function normalizeLevel(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly level: NormalizedLevel }
  | {
      readonly ok: false
      readonly issue: OrderbookIssue
    } {
  const shape = exactPlainObject(input, ['px', 'sz', 'n'], path)
  if (!shape.ok) return shape

  const px = normalizeDecimalAt(ownDataValue(shape.object, 'px'), `${path}/px`, false)
  if (!px.ok) return px

  const sz = normalizeDecimalAt(ownDataValue(shape.object, 'sz'), `${path}/sz`, false)
  if (!sz.ok) return sz

  const n = ownDataValue(shape.object, 'n')
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) {
    return {
      ok: false,
      issue: issue(
        'invalid-level-count',
        `${path}/n`,
        describePlainValue(n),
        'positive safe integer',
      ),
    }
  }

  return {
    ok: true,
    level: { px: px.value, sz: sz.value, n, pxDecimal: px.decimal, szDecimal: sz.decimal },
  }
}

export function normalizeBook(input: unknown):
  | { readonly ok: true; readonly book: NormalizedBook }
  | {
      readonly ok: false
      readonly issue: OrderbookIssue
    } {
  const shape = exactPlainObject(input, ['levels'], '')
  if (!shape.ok) return shape

  const levelsValue = ownDataValue(shape.object, 'levels')
  const levelSides = exactPlainArray(levelsValue, '/levels', { exactLength: 2, maxLength: 2 })
  if (!levelSides.ok) return levelSides

  const sides: [NormalizedLevel[], NormalizedLevel[]] = [[], []]
  for (const sideIndex of [0, 1] as const) {
    const side = exactPlainArray(levelSides.values[sideIndex], `/levels/${sideIndex}`, {
      maxLength: 20,
    })
    if (!side.ok) return side

    const normalizedSide = sides[sideIndex]
    let previous: DecimalValue | undefined
    for (let levelIndex = 0; levelIndex < side.values.length; levelIndex += 1) {
      const normalized = normalizeLevel(
        side.values[levelIndex],
        `/levels/${sideIndex}/${levelIndex}`,
      )
      if (!normalized.ok) return normalized

      if (previous !== undefined) {
        const ordered =
          sideIndex === 0
            ? normalized.level.pxDecimal.lt(previous)
            : normalized.level.pxDecimal.gt(previous)
        if (!ordered) {
          return {
            ok: false,
            issue: issue(
              'invalid-book-ordering',
              `/levels/${sideIndex}/${levelIndex}/px`,
              normalized.level.px,
              sideIndex === 0 ? 'strictly descending bid prices' : 'strictly ascending ask prices',
            ),
          }
        }
      }

      previous = normalized.level.pxDecimal
      normalizedSide.push(normalized.level)
    }
  }

  const bestBid = sides[0][0]
  const bestAsk = sides[1][0]
  if (bestBid !== undefined && bestAsk !== undefined && bestBid.pxDecimal.gte(bestAsk.pxDecimal)) {
    return {
      ok: false,
      issue: issue(
        'locked-or-crossed-book',
        '/levels',
        `${bestBid.px}/${bestAsk.px}`,
        'best bid strictly below best ask',
      ),
    }
  }

  return { ok: true, book: { levels: [sides[0], sides[1]] } }
}

export function normalizeFillInput(input: unknown):
  | {
      readonly ok: true
      readonly book: NormalizedBook
      readonly side: FillSide
      readonly amount: NormalizedAmount
      readonly referencePrice: string
      readonly referenceDecimal: DecimalValue
    }
  | {
      readonly ok: false
      readonly issue: OrderbookIssue
    } {
  const shape = exactPlainObject(input, ['levels', 'side', 'amount', 'referencePrice'], '')
  if (!shape.ok) return shape

  const book = normalizeBook({ levels: ownDataValue(shape.object, 'levels') })
  if (!book.ok) return book

  const side = ownDataValue(shape.object, 'side')
  if (side !== 'buy' && side !== 'sell') {
    return {
      ok: false,
      issue: issue('invalid-fill-side', '/side', describePlainValue(side), 'buy or sell'),
    }
  }

  const reference = normalizeDecimalAt(
    ownDataValue(shape.object, 'referencePrice'),
    '/referencePrice',
    false,
  )
  if (!reference.ok) return reference

  const amountValue = ownDataValue(shape.object, 'amount')
  let amountIsPlain = false
  try {
    amountIsPlain = isPlainObject(amountValue)
  } catch {
    amountIsPlain = false
  }
  if (!amountIsPlain) {
    return {
      ok: false,
      issue: issue(
        'invalid-amount-shape',
        '/amount',
        describePlainValue(amountValue),
        'plain amount object',
      ),
    }
  }

  const amountObject = amountValue as Record<PropertyKey, unknown>
  const kindField = ownDataField(amountObject, 'kind')
  const kind = kindField.ok ? kindField.value : undefined
  if (kind === 'size') {
    const amountShape = exactPlainObject(amountObject, ['kind', 'value'], '/amount')
    if (!amountShape.ok) return amountShape
    const amount = normalizeDecimalAt(
      ownDataValue(amountShape.object, 'value'),
      '/amount/value',
      true,
    )
    if (!amount.ok) return amount
    return {
      ok: true,
      book: book.book,
      side,
      amount: { kind: 'size', value: amount.value, decimal: amount.decimal },
      referencePrice: reference.value,
      referenceDecimal: reference.decimal,
    }
  }

  if (kind === 'notional') {
    const amountShape = exactPlainObject(amountObject, ['kind', 'value', 'szDecimals'], '/amount')
    if (!amountShape.ok) return amountShape
    const amount = normalizeDecimalAt(
      ownDataValue(amountShape.object, 'value'),
      '/amount/value',
      true,
    )
    if (!amount.ok) return amount
    const szDecimals = ownDataValue(amountShape.object, 'szDecimals')
    if (
      typeof szDecimals !== 'number' ||
      !Number.isSafeInteger(szDecimals) ||
      szDecimals < 0 ||
      szDecimals > 8
    ) {
      return {
        ok: false,
        issue: issue(
          'invalid-size-decimals',
          '/amount/szDecimals',
          describePlainValue(szDecimals),
          'safe integer between 0 and 8',
        ),
      }
    }
    return {
      ok: true,
      book: book.book,
      side,
      amount: { kind: 'notional', value: amount.value, decimal: amount.decimal, szDecimals },
      referencePrice: reference.value,
      referenceDecimal: reference.decimal,
    }
  }

  return {
    ok: false,
    issue: issue(
      'invalid-amount-kind',
      '/amount/kind',
      describePlainValue(kind),
      'size or notional',
    ),
  }
}
