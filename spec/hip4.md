# HIP-4 Outcome Math Contract

Status: M6 API/spec frozen; implementation pending
Last verified: 2026-07-30

Official sources: `HL.DOC.HIP4.2026-07-30`,
`HL.DOC.CONTRACT_SPECIFICATIONS.2026-07-30`,
`HL.DOC.INFO.OUTCOME_META.2026-07-30`, and
`HL.DOC.INFO.SETTLED_OUTCOME.2026-07-30`.

HIP-4 functions operate only on caller-supplied frozen plain data. They do not fetch metadata, map
numeric outcome sides to semantic labels, choose mark updates, decide the authoritative settlement,
calculate fees, or model split, merge, negate, matching, questions, or submission behavior. Every
money-like input is a plain decimal string and every arithmetic operation uses Decimal40.

## `hl.hip4.dual-price.calculate` v1

Source ID: `HLM.SPEC.HIP4.DUAL_PRICE.V1`

Public function: `calculateOutcomeDualPrice`.

Input is exactly:

```ts
{ readonly price: string }
```

`price` is a plain decimal string in the closed interval `[0, 1]`.

```text
dualPrice = 1 - price
```

The output is `{ dualPrice }`. This formula expresses the official merged-book price equivalence
only. It does not model price-side-time priority or order execution.

Authority is `local-exact`; maturity is `experimental`. A valid input returns `ok`; invalid shape,
decimal grammar, or range returns `invalid-input`. `not-applicable` and `indeterminate` are not used.

## `hl.hip4.settlement.calculate` v1

Source ID: `HLM.SPEC.HIP4.SETTLEMENT.V1`

Public function: `calculateOutcomeSettlement`.

Input is exactly:

```ts
{
  readonly tokenSide: 'yes' | 'no';
  readonly settleFraction: string;
  readonly size: string;
  readonly entryPrice: string;
}
```

`settleFraction` and `entryPrice` are plain decimal strings in `[0, 1]`; `size` is non-negative.
`tokenSide` is payout semantics, not the numeric `side: 0 | 1` used by outcome asset IDs:

- `yes` is the token that receives `settleFraction` quote tokens at settlement;
- `no` is the token that receives `1 - settleFraction`.

The package never maps between these representations. Kit must use the same dated
`outcomeMeta.sideSpecs` snapshot to determine labels.

```text
payoutFraction =
  tokenSide == yes ? settleFraction : 1 - settleFraction

settlementValue = size * payoutFraction
entryNotional = size * entryPrice
grossPnl = settlementValue - entryNotional
```

The output is `{ payoutFraction, settlementValue, entryNotional, grossPnl }`. A zero size returns
`not-applicable` with reason `zero-outcome-size` at `/size`. Valid non-zero input returns `ok`;
invalid shape, enum, decimal grammar, sign, or range returns `invalid-input`; `indeterminate` is not
used.

This is an explicit settlement projection. The caller supplies `settleFraction`; the function does
not determine the real outcome, fees, or probability.

## `hl.hip4.recurring-outcome.evaluate` v1

Source ID: `HLM.SPEC.HIP4.RECURRING_OUTCOME.V1`

Public function: `evaluateRecurringOutcome`.

Input is exactly one branch of this top-level discriminated union:

```ts
type EvaluateRecurringOutcomeInput =
  | {
      readonly class: 'priceBinary';
      readonly markPrice0: string;
      readonly t0: number;
      readonly markPrice1: string;
      readonly t1: number;
      readonly settlementTime: number;
      readonly targetPrice: string;
    }
  | {
      readonly class: 'priceBucket';
      readonly markPrice0: string;
      readonly t0: number;
      readonly markPrice1: string;
      readonly t1: number;
      readonly settlementTime: number;
      readonly priceThresholds: readonly [string, string];
    };
```

Prices and thresholds are positive plain decimal strings. Times are safe integers, `t0 < t1`, and
`t0 <= settlementTime <= t1`. A bucket input has exactly two dense thresholds with `P1 < P2`.

Both branches use:

```text
interpolatedMarkPrice =
  markPrice0
  + (settlementTime - t0) / (t1 - t0)
  * (markPrice1 - markPrice0)
```

`priceBinary` returns:

```text
settlesTo = interpolatedMarkPrice >= targetPrice ? yes : no
settleFraction = settlesTo == yes ? 1 : 0
```

with output
`{ class: "priceBinary", interpolatedMarkPrice, settlesTo, settleFraction }`.

`priceBucket` returns:

```text
settledBucket =
  interpolatedMarkPrice < P1   ? 0
  : interpolatedMarkPrice < P2 ? 1
  : 2
settleFractions = oneHot(settledBucket)
```

with output
`{ class: "priceBucket", interpolatedMarkPrice, settledBucket, settleFractions }`. Equality at either
threshold belongs to the higher bucket. `settleFractions` has exactly three string entries and
exactly one `"1"`.

Authority is `local-exact`; maturity is `experimental`. Valid input returns `ok`; invalid shape,
class, price, time, interval, threshold order, sparse array, or array length returns `invalid-input`.
`not-applicable` and `indeterminate` are not used.

The caller must choose mark updates immediately before and after the settlement timestamp. The
function does not validate their provenance or decide server settlement. Bucket index to outcome ID
is metadata mapping owned by Kit. Multi-outcome questions are outside this contract.

## Trace and oracle boundary

Successful traces use the formula IDs and source IDs above, `authority: "local-exact"`,
`maturity: "experimental"`, and `DECIMALJS.10.6.0`. They record validated normalized inputs and
enough intermediates to replay subtraction, payout arithmetic, interpolation numerator/denominator,
binary comparison, and both bucket comparisons. Successful traces state caller-supplied frozen
metadata/mark assumptions. Invalid traces are incomplete and assumption-free.

The official documentation is formula authority. `outcomeMeta` and `settledOutcome` are mapping and
comparison evidence only. The official Python SDK and live fixtures are `not-supported` for these
formulas until an independent executable slice exists; hand-derived unit vectors do not upgrade
oracle coverage.
