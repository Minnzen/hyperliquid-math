import { describePlainValue } from '../core/plain-data.js'
import type { MathIssue } from '../model/index.js'

export type ShapeResult<T> =
  | { readonly ok: true; readonly descriptors: Readonly<Record<keyof T, PropertyDescriptor>> }
  | { readonly ok: false; readonly issue: MathIssue }

function invalidInputShape(actual: string, expected: string): ShapeResult<never> {
  return {
    ok: false,
    issue: {
      code: 'invalid-input-shape',
      path: '',
      actual,
      expected,
    },
  }
}

export function normalizePlainShape<T extends object>(
  input: unknown,
  keys: readonly (keyof T & string)[],
  expected: string,
): ShapeResult<T> {
  if (typeof input !== 'object' || input === null) {
    return invalidInputShape(describePlainValue(input), expected)
  }

  try {
    if (Array.isArray(input)) return invalidInputShape('array', expected)

    const prototype = Object.getPrototypeOf(input) as object | null
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidInputShape('non-plain-object', expected)
    }

    const ownKeys = Reflect.ownKeys(input)
    const sortedActualKeys = ownKeys
      .map((key) => String(key))
      .sort()
      .join(',')

    if (ownKeys.length !== keys.length || keys.some((key) => !Object.hasOwn(input, key))) {
      return invalidInputShape(sortedActualKeys, expected)
    }

    const descriptors = {} as Record<keyof T, PropertyDescriptor>
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(input, key)
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.enumerable !== true
      ) {
        return invalidInputShape(key, expected)
      }
      descriptors[key] = descriptor
    }

    return { ok: true, descriptors }
  } catch {
    return invalidInputShape('uninspectable-object', expected)
  }
}

export function issue(code: string, path: string, actual: unknown, expected: string): MathIssue {
  return {
    code,
    path,
    actual: describePlainValue(actual),
    expected,
  }
}
