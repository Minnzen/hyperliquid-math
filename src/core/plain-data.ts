export function describePlainValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  try {
    return Array.isArray(value) ? 'array' : typeof value
  } catch {
    return 'uninspectable-object'
  }
}
