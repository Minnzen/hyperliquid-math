# Error Handling & Units

Every public function validates its own plain-data input, never throws, and returns
`{ value, trace }`. This page is the full statement of the result contract and the unit conventions
that every input and output follows.

## The result contract

```ts
value.status === 'ok'              // → value.data
value.status === 'invalid-input'   // → value.issues: [{ code, path, actual, expected }]
value.status === 'not-applicable'  // → valid input, but the math has no value here (e.g. flat position)
value.status === 'indeterminate'   // → a declared rule was incomplete for this input
```

- `ok` means the declared formula completed. Constraint checks inside `value.data` can still report
  violated or not-evaluated states — read them rather than assuming an `ok` result is an
  authorization to act.
- `invalid-input` issues carry `{ code, path, actual, expected }`. `expected` states the exact keys
  or format required, so the fix is in the error. Rebuild the offending field; do not retry blindly.
- `not-applicable` and `indeterminate` are answers, not failures. `not-applicable` means the
  calculation genuinely has no value for this state; `indeterminate` means a unique result cannot be
  established from the supported evidence or assumptions. Neither should be retried.

## Rounding is yours to direct

Outputs are full-precision decimal strings (up to 40 significant digits). The package refuses to
round until you tell it how. Before showing a price or putting it in an order, quantize it:

```ts
quantizePrice({ value, marketKind, szDecimals, rounding })
```

Rounding direction is always chosen against the user's favor — pick `'down'` for buys, `'up'` for
sells. The direction you chose is recorded in the trace, so the decision stays auditable.

## Unit conventions

- **Money is always a decimal string.** `'1.25'`, never `1.25`. Convert the few official JSON numbers
  (`maxLeverage`, `leverage.value`) with `String()`. Integer counts (`index`, `szDecimals`,
  `weiDecimals`, `timestampMs`, tier indices) stay numbers.
- **Rates are decimal fractions everywhere.** `'0.00045'` = 4.5 bps = 0.045%. Fields that carry basis
  points say so in their name (`slippageBps`, `spreadBps`).
- **Timestamps are millisecond safe integers** (`timestampMs`, `durationMs`).
- **Fees are signed user cost:** positive = the user pays, negative = a rebate.
- **Funding `payment`:** positive = the position pays. `accountValueDelta = -payment`.
- **Sizes:** `signedSize` describes a position (negative = short); `size` is always positive and pairs
  with `side: 'buy' | 'sell'`.

## What the package will not decide

`hyperliquid-math` returns values, constraint checks, assumptions, and a trace. It does not decide
severity, warnings, blocking, or freshness, and it does not fetch, sign, or submit. Server-authoritative
values — effective fee tier, final funding settlement, liquidation execution — are inputs or comparison
evidence, never outputs. Those belong in your policy and transport layers. The complete boundary is in
[Field Mapping](./field-mapping).
