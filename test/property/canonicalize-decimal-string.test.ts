import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { canonicalizeDecimalString } from '../../src/precision/index.js'

describe('canonical decimal properties', () => {
  it('is idempotent for generated plain decimals', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 0, max: 999_999 }),
        (whole, fraction) => {
          const input = `${whole}.${fraction.toString().padStart(6, '0')}`
          const first = canonicalizeDecimalString({ value: input })
          expect(first.value.status).toBe('ok')
          if (first.value.status !== 'ok') return
          const second = canonicalizeDecimalString({ value: first.value.data })
          expect(second.value).toEqual(first.value)
        },
      ),
      { numRuns: 1_000 },
    )
  })
})
