import { describe, expect, it } from 'vitest'
import {
  calculateBookMetrics,
  canonicalizeDecimalString,
  decodeAssetId,
  deriveCanonicalAssetKey,
  encodeAssetId,
  quantizePrice,
  quantizeSize,
  simulateBookFill,
} from '../../src/index.js'

function throwingStringValue() {
  return {
    toString() {
      throw new Error('must not invoke input coercion')
    },
  }
}

describe('M1 public facade safety', () => {
  it.each([
    ['canonicalizeDecimalString', canonicalizeDecimalString],
    ['quantizePrice', quantizePrice],
    ['quantizeSize', quantizeSize],
    ['deriveCanonicalAssetKey', deriveCanonicalAssetKey],
    ['encodeAssetId', encodeAssetId],
    ['decodeAssetId', decodeAssetId],
    ['calculateBookMetrics', calculateBookMetrics],
    ['simulateBookFill', simulateBookFill],
  ] as const)('%s rejects a revoked root proxy without throwing', (_name, facade) => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()

    expect(() => (facade as (input: unknown) => unknown)(proxy)).not.toThrow()
    const result = (facade as (input: unknown) => { value: { status: string } })(proxy)
    expect(result.value.status).toBe('invalid-input')
  })

  it('keeps invalid orderbook traces assumption-free', () => {
    const results = [calculateBookMetrics(null as never), simulateBookFill(null as never)]

    for (const result of results) {
      expect(result.trace.completion.status).toBe('incomplete')
      expect(result.trace.assumptions).toEqual([])
    }
  })

  it('turns hostile enum/discriminator values into invalid input without coercing them', () => {
    expect(() =>
      quantizePrice({
        value: '1',
        marketKind: throwingStringValue(),
        szDecimals: 2,
        rounding: 'down',
      } as never),
    ).not.toThrow()
    expect(() => encodeAssetId({ kind: throwingStringValue(), index: 0 } as never)).not.toThrow()
    expect(() =>
      simulateBookFill({
        levels: [[], []],
        side: throwingStringValue(),
        amount: { kind: 'size', value: '1' },
        referencePrice: '1',
      } as never),
    ).not.toThrow()
  })

  it('rejects a dex name that cannot be encoded as well-formed UTF-8', () => {
    expect(() =>
      deriveCanonicalAssetKey({
        network: 'mainnet',
        marketKind: 'perp',
        dex: '\ud800',
        index: 0,
      }),
    ).not.toThrow()
    expect(
      deriveCanonicalAssetKey({
        network: 'mainnet',
        marketKind: 'perp',
        dex: '\ud800',
        index: 0,
      }).value.status,
    ).toBe('invalid-input')
  })

  it('rejects trapping nested amount objects without leaking proxy errors', () => {
    const amount = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('trap')
        },
      },
    )

    expect(() =>
      simulateBookFill({
        levels: [[], []],
        side: 'buy',
        amount,
        referencePrice: '1',
      } as never),
    ).not.toThrow()

    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    expect(() =>
      simulateBookFill({
        levels: [[], []],
        side: 'buy',
        amount: proxy,
        referencePrice: '1',
      } as never),
    ).not.toThrow()
  })

  it('rejects L2 array accessors without invoking them', () => {
    let reads = 0
    const bids: unknown[] = []
    Object.defineProperty(bids, '0', {
      enumerable: true,
      get() {
        reads += 1
        return { px: '1', sz: '1', n: 1 }
      },
    })

    const result = calculateBookMetrics({ levels: [bids, []] } as never)

    expect(result.value.status).toBe('invalid-input')
    expect(reads).toBe(0)
  })

  it('rejects L2 arrays with custom properties or prototypes', () => {
    const bids = [{ px: '1', sz: '1', n: 1 }]
    Object.defineProperty(bids, 'extra', { enumerable: true, value: true })
    expect(calculateBookMetrics({ levels: [bids, []] }).value.status).toBe('invalid-input')

    const custom = [{ px: '1', sz: '1', n: 1 }]
    Object.setPrototypeOf(custom, null)
    expect(calculateBookMetrics({ levels: [custom, []] }).value.status).toBe('invalid-input')
  })

  it('does not coerce hostile nested numeric fields', () => {
    expect(() =>
      calculateBookMetrics({
        levels: [[{ px: '1', sz: '1', n: throwingStringValue() }], []],
      } as never),
    ).not.toThrow()
    expect(() =>
      simulateBookFill({
        levels: [[], []],
        side: 'buy',
        amount: { kind: 'notional', value: '1', szDecimals: throwingStringValue() },
        referencePrice: '1',
      } as never),
    ).not.toThrow()
  })
})
