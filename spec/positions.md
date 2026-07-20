# Perpetual Positions Contract

Status: M2 complete
Last verified: 2026-07-19

Official sources: `HL.DOC.ENTRY_PNL.2026-07-19`, `HL.DOC.INFO.USER_FILLS.2026-07-19`,
`HL.DOC.INFO.PERP.2026-07-19`

Hyperliquid documents entry price, unrealized PnL, and closed PnL as frontend convenience fields;
fundamental accounting is margin plus trades. Math therefore projects deterministic position state
and separates price PnL from fees. It does not turn a display field into an account ledger.

## Canonical position and fill data

M2 position functions use a discriminated state:

```ts
type PerpPositionState =
  | { kind: "flat" }
  | { kind: "open"; signedSize: string; entryPrice: string };
```

Open `signedSize` is non-zero (`> 0` long, `< 0` short); `entryPrice` is positive. A fill is exactly
`{ side, size, price, fee }`, where side is `buy` or `sell`, size is non-negative, price is positive,
and fee is one of:

```ts
{ kind: "explicit"; amount: string }
| { kind: "rate"; rate: string }
| { kind: "none" }
```

Fee amount/rate uses `spec/fees.md`'s signed user-cost convention. A positive amount is a charge and
has a negative account-value delta. No fill contains transport, order, TIF, nonce, or timestamp data.
An explicit non-zero fee on a zero-size fill is invalid input rather than being silently discarded;
a rate fee on zero notional evaluates to zero normally.

## `hl.positions.unrealized-pnl.calculate` v1

Source ID: `HLM.SPEC.POSITIONS.UNREALIZED_PNL.V1`

Input is exactly `{ position, markPrice }`; `markPrice` is positive. Flat is valid but returns
`not-applicable`. For an open position:

- `side = long` when signed size is positive, otherwise `short`;
- `absoluteSize = abs(signedSize)`;
- `positionValue = absoluteSize * markPrice`;
- `unrealizedPnl = signedSize * (markPrice - entryPrice)`.

The last expression is algebraically identical to the official side/absolute-size formula. No ROE
is returned because margin used belongs to the M3 margin snapshot. Authority is `local-exact`;
maturity is `stable`.

## `hl.positions.fill.project` v1

Source ID: `HLM.SPEC.POSITIONS.FILL_PROJECT.V1`

Input is exactly `{ position, fill }`. The signed fill delta is positive for a buy and negative for a
sell. A zero-size fill is an `ok` no-op so reducers preserve the input state.

State transition rules:

1. Flat plus non-zero fill opens at the fill price.
2. Same-direction fill increases the position and uses size-weighted entry:
   `(abs(oldSize) * oldEntry + fillSize * fillPrice) / abs(newSize)`.
3. Opposite fill smaller than the old absolute size reduces; entry is unchanged.
4. Equal opposite fill closes to `{ kind: "flat" }`.
5. Larger opposite fill first closes the old size, then opens the remainder in the new direction at
   the fill price. Official live/API evidence names this `Long > Short` or `Short > Long`.

The weighted-entry division is recorded in `trace.rounding` for both the single-fill and sequence
public functions. The record denotes the Decimal40/HALF_EVEN operation boundary even when the vector
divides exactly.

For the closing portion only:

- `grossRealizedPnl = oldSignedSize.sign * (fillPrice - oldEntry) * closedSize`;
- `feeAmount` is explicit or `fillPrice * fillSize * rate`, or zero;
- `feeAccountValueDelta = -feeAmount`;
- `closedPnl = grossRealizedPnl + feeAccountValueDelta`.

The output also reports `classification` (`no-op`, `open`, `increase`, `reduce`, `close`, `flip`),
closed/opened sizes, previous/next state, gross realized PnL, fee amount, fee account-value delta, and
closed PnL. Fee is calculated on the full fill, including a flip's opening remainder. Authority is
`local-exact`; maturity is `stable`.

The official prose describes closed PnL using a signed fee term, while API examples expose `fee` as a
separate field and opening fills with `closedPnl = 0`. v1 resolves this evidence mismatch by exposing
gross price PnL, signed user-cost fee, fee account delta, and their Math-defined net `closedPnl`
separately. M4 reconciliation now compares raw server fields through neutral gross/net/fee residuals
without redefining their protocol semantics.

## `hl.positions.sequence.project` v1

Source ID: `HLM.SPEC.POSITIONS.SEQUENCE_PROJECT.V1`

Input is exactly `{ position, fills }`. `fills` is a dense plain array with at most 2000 entries,
matching one official `userFillsByTime` response window, and is applied in array order through the
normalized fill transition. Empty input is an `ok` identity. Larger histories compose by passing one
page's final state into the next call; Math never truncates a supplied page. The output contains each
transition, final state, and exact sums of gross realized PnL, fee amount, fee account-value delta,
and closed PnL. Result order is evidence; fills are never sorted by Math. Trace stores counts and
aggregates rather than duplicating every transition.

## `hl.positions.break-even-price.calculate` v1

Source ID: `HLM.SPEC.POSITIONS.BREAK_EVEN.V1`

Input is exactly `{ position, cumulativeCost }`. `cumulativeCost` uses the same signed user-cost
convention: positive fees/funding paid increase cost; negative rebates/funding received reduce it.
Flat returns `not-applicable`.

`breakEvenPrice = entryPrice + cumulativeCost / signedSize`

The formula is exact for the explicit cost and current position only. It assumes the position size
and entry remain fixed and excludes future fees/funding unless included by the caller. A computed
non-positive price returns `indeterminate` with `no-positive-break-even-price`. Authority is
`local-exact`; maturity is `stable`.

## Trace assumptions

Successful and mathematically complete position traces state their evidence boundary explicitly:

- unrealized PnL freezes the caller-provided mark;
- a single fill uses the caller-provided explicit fill/fee model and does not replay raw server
  display fields;
- a sequence preserves caller order, performs no sorting or truncation, and leaves pagination to the
  caller;
- break-even freezes the current position and includes only the caller-provided cumulative cost,
  excluding future fees and funding.

Invalid input traces remain incomplete and do not claim assumptions for a formula that did not run.

## Oracle boundary

Dated mainnet/API and official-SDK fixtures provide partial evidence for position fields, start
position, open/reduce/close/flip classification, and server unrealized/closed PnL observations.
The official Python SDK does not independently implement these formulas. Oracle coverage is
therefore partial only where a recorded server response is replayed, and `not-supported` elsewhere.
