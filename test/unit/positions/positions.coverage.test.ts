import { describe, expect, it } from 'vitest'
import {
  calculatePerpBreakEvenPrice,
  calculatePerpUnrealizedPnl,
  projectPerpFill,
  projectPerpFillSequence,
} from '../../../src/positions/index.js'
import { fillInputs, sequenceInputs, unrealizedInputs } from '../../../src/positions/trace.js'
import {
  normalizeFill,
  normalizeFillArray,
  normalizePosition,
} from '../../../src/positions/validation.js'

describe('position public facade coverage', () => {
  it('returns invalid-input when unrealized pnl receives a bad mark price', () => {
    const result = calculatePerpUnrealizedPnl({
      position: { kind: 'open', signedSize: '1', entryPrice: '100' },
      markPrice: '0',
    })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'non-positive-decimal', path: '/markPrice' }],
    })
    expect(result.trace.completion).toEqual({
      status: 'incomplete',
      reason: { code: 'non-positive-decimal', path: '/markPrice' },
    })
  })

  it('returns invalid-input when unrealized pnl receives a malformed top-level object', () => {
    const result = calculatePerpUnrealizedPnl({ position: { kind: 'flat' } } as never)

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-input-shape', path: '' }],
    })
  })

  it('returns invalid-input when unrealized pnl receives a bad position', () => {
    const result = calculatePerpUnrealizedPnl({
      position: { kind: 'open', signedSize: '1', entryPrice: '0' },
      markPrice: '100',
    })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'non-positive-decimal', path: '/position/entryPrice' }],
    })
  })

  it('returns invalid-input when fill projection receives a bad fill side', () => {
    const result = projectPerpFill({
      position: { kind: 'flat' },
      fill: { side: 'hold', size: '1', price: '100', fee: { kind: 'none' } },
    } as never)

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-fill-side', path: '/fill/side' }],
    })
    expect(result.trace.formulaId).toBe('hl.positions.fill.project')
  })

  it('returns invalid-input when fill projection receives a malformed top-level object', () => {
    const result = projectPerpFill({ position: { kind: 'flat' } } as never)

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-input-shape', path: '' }],
    })
  })

  it('returns invalid-input when fill projection receives a bad position', () => {
    const result = projectPerpFill({
      position: { kind: 'open', signedSize: '0', entryPrice: '100' },
      fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
    })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'zero-open-position-size', path: '/position/signedSize' }],
    })
  })

  it('returns invalid-input when a fill sequence exceeds the official single-page cap', () => {
    const result = projectPerpFillSequence({
      position: { kind: 'flat' },
      fills: Array.from({ length: 2001 }, () => ({
        side: 'buy',
        size: '0',
        price: '100',
        fee: { kind: 'none' },
      })),
    })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [
        {
          code: 'invalid-input-shape',
          path: '/fills',
          expected: 'plain array with at most 2000 entries',
        },
      ],
    })
    expect(result.trace.formulaId).toBe('hl.positions.sequence.project')
  })

  it('returns invalid-input when a fill sequence receives a malformed top-level object', () => {
    const result = projectPerpFillSequence({ position: { kind: 'flat' } } as never)

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-input-shape', path: '' }],
    })
  })

  it('returns invalid-input when a fill sequence receives a bad position', () => {
    const result = projectPerpFillSequence({
      position: { kind: 'open', signedSize: 'abc', entryPrice: '100' },
      fills: [],
    })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ path: '/position/signedSize' }],
    })
  })

  it('normalizes a flat intermediate state during sequence projection', () => {
    const result = projectPerpFillSequence({
      position: { kind: 'open', signedSize: '1', entryPrice: '100' },
      fills: [
        { side: 'sell', size: '1', price: '101', fee: { kind: 'none' } },
        { side: 'buy', size: '2', price: '102', fee: { kind: 'none' } },
      ],
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        transitions: [{ classification: 'close' }, { classification: 'open' }],
        finalState: { kind: 'open', signedSize: '2', entryPrice: '102' },
      },
    })
  })

  it('returns invalid-input when break-even receives a malformed cumulative cost', () => {
    const result = calculatePerpBreakEvenPrice({
      position: { kind: 'open', signedSize: '1', entryPrice: '100' },
      cumulativeCost: 'abc',
    })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ path: '/cumulativeCost' }],
    })
    expect(result.trace.formulaId).toBe('hl.positions.break-even-price.calculate')
  })

  it('returns invalid-input when break-even receives a malformed top-level object', () => {
    const result = calculatePerpBreakEvenPrice({ position: { kind: 'flat' } } as never)

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'invalid-input-shape', path: '' }],
    })
  })

  it('returns invalid-input when break-even receives a bad position', () => {
    const result = calculatePerpBreakEvenPrice({
      position: { kind: 'open', signedSize: '1', entryPrice: '0' },
      cumulativeCost: '0',
    })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [{ code: 'non-positive-decimal', path: '/position/entryPrice' }],
    })
  })
})

describe('position trace helper coverage', () => {
  it('omits position when unrealized inputs receive no position', () => {
    expect(unrealizedInputs(undefined, '100')).toEqual({ markPrice: '100' })
  })

  it('omits mark price when unrealized inputs receive no mark price', () => {
    expect(unrealizedInputs({ kind: 'flat' }, undefined)).toEqual({ position: { kind: 'flat' } })
  })

  it('omits fill when fill inputs receive no fill', () => {
    expect(fillInputs({ kind: 'flat' }, undefined)).toEqual({ position: { kind: 'flat' } })
  })

  it('omits position when fill inputs receive no position', () => {
    expect(
      fillInputs(undefined, {
        side: 'buy',
        size: '1',
        sizeDecimal: 'decimal-not-used' as never,
        price: '100',
        priceDecimal: 'decimal-not-used' as never,
        fee: { kind: 'none' },
        feeAmountDecimal: 'decimal-not-used' as never,
      }),
    ).toEqual({
      fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
    })
  })

  it('omits fill count when sequence inputs receive no count', () => {
    expect(sequenceInputs({ kind: 'flat' }, undefined)).toEqual({ position: { kind: 'flat' } })
  })

  it('omits position when sequence inputs receive no position', () => {
    expect(sequenceInputs(undefined, 0)).toEqual({ fillCount: 0 })
  })
})

describe('position validation helper coverage', () => {
  it('rejects unsupported position kinds', () => {
    const result = normalizePosition({ kind: 'closed', signedSize: '1', entryPrice: '100' }, '/p')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-position-kind', path: '/p/kind' },
    })
  })

  it('rejects positions missing open-state fields', () => {
    const result = normalizePosition({ kind: 'open', signedSize: '1' }, '/p')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-input-shape', path: '/p' },
    })
  })

  it('rejects malformed signed position sizes', () => {
    const result = normalizePosition({ kind: 'open', signedSize: 'abc', entryPrice: '100' }, '/p')

    expect(result).toMatchObject({
      ok: false,
      issue: { path: '/p/signedSize' },
    })
  })

  it('rejects zero-sized open positions', () => {
    const result = normalizePosition({ kind: 'open', signedSize: '0', entryPrice: '100' }, '/p')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'zero-open-position-size', path: '/p/signedSize' },
    })
  })

  it('rejects non-positive entry prices', () => {
    const result = normalizePosition({ kind: 'open', signedSize: '1', entryPrice: '0' }, '/p')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'non-positive-decimal', path: '/p/entryPrice' },
    })
  })

  it('rejects primitive fee payloads', () => {
    const result = normalizeFill({ side: 'buy', size: '1', price: '100', fee: 'none' }, '/f')

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-fee-kind', path: '/f/fee/kind' },
    })
  })

  it('rejects unsupported object fee kinds', () => {
    const result = normalizeFill(
      { side: 'buy', size: '1', price: '100', fee: { kind: 'rebate' } },
      '/f',
    )

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-fee-kind', path: '/f/fee/kind' },
    })
  })

  it('rejects malformed explicit fee amounts', () => {
    const result = normalizeFill(
      { side: 'buy', size: '1', price: '100', fee: { kind: 'explicit', amount: 'abc' } },
      '/f',
    )

    expect(result).toMatchObject({
      ok: false,
      issue: { path: '/f/fee/amount' },
    })
  })

  it('rejects malformed rate fee values', () => {
    const result = normalizeFill(
      { side: 'buy', size: '1', price: '100', fee: { kind: 'rate', rate: 'abc' } },
      '/f',
    )

    expect(result).toMatchObject({
      ok: false,
      issue: { path: '/f/fee/rate' },
    })
  })

  it('rejects a non-zero explicit fee on a zero-size fill', () => {
    const result = normalizeFill(
      { side: 'buy', size: '0', price: '100', fee: { kind: 'explicit', amount: '5' } },
      '/f',
    )

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'non-zero-fee-for-zero-size', path: '/f/fee/amount' },
    })
  })

  it('normalizes zero-size rate fees to zero account cost', () => {
    const result = normalizeFill(
      { side: 'buy', size: '0', price: '100', fee: { kind: 'rate', rate: '0.01' } },
      '/f',
    )

    expect(result).toMatchObject({
      ok: true,
      fill: { fee: { kind: 'rate', rate: '0.01' } },
    })
    if (!result.ok) return
    expect(result.fill.feeAmountDecimal.toFixed()).toBe('0')
  })

  it('rejects negative fill sizes', () => {
    const result = normalizeFill(
      { side: 'buy', size: '-1', price: '100', fee: { kind: 'none' } },
      '/f',
    )

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'negative-decimal', path: '/f/size' },
    })
  })

  it('rejects non-positive fill prices', () => {
    const result = normalizeFill(
      { side: 'buy', size: '1', price: '0', fee: { kind: 'none' } },
      '/f',
    )

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'non-positive-decimal', path: '/f/price' },
    })
  })

  it('rejects invalid fill arrays at the first bad element', () => {
    const result = normalizeFillArray(
      [{ side: 'buy', size: '1', price: '100', fee: { kind: 'none' } }, 'bad-fill'],
      '/fills',
    )

    expect(result).toMatchObject({
      ok: false,
      issue: { code: 'invalid-input-shape', path: '/fills/1' },
    })
  })
})
