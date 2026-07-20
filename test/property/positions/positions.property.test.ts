import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  calculatePerpUnrealizedPnl,
  projectPerpFillSequence,
} from '../../../src/positions/index.js'

describe('position properties', () => {
  it('keeps equal favorable moves symmetric for long and short positions', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.bigInt({ min: 1_001n, max: 1_000_000n }),
        fc.bigInt({ min: 1n, max: 1_000n }),
        (size, entry, move) => {
          const long = calculatePerpUnrealizedPnl({
            position: {
              kind: 'open',
              signedSize: size.toString(),
              entryPrice: entry.toString(),
            },
            markPrice: (entry + move).toString(),
          })
          const short = calculatePerpUnrealizedPnl({
            position: {
              kind: 'open',
              signedSize: (-size).toString(),
              entryPrice: entry.toString(),
            },
            markPrice: (entry - move).toString(),
          })

          expect(long.value.status).toBe('ok')
          expect(short.value.status).toBe('ok')
          if (long.value.status !== 'ok' || short.value.status !== 'ok') return
          expect(long.value.data.unrealizedPnl).toBe(short.value.data.unrealizedPnl)
        },
      ),
    )
  })

  it('gives the same state when a same-price opening fill is split', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        (first, second, price) => {
          const split = projectPerpFillSequence({
            position: { kind: 'flat' },
            fills: [
              {
                side: 'buy',
                size: first.toString(),
                price: price.toString(),
                fee: { kind: 'none' },
              },
              {
                side: 'buy',
                size: second.toString(),
                price: price.toString(),
                fee: { kind: 'none' },
              },
            ],
          })
          const combined = projectPerpFillSequence({
            position: { kind: 'flat' },
            fills: [
              {
                side: 'buy',
                size: (first + second).toString(),
                price: price.toString(),
                fee: { kind: 'none' },
              },
            ],
          })

          expect(split.value.status).toBe('ok')
          expect(combined.value.status).toBe('ok')
          if (split.value.status !== 'ok' || combined.value.status !== 'ok') return
          expect(split.value.data.finalState).toEqual(combined.value.data.finalState)
          expect(split.value.data.closedPnlTotal).toBe(combined.value.data.closedPnlTotal)
        },
      ),
    )
  })
})
