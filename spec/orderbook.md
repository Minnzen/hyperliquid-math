# Orderbook Contract

Status: M1 verified
Last verified: 2026-07-19

Official sources: `HL.DOC.INFO.L2BOOK.2026-07-19`, `HL.DOC.WS.L2BOOK.2026-07-19`

Hyperliquid documents the L2 schema but does not publish generic mid, spread, VWAP, or slippage
formulas. The formulas below are Math-owned `local-exact` calculations over one explicit frozen
snapshot; they do not predict queue position, latency, or submitted-order fills.

## Normalized L2 snapshot

- Public snapshot input is `{ levels: [bids, asks] }`.
- `levels`, bids, and asks are dense plain arrays with own data entries; each side contains at most
  the official snapshot maximum of 20 levels. Accessors, sparse arrays, custom keys/prototypes, and
  longer sides are invalid input.
- Every level is exactly `{ px, sz, n }`, with positive decimal-string `px`/`sz` and positive safe
  integer `n`.
- Bids are strictly descending by price; asks are strictly ascending. Duplicate levels are invalid.
- As a Math-owned structural invariant, if both sides exist, best bid must be strictly below best ask.
  Hyperliquid documents the schema but not this validation rule; it is imposed so a normalized frozen
  snapshot cannot silently encode a locked/crossed state. Live fixtures provide only observational
  support for the invariant.
- Response spelling such as trailing zeroes is normalized before calculation. No protocol rounding is
  applied to a recorded level.

## `hl.orderbook.metrics` v1

Source ID: `HLM.SPEC.ORDERBOOK.METRICS.V1`

- Requires at least one bid and one ask. A structurally valid one-sided/empty book returns
  `indeterminate` with explicit missing paths; it does not copy the `allMids` last-trade fallback.
- `bestBid = bids[0].px`; `bestAsk = asks[0].px`.
- `mid = (bestBid + bestAsk) / 2`.
- `spread = bestAsk - bestBid`.
- `spreadBps = spread / mid * 10000`.
- Decimal division uses the v1 Decimal40 kernel (40 significant digits, HALF_EVEN) and records that
  boundary in `trace.rounding`.
- Authority is `local-exact`; maturity is `stable`.
- The public result is
  `MathResult<{ bestBid: string; bestAsk: string; mid: string; spread: string; spreadBps: string }>`:
  valid two-sided input returns `ok`; malformed levels, ordering, duplicate, locked, or crossed input
  returns `invalid-input`; a structurally valid one-sided/empty input returns `indeterminate` with
  code `two-sided-book-required` and missing JSON pointers for the absent sides. `not-applicable` is
  not used.
- Trace formula ID is `hl.orderbook.metrics` v1. SourceRefs contain this spec, the official L2 schema,
  and `DECIMALJS.10.6.0`; assumptions contain one `frozen-input` entry for `/levels`; rounding records
  the Decimal40/HALF_EVEN divisions used for mid/spread bps.

## `hl.orderbook.fill.simulate` v1

Source ID: `HLM.SPEC.ORDERBOOK.FILL.V1`

Input is exactly `{ levels, side, amount, referencePrice }`:

- `side` is `buy` or `sell`; buys walk asks best-to-worst and sells walk bids best-to-worst.
- `referencePrice` is a positive decimal string and is never inferred.
- `amount` is either `{ kind: "size", value }` or
  `{ kind: "notional", value, szDecimals }`, with a non-negative decimal `value`.
- Notional `szDecimals` is a safe integer from `0` through `8`, matching the supported precision
  metadata bound and preventing an unbounded Decimal quantization request.
- A zero requested amount is valid but returns `not-applicable`.
- Size requests fill `min(remainingSize, levelSize)` at each level.
- Notional requests consume full levels while possible. The final partial level computes
  `remainingNotional / levelPrice`, then rounds size down to `szDecimals`; any unspendable remainder
  stays unfilled.
- If that final down-quantized size is zero, omit the fill entirely. With no earlier fill, completion
  is `none`; with earlier fills, completion is `partial`. For notional requests, `unfilledAmount` is
  the exact requested notional minus the exact filled notional. For size requests it is requested
  size minus filled size.
- Result completion is `none`, `partial`, or `full`; it always reports fills, filled size/notional,
  and the unfilled amount. `none` has no synthetic VWAP/slippage fields.
- For a non-empty fill, `vwap = totalNotional / filledSize`, and `worstPrice` is the final fill price.
- Adverse slippage is signed and side-aware:
  - buy: `(vwap / referencePrice - 1) * 10000`;
  - sell: `(1 - vwap / referencePrice) * 10000`.
  Price improvement is therefore negative.
- Division uses Decimal40/HALF_EVEN and is recorded in `trace.rounding`; a notional partial-size
  quantization records `down` separately.
- Authority is `local-exact`; maturity is `stable` for the frozen input only.
- A nonzero request returns
  `MathResult<{ completion: "none" | "partial" | "full"; fills: readonly { px: string; sz: string; notional: string }[]; filledSize: string; filledNotional: string; unfilledAmount: string; vwap?: string; worstPrice?: string; slippageBps?: string }>`.
  Malformed shape/book/amount/reference input returns `invalid-input`. Zero amount returns
  `not-applicable` with code `zero-fill-amount` and the amount value path. The deterministic walk does
  not return `indeterminate`; lack of book depth is represented by `none` or `partial` data.
- Trace formula ID is `hl.orderbook.fill.simulate` v1. SourceRefs contain this spec, the official L2
  schema, and `DECIMALJS.10.6.0`; assumptions contain `frozen-input` for `/levels` and `fill-model`
  `book-vwap`; Decimal40 divisions and any final size-down quantization are recorded in rounding.

## Trace bound

The result may contain every consumed fill, but trace does not duplicate book levels or fills. It
records side counts, request/reference values, aggregate totals, and a frozen-input assumption. This
keeps trace allocation bounded independently of future snapshot depth limits.

## Oracle boundary

- The official Python SDK provides L2 schema/type evidence only; it does not implement these
  formulas, so formula oracle state is `not-supported`.
- Dated mainnet/testnet L2 fixtures provide replay input and schema evidence. They are partial oracle
  coverage, not server confirmation that a future market order would receive the simulated fills.
