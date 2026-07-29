import type { JsonObject, JsonValue, MathIssue, MathReason } from '../model/index.js'
import { type Decimal40, type NormalizedDecimalString, normalizeDecimalString } from './decimal.js'
import { describePlainValue } from './plain-data.js'

export type ValidationIssue = MathIssue & { readonly path: string }

export function issue(
  code: string,
  path: string,
  actual: unknown,
  expected: string,
): ValidationIssue {
  return {
    code,
    path,
    actual: describePlainValue(actual),
    expected,
  }
}

export function reason(code: string, path: string): MathReason {
  return { code, path }
}

export function isPlainObject(input: unknown): input is Record<PropertyKey, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false

  const prototype = Object.getPrototypeOf(input) as object | null
  return prototype === Object.prototype || prototype === null
}

export function ownDataValue(input: object, key: string): unknown {
  return Reflect.getOwnPropertyDescriptor(input, key)?.value
}

export function exactPlainObject(
  input: unknown,
  keys: readonly string[],
  path: string,
):
  | { readonly ok: true; readonly object: Record<PropertyKey, unknown> }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  try {
    if (!isPlainObject(input)) {
      return {
        ok: false,
        issue: issue(
          'invalid-input-shape',
          path,
          input,
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
      const descriptor = Reflect.getOwnPropertyDescriptor(input, key)
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.enumerable !== true
      ) {
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
        value: descriptor.value,
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

export function exactPlainArray(
  input: unknown,
  path: string,
  options: { readonly exactLength?: number; readonly maxLength: number },
):
  | { readonly ok: true; readonly values: readonly unknown[] }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  try {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) {
      return {
        ok: false,
        issue: issue('invalid-input-shape', path, input, 'plain array'),
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
          'invalid-input-shape',
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
        issue: issue('invalid-input-shape', path, 'extra-or-missing-keys', 'dense plain array'),
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
            'invalid-input-shape',
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
        issue: issue('invalid-input-shape', path, 'custom-array-key', 'dense plain array'),
      }
    }

    return { ok: true, values }
  } catch {
    return {
      ok: false,
      issue: issue('invalid-input-shape', path, 'uninspectable-array', 'plain data array'),
    }
  }
}

export function optionalPlainObject(
  input: unknown,
  keys: readonly string[],
  path: string,
):
  | { readonly ok: true; readonly object: Record<PropertyKey, unknown> }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  try {
    if (!isPlainObject(input)) {
      return {
        ok: false,
        issue: issue(
          'invalid-input-shape',
          path,
          input,
          `plain object with keys ${keys.join(',')}`,
        ),
      }
    }
    const keySet = new Set(keys)
    const ownKeys = Reflect.ownKeys(input)
    if (ownKeys.some((key) => typeof key !== 'string' || !keySet.has(key))) {
      return {
        ok: false,
        issue: issue(
          'invalid-input-shape',
          path,
          ownKeys.map(String).sort().join(','),
          `plain object with keys ${keys.join(',')}`,
        ),
      }
    }
    const object: Record<PropertyKey, unknown> = {}
    for (const key of ownKeys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(input, key)
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.enumerable !== true
      ) {
        return {
          ok: false,
          issue: issue(
            'invalid-input-shape',
            `${path}/${String(key)}`,
            key,
            'enumerable own data field',
          ),
        }
      }
      Object.defineProperty(object, key, {
        value: descriptor.value,
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

export function normalizeJsonValue(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  if (input === null || typeof input === 'string' || typeof input === 'boolean') {
    return { ok: true, value: input }
  }
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) {
      return {
        ok: false,
        issue: issue('invalid-input-shape', path, input, 'safe integer JSON number'),
      }
    }
    return { ok: true, value: input }
  }
  if (Array.isArray(input)) {
    const array = exactPlainArray(input, path, { maxLength: 5000 })
    if (!array.ok) return array
    const values: JsonValue[] = []
    for (let index = 0; index < array.values.length; index += 1) {
      const value = normalizeJsonValue(array.values[index], `${path}/${index}`)
      if (!value.ok) return value
      values.push(value.value)
    }
    return { ok: true, value: values }
  }
  const object = normalizeJsonObject(input, path)
  if (!object.ok) return object
  return { ok: true, value: object.value }
}

export function normalizeJsonObject(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly value: JsonObject }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  try {
    if (!isPlainObject(input)) {
      return {
        ok: false,
        issue: issue('invalid-input-shape', path, input, 'JSON-compatible plain object'),
      }
    }
    const output: Record<string, JsonValue> = {}
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string') {
        return {
          ok: false,
          issue: issue('invalid-input-shape', path, String(key), 'string JSON object key'),
        }
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(input, key)
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.enumerable !== true
      ) {
        return {
          ok: false,
          issue: issue('invalid-input-shape', `${path}/${key}`, key, 'enumerable own data field'),
        }
      }
      const value = normalizeJsonValue(descriptor.value, `${path}/${key}`)
      if (!value.ok) return value
      Object.defineProperty(output, key, {
        value: value.value,
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return { ok: true, value: output }
  } catch {
    return {
      ok: false,
      issue: issue(
        'invalid-input-shape',
        path,
        'uninspectable-object',
        'JSON-compatible plain object',
      ),
    }
  }
}

export function normalizeMathReason(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly reason: MathReason }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = optionalPlainObject(input, ['code', 'path', 'details', 'sourceRefs'], path)
  if (!shape.ok) return shape
  const code = ownDataValue(shape.object, 'code')
  if (typeof code !== 'string' || code.length === 0) {
    return {
      ok: false,
      issue: issue('invalid-input-shape', `${path}/code`, code, 'non-empty string'),
    }
  }
  const normalized: {
    code: string
    path?: string
    details?: JsonObject
    sourceRefs?: readonly string[]
  } = { code }
  if (Object.hasOwn(shape.object, 'path')) {
    const reasonPath = ownDataValue(shape.object, 'path')
    if (typeof reasonPath !== 'string' || (reasonPath.length > 0 && !reasonPath.startsWith('/'))) {
      return {
        ok: false,
        issue: issue('invalid-input-shape', `${path}/path`, reasonPath, 'RFC 6901 JSON pointer'),
      }
    }
    normalized.path = reasonPath
  }
  if (Object.hasOwn(shape.object, 'details')) {
    const details = normalizeJsonObject(ownDataValue(shape.object, 'details'), `${path}/details`)
    if (!details.ok) return details
    normalized.details = details.value
  }
  if (Object.hasOwn(shape.object, 'sourceRefs')) {
    const sourceRefs = exactPlainArray(
      ownDataValue(shape.object, 'sourceRefs'),
      `${path}/sourceRefs`,
      {
        maxLength: 5000,
      },
    )
    if (!sourceRefs.ok) return sourceRefs
    const refs: string[] = []
    for (let index = 0; index < sourceRefs.values.length; index += 1) {
      const ref = sourceRefs.values[index]
      if (typeof ref !== 'string' || ref.length === 0) {
        return {
          ok: false,
          issue: issue(
            'invalid-input-shape',
            `${path}/sourceRefs/${index}`,
            ref,
            'non-empty string',
          ),
        }
      }
      refs.push(ref)
    }
    normalized.sourceRefs = refs
  }
  return { ok: true, reason: normalized }
}

export function normalizeDecimalAt(
  input: unknown,
  path: string,
  mode: 'signed' | 'non-negative' | 'positive',
):
  | {
      readonly ok: true
      readonly value: NormalizedDecimalString
      readonly decimal: InstanceType<typeof Decimal40>
    }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  if (typeof input !== 'string') {
    return {
      ok: false,
      issue: issue('invalid-decimal-string', path, input, 'plain decimal string'),
    }
  }

  const normalized = normalizeDecimalString(input)
  if (!normalized.ok) {
    return { ok: false, issue: { ...normalized.issue, path } }
  }

  const decimal = normalized.decimal
  if (mode === 'positive' && (decimal.isZero() || decimal.isNegative())) {
    return {
      ok: false,
      issue: issue('non-positive-decimal', path, normalized.value, 'positive decimal string'),
    }
  }
  if (mode === 'non-negative' && decimal.isNegative()) {
    return {
      ok: false,
      issue: issue('negative-decimal', path, normalized.value, 'non-negative decimal string'),
    }
  }

  return { ok: true, value: normalized.value, decimal }
}
