import { describe, expect, it } from 'vitest'
import {
  calculatePerpBreakEvenPrice,
  calculatePerpUnrealizedPnl,
  projectPerpFill,
  projectPerpFillSequence,
} from '../../../src/positions/index.js'

describe('calculatePerpUnrealizedPnl', () => {
  it('calculates long unrealized pnl from signed size and mark price', () => {
    expect(
      calculatePerpUnrealizedPnl({
        position: { kind: 'open', signedSize: '2', entryPrice: '100' },
        markPrice: '110',
      }),
    ).toMatchObject({
      value: {
        status: 'ok',
        data: {
          side: 'long',
          absoluteSize: '2',
          positionValue: '220',
          unrealizedPnl: '20',
        },
      },
      trace: {
        formulaId: 'hl.positions.unrealized-pnl.calculate',
        completion: { status: 'complete' },
        normalizedInputs: {
          position: { kind: 'open', signedSize: '2', entryPrice: '100' },
          markPrice: '110',
        },
      },
    })
  })

  it('returns not-applicable for a flat position', () => {
    const result = calculatePerpUnrealizedPnl({
      position: { kind: 'flat' },
      markPrice: '110',
    })

    expect(result.value).toEqual({
      status: 'not-applicable',
      reason: { code: 'flat-position', path: '/position' },
    })
    expect(result.trace.completion).toEqual({ status: 'complete' })
  })

  it('calculates short unrealized pnl with the signed-size formula', () => {
    expect(
      calculatePerpUnrealizedPnl({
        position: { kind: 'open', signedSize: '-2', entryPrice: '100' },
        markPrice: '90',
      }),
    ).toMatchObject({
      value: {
        status: 'ok',
        data: {
          side: 'short',
          absoluteSize: '2',
          positionValue: '180',
          unrealizedPnl: '20',
        },
      },
    })
  })
})

describe('projectPerpFill', () => {
  it('reduces an existing long and records gross realized pnl and fees', () => {
    expect(
      projectPerpFill({
        position: { kind: 'open', signedSize: '2', entryPrice: '100' },
        fill: {
          side: 'sell',
          size: '0.5',
          price: '110',
          fee: { kind: 'explicit', amount: '1' },
        },
      }),
    ).toMatchObject({
      value: {
        status: 'ok',
        data: {
          classification: 'reduce',
          closedSize: '0.5',
          openedSize: '0',
          previousState: { kind: 'open', signedSize: '2', entryPrice: '100' },
          nextState: { kind: 'open', signedSize: '1.5', entryPrice: '100' },
          grossRealizedPnl: '5',
          feeAmount: '1',
          feeAccountValueDelta: '-1',
          closedPnl: '4',
        },
      },
      trace: {
        formulaId: 'hl.positions.fill.project',
        completion: { status: 'complete' },
        normalizedInputs: {
          position: { kind: 'open', signedSize: '2', entryPrice: '100' },
          fill: {
            side: 'sell',
            size: '0.5',
            price: '110',
            fee: { kind: 'explicit', amount: '1' },
          },
        },
      },
    })
  })

  it('flips through flat and carries the remainder into the new direction', () => {
    expect(
      projectPerpFill({
        position: { kind: 'open', signedSize: '2', entryPrice: '100' },
        fill: {
          side: 'sell',
          size: '3',
          price: '100',
          fee: { kind: 'rate', rate: '0.01' },
        },
      }),
    ).toMatchObject({
      value: {
        status: 'ok',
        data: {
          classification: 'flip',
          closedSize: '2',
          openedSize: '1',
          previousState: { kind: 'open', signedSize: '2', entryPrice: '100' },
          nextState: { kind: 'open', signedSize: '-1', entryPrice: '100' },
          grossRealizedPnl: '0',
          feeAmount: '3',
          feeAccountValueDelta: '-3',
          closedPnl: '-3',
        },
      },
    })
  })

  it('treats a zero-size fill as an exact no-op', () => {
    expect(
      projectPerpFill({
        position: { kind: 'open', signedSize: '-2', entryPrice: '100' },
        fill: {
          side: 'buy',
          size: '0',
          price: '90',
          fee: { kind: 'none' },
        },
      }),
    ).toMatchObject({
      value: {
        status: 'ok',
        data: {
          classification: 'no-op',
          closedSize: '0',
          openedSize: '0',
          nextState: { kind: 'open', signedSize: '-2', entryPrice: '100' },
          grossRealizedPnl: '0',
          feeAmount: '0',
          closedPnl: '0',
        },
      },
    })
  })

  it('charges the full fill fee when opening a position', () => {
    expect(
      projectPerpFill({
        position: { kind: 'flat' },
        fill: {
          side: 'buy',
          size: '2',
          price: '100',
          fee: { kind: 'explicit', amount: '1' },
        },
      }),
    ).toMatchObject({
      value: {
        status: 'ok',
        data: {
          classification: 'open',
          nextState: { kind: 'open', signedSize: '2', entryPrice: '100' },
          grossRealizedPnl: '0',
          feeAmount: '1',
          feeAccountValueDelta: '-1',
          closedPnl: '-1',
        },
      },
    })
  })

  it('charges the full fill fee when increasing a position', () => {
    const result = projectPerpFill({
      position: { kind: 'open', signedSize: '2', entryPrice: '100' },
      fill: {
        side: 'buy',
        size: '2',
        price: '104',
        fee: { kind: 'explicit', amount: '1' },
      },
    })

    expect(result).toMatchObject({
      value: {
        status: 'ok',
        data: {
          classification: 'increase',
          nextState: { kind: 'open', signedSize: '4', entryPrice: '102' },
          grossRealizedPnl: '0',
          feeAmount: '1',
          feeAccountValueDelta: '-1',
          closedPnl: '-1',
        },
      },
    })
    expect(result.trace.rounding).toEqual([
      expect.objectContaining({
        path: '/value/data/nextState/entryPrice',
        mode: 'half-even',
        reasonCode: 'decimal40-division',
      }),
    ])
  })

  it('opens a position with the fill price as entry', () => {
    const opened = projectPerpFill({
      position: { kind: 'flat' },
      fill: { side: 'buy', size: '2', price: '100', fee: { kind: 'none' } },
    })
    expect(opened).toMatchObject({
      value: {
        status: 'ok',
        data: {
          classification: 'open',
          nextState: { kind: 'open', signedSize: '2', entryPrice: '100' },
        },
      },
    })
  })

  it('uses a size-weighted entry when increasing a position', () => {
    const increased = projectPerpFill({
      position: { kind: 'open', signedSize: '2', entryPrice: '100' },
      fill: { side: 'buy', size: '2', price: '104', fee: { kind: 'none' } },
    })
    expect(increased).toMatchObject({
      value: {
        status: 'ok',
        data: {
          classification: 'increase',
          nextState: { kind: 'open', signedSize: '4', entryPrice: '102' },
        },
      },
    })
  })

  it('kills a simple-average entry mutant with unequal position and fill sizes', () => {
    const increased = projectPerpFill({
      position: { kind: 'open', signedSize: '5', entryPrice: '100' },
      fill: { side: 'buy', size: '1', price: '160', fee: { kind: 'none' } },
    })
    const sequence = projectPerpFillSequence({
      position: { kind: 'open', signedSize: '5', entryPrice: '100' },
      fills: [{ side: 'buy', size: '1', price: '160', fee: { kind: 'none' } }],
    })

    expect(increased).toMatchObject({
      value: {
        status: 'ok',
        data: { nextState: { kind: 'open', signedSize: '6', entryPrice: '110' } },
      },
    })
    expect(sequence).toMatchObject({
      value: {
        status: 'ok',
        data: { finalState: { kind: 'open', signedSize: '6', entryPrice: '110' } },
      },
    })
    expect(increased).not.toMatchObject({
      value: { data: { nextState: { entryPrice: '130' } } },
    })
  })

  it('closes a position when the opposing fill exactly matches its size', () => {
    const closed = projectPerpFill({
      position: { kind: 'open', signedSize: '-2', entryPrice: '100' },
      fill: { side: 'buy', size: '2', price: '90', fee: { kind: 'none' } },
    })
    expect(closed).toMatchObject({
      value: {
        status: 'ok',
        data: {
          classification: 'close',
          nextState: { kind: 'flat' },
          grossRealizedPnl: '20',
        },
      },
    })
  })
})

describe('projectPerpFillSequence', () => {
  it('projects fills in array order and aggregates totals', () => {
    expect(
      projectPerpFillSequence({
        position: { kind: 'flat' },
        fills: [
          {
            side: 'buy',
            size: '2',
            price: '100',
            fee: { kind: 'none' },
          },
          {
            side: 'buy',
            size: '2',
            price: '104',
            fee: { kind: 'none' },
          },
          {
            side: 'sell',
            size: '1',
            price: '110',
            fee: { kind: 'explicit', amount: '1' },
          },
        ],
      }),
    ).toMatchObject({
      value: {
        status: 'ok',
        data: {
          transitions: [expect.any(Object), expect.any(Object), expect.any(Object)],
          finalState: { kind: 'open', signedSize: '3', entryPrice: '102' },
          grossRealizedPnlTotal: '8',
          feeAmountTotal: '1',
          feeAccountValueDeltaTotal: '-1',
          closedPnlTotal: '7',
        },
      },
      trace: {
        formulaId: 'hl.positions.sequence.project',
        completion: { status: 'complete' },
        normalizedInputs: {
          position: { kind: 'flat' },
          fillCount: 3,
        },
      },
    })
  })
})

describe('calculatePerpBreakEvenPrice', () => {
  it('returns not-applicable for flat positions', () => {
    const result = calculatePerpBreakEvenPrice({
      position: { kind: 'flat' },
      cumulativeCost: '0',
    })

    expect(result.value).toEqual({
      status: 'not-applicable',
      reason: { code: 'flat-position', path: '/position' },
    })
    expect(result.trace.completion).toEqual({ status: 'complete' })
    expect(result.trace.rounding).toEqual([])
  })

  it('returns indeterminate when the break-even price would not be positive', () => {
    const result = calculatePerpBreakEvenPrice({
      position: { kind: 'open', signedSize: '-1', entryPrice: '10' },
      cumulativeCost: '20',
    })

    expect(result.value).toEqual({
      status: 'indeterminate',
      reason: { code: 'no-positive-break-even-price', path: '/cumulativeCost' },
    })
    expect(result.trace.completion).toEqual({ status: 'complete' })
    expect(result.trace.rounding).toEqual([
      expect.objectContaining({
        path: '/trace/intermediates/breakEvenPrice',
        input: '20/-1',
        mode: 'half-even',
      }),
    ])
  })

  it('computes the exact break-even price for an open long', () => {
    expect(
      calculatePerpBreakEvenPrice({
        position: { kind: 'open', signedSize: '2', entryPrice: '100' },
        cumulativeCost: '10',
      }),
    ).toMatchObject({
      value: {
        status: 'ok',
        data: { breakEvenPrice: '105' },
      },
    })
  })
})

describe('position trace assumptions', () => {
  it('records the frozen mark used for unrealized PnL', () => {
    const result = calculatePerpUnrealizedPnl({
      position: { kind: 'open', signedSize: '1', entryPrice: '100' },
      markPrice: '110',
    })

    expect(result.trace.assumptions).toEqual([
      {
        kind: 'frozen-input',
        path: '/markPrice',
        value: 'caller-provided-frozen-mark-price',
      },
    ])
  })

  it('records the explicit fill model and server-display boundary', () => {
    const result = projectPerpFill({
      position: { kind: 'flat' },
      fill: { side: 'buy', size: '1', price: '100', fee: { kind: 'none' } },
    })

    expect(result.trace.assumptions).toEqual([
      {
        kind: 'fill-model',
        model: 'explicit-partial',
        parameters: {
          source: 'caller-provided-fill',
          feeConvention: 'positive-user-cost',
          serverDisplayFields: 'not-replayed',
        },
      },
    ])
  })

  it('records caller ordering and external pagination for fill sequences', () => {
    const result = projectPerpFillSequence({
      position: { kind: 'flat' },
      fills: [],
    })

    expect(result.trace.assumptions).toEqual([
      {
        kind: 'fill-model',
        model: 'explicit-sequence',
        parameters: {
          order: 'caller-provided',
          pagination: 'external',
          truncation: 'none',
        },
      },
    ])
  })

  it('records the fixed position and caller-bounded costs used by break-even', () => {
    const result = calculatePerpBreakEvenPrice({
      position: { kind: 'open', signedSize: '1', entryPrice: '100' },
      cumulativeCost: '1',
    })

    expect(result.trace.assumptions).toEqual([
      { kind: 'frozen-input', path: '/position', value: 'size-and-entry-fixed' },
      {
        kind: 'frozen-input',
        path: '/cumulativeCost',
        value: 'caller-provided-costs-only-future-costs-excluded',
      },
    ])
  })
})
