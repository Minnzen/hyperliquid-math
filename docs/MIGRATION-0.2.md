# Migrating to 0.2

Version 0.2 adds four public functions and one new subpath without changing valid 0.1 inputs.

## New APIs

```ts
import {
  calculateOutcomeDualPrice,
  calculateOutcomeSettlement,
  evaluateRecurringOutcome,
} from 'hyperliquid-math/hip4'
import { calculateUnifiedAccountRatio } from 'hyperliquid-math/margin'
```

All four functions are also exported from the package root. HIP-4 inputs use decimal strings for
prices, fractions, and sizes. Recurring-outcome timestamps remain safe-integer numbers.

## Identifier v2

`encodeAssetId` and `decodeAssetId` retain their names and add:

```ts
encodeAssetId({ kind: 'outcome', outcome: 1, side: 1 })
// => { value: { status: 'ok', data: 100000011 }, trace: ... }
```

Outcome IDs with side digit `0` or `1` now decode to `{ kind: 'outcome', outcome, side }`. This is
the only behavior change for previously accepted numeric asset-ID inputs: 0.1 returned
`indeterminate` for the outcome range. Outcome encodings ending in digits `2` through `9` now return
`invalid-input`.

The numeric side is identity only. Do not assume that side `0` or `1` means Yes or No; resolve the
semantic label from the same `outcomeMeta.sideSpecs` snapshot before calling settlement math.

## Unified ratio

Build normalized DEX rows from per-DEX metadata and clearinghouse state, and Spot rows from
`spotClearinghouseState.balances`. Two fail-closed differences from the official float reference are
part of the public contract:

- every referenced collateral token requires an explicit Spot row; missing rows are
  `invalid-input`;
- any occupied token with `available = total − isolatedMarginUsed <= 0` makes the whole result
  `indeterminate`.

A zero-occupation token always contributes ratio `"0"` without division, including when its
available balance is zero or negative. This function is not portfolio margin and does not define a
liquidation threshold.

## Unchanged boundaries

The package remains ESM-only, requires Node 22 or newer for its supported runtime envelope, performs
no network I/O, and has only `decimal.js` as a runtime dependency. Full portfolio margin, HIP-2,
multi-outcome questions, and split/merge/negate behavior are outside 0.2.
