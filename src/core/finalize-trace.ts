import type { CalculationTrace } from '../model/index.js'

function immutableSnapshot<T>(value: T, seen: WeakMap<object, unknown>): T {
  if (value === null || typeof value !== 'object') return value

  const existing = seen.get(value)
  if (existing !== undefined) return existing as T

  const copy: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : {}
  seen.set(value, copy)

  for (const [key, child] of Object.entries(value)) {
    ;(copy as Record<string, unknown>)[key] = immutableSnapshot(child, seen)
  }

  return Object.freeze(copy) as T
}

export function finalizeTrace(trace: CalculationTrace): CalculationTrace {
  return immutableSnapshot(trace, new WeakMap())
}
