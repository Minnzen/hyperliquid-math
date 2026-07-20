import type { MathResult } from '../model/index.js'
import { metricsTrace } from './trace.js'
import type { BookMetrics, L2BookInput, NormalizedLevel } from './types.js'
import { normalizeBook, reason } from './validation.js'

/**
 * Computes top-of-book metrics from one frozen L2 snapshot: `mid = (bestBid + bestAsk) / 2`,
 * `spread = bestAsk - bestBid`, `spreadBps = spread / mid * 10000`.
 * Requires at least one bid and one ask; a valid one-sided or empty book returns `indeterminate`
 * (no last-trade fallback), and a locked/crossed book is `invalid-input`.
 *
 * @public
 */
export function calculateBookMetrics(input: L2BookInput): MathResult<BookMetrics> {
  const normalized = normalizeBook(input)
  if (!normalized.ok) {
    return {
      value: { status: 'invalid-input', issues: [normalized.issue] },
      trace: metricsTrace(undefined, {
        status: 'incomplete',
        reason: reason(normalized.issue.code, normalized.issue.path),
      }),
    }
  }

  const [bids, asks] = normalized.book.levels
  const missing = [
    ...(bids.length === 0 ? ['/levels/0'] : []),
    ...(asks.length === 0 ? ['/levels/1'] : []),
  ]
  if (missing.length > 0) {
    return {
      value: {
        status: 'indeterminate',
        reason: reason('two-sided-book-required', '/levels'),
        missing,
      },
      trace: metricsTrace(normalized.book, {
        status: 'incomplete',
        reason: reason('two-sided-book-required', '/levels'),
      }),
    }
  }

  const bestBid = bids[0] as NormalizedLevel
  const bestAsk = asks[0] as NormalizedLevel
  const mid = bestBid.pxDecimal.plus(bestAsk.pxDecimal).div(2)
  const spread = bestAsk.pxDecimal.minus(bestBid.pxDecimal)
  const spreadBps = spread.div(mid).mul(10000)
  const data = {
    bestBid: bestBid.px,
    bestAsk: bestAsk.px,
    mid: mid.toFixed(),
    spread: spread.toFixed(),
    spreadBps: spreadBps.toFixed(),
  }

  return {
    value: { status: 'ok', data },
    trace: metricsTrace(
      normalized.book,
      { status: 'complete' },
      [
        {
          stepId: 'mid',
          inputs: { bestBid: bestBid.px, bestAsk: bestAsk.px },
          output: data.mid,
        },
        {
          stepId: 'spread',
          inputs: { bestBid: bestBid.px, bestAsk: bestAsk.px },
          output: data.spread,
        },
        {
          stepId: 'spread-bps',
          inputs: { spread: data.spread, mid: data.mid },
          output: data.spreadBps,
        },
      ],
      [
        {
          path: '/value/data/mid',
          input: `(${bestBid.px}+${bestAsk.px})/2`,
          output: data.mid,
          mode: 'half-even',
          reasonCode: 'decimal40-division',
        },
        {
          path: '/value/data/spreadBps',
          input: `${data.spread}/${data.mid}*10000`,
          output: data.spreadBps,
          mode: 'half-even',
          reasonCode: 'decimal40-division',
        },
      ],
    ),
  }
}
