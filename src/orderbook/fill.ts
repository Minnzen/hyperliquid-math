import { Decimal40 } from '../core/decimal.js'
import type { MathResult, RoundingDecision } from '../model/index.js'
import { fillTrace } from './trace.js'
import type { SimulateBookFillInput, SimulatedBookFill, SimulatedFill } from './types.js'
import { normalizeFillInput, reason } from './validation.js'

/**
 * Walks one frozen L2 snapshot best-to-worst to simulate a market-style fill, returning consumed
 * levels, filled size/notional, VWAP, worst price, and signed slippage vs `referencePrice`
 * (buy: `(vwap / ref - 1) * 10000`; sell: `(1 - vwap / ref) * 10000`).
 * Deterministic book arithmetic only — not a prediction of queue position or server fills; a zero
 * requested amount returns `not-applicable`, and missing depth shows up as `none`/`partial`.
 *
 * @public
 */
export function simulateBookFill(input: SimulateBookFillInput): MathResult<SimulatedBookFill> {
  const normalized = normalizeFillInput(input)
  if (!normalized.ok) {
    return {
      value: { status: 'invalid-input', issues: [normalized.issue] },
      trace: fillTrace(undefined, undefined, undefined, undefined, {
        status: 'incomplete',
        reason: reason(normalized.issue.code, normalized.issue.path),
      }),
    }
  }

  if (normalized.amount.decimal.isZero()) {
    return {
      value: {
        status: 'not-applicable',
        reason: reason('zero-fill-amount', '/amount/value'),
      },
      trace: fillTrace(
        normalized.book,
        normalized.side,
        normalized.amount,
        normalized.referencePrice,
        { status: 'complete' },
      ),
    }
  }

  const sideLevels =
    normalized.side === 'buy' ? normalized.book.levels[1] : normalized.book.levels[0]
  let remaining = normalized.amount.decimal
  let filledSize = new Decimal40(0)
  let filledNotional = new Decimal40(0)
  const fills: SimulatedFill[] = []
  const rounding: RoundingDecision[] = []

  for (const level of sideLevels) {
    if (remaining.isZero()) break

    if (normalized.amount.kind === 'size') {
      const size = Decimal40.min(remaining, level.szDecimal)
      const notional = size.mul(level.pxDecimal)
      fills.push({ px: level.px, sz: size.toFixed(), notional: notional.toFixed() })
      filledSize = filledSize.plus(size)
      filledNotional = filledNotional.plus(notional)
      remaining = remaining.minus(size)
      continue
    }

    const fullLevelNotional = level.pxDecimal.mul(level.szDecimal)
    if (remaining.gte(fullLevelNotional)) {
      fills.push({ px: level.px, sz: level.sz, notional: fullLevelNotional.toFixed() })
      filledSize = filledSize.plus(level.szDecimal)
      filledNotional = filledNotional.plus(fullLevelNotional)
      remaining = remaining.minus(fullLevelNotional)
      continue
    }

    const exactSize = remaining.div(level.pxDecimal)
    const roundedSize = exactSize.toDecimalPlaces(
      normalized.amount.szDecimals,
      Decimal40.ROUND_DOWN,
    )
    rounding.push({
      path: `/value/data/fills/${fills.length}/sz`,
      input: `${remaining.toFixed()}/${level.px}`,
      output: roundedSize.toFixed(),
      mode: 'down',
      reasonCode: 'notional-partial-size-quantization',
    })
    if (roundedSize.isZero()) break

    const notional = roundedSize.mul(level.pxDecimal)
    fills.push({ px: level.px, sz: roundedSize.toFixed(), notional: notional.toFixed() })
    filledSize = filledSize.plus(roundedSize)
    filledNotional = filledNotional.plus(notional)
    remaining = remaining.minus(notional)
    break
  }

  const unfilledAmount =
    normalized.amount.kind === 'size'
      ? normalized.amount.decimal.minus(filledSize)
      : normalized.amount.decimal.minus(filledNotional)
  const completion = filledSize.isZero() ? 'none' : unfilledAmount.isZero() ? 'full' : 'partial'
  const data: SimulatedBookFill = {
    completion,
    fills,
    filledSize: filledSize.toFixed(),
    filledNotional: filledNotional.toFixed(),
    unfilledAmount: unfilledAmount.toFixed(),
    ...(filledSize.isZero()
      ? {}
      : (() => {
          const vwap = filledNotional.div(filledSize)
          const slippage =
            normalized.side === 'buy'
              ? vwap.div(normalized.referenceDecimal).minus(1).mul(10000)
              : new Decimal40(1).minus(vwap.div(normalized.referenceDecimal)).mul(10000)
          rounding.push(
            {
              path: '/value/data/vwap',
              input: `${filledNotional.toFixed()}/${filledSize.toFixed()}`,
              output: vwap.toFixed(),
              mode: 'half-even',
              reasonCode: 'decimal40-division',
            },
            {
              path: '/value/data/slippageBps',
              input:
                normalized.side === 'buy'
                  ? `${vwap.toFixed()}/${normalized.referencePrice}-1*10000`
                  : `1-${vwap.toFixed()}/${normalized.referencePrice}*10000`,
              output: slippage.toFixed(),
              mode: 'half-even',
              reasonCode: 'decimal40-division',
            },
          )
          const worstFill = fills[fills.length - 1] as SimulatedFill
          return {
            vwap: vwap.toFixed(),
            worstPrice: worstFill.px,
            slippageBps: slippage.toFixed(),
          }
        })()),
  }

  return {
    value: { status: 'ok', data },
    trace: fillTrace(
      normalized.book,
      normalized.side,
      normalized.amount,
      normalized.referencePrice,
      { status: 'complete' },
      [
        {
          stepId: 'book-walk',
          inputs: {
            side: normalized.side,
            amountKind: normalized.amount.kind,
            amount: normalized.amount.value,
          },
          output: {
            fillCount: fills.length,
            filledSize: data.filledSize,
            filledNotional: data.filledNotional,
            unfilledAmount: data.unfilledAmount,
          },
        },
      ],
      rounding,
    ),
  }
}
