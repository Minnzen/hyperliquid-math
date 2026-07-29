# Perpetual Margin Contract

Status: M3 complete; M6 unified ratio complete
Last verified: 2026-07-30

Official formula sources: `HL.DOC.MARGINING.2026-07-19`,
`HL.DOC.MARGIN_TIERS.2026-07-19`

Snapshot-mapping reference: `HL.DOC.INFO.PERP.2026-07-19` (Kit/API schema context, not a formula
source and therefore not emitted by the arithmetic trace).

Margin functions operate on caller-supplied frozen account state, marks, leverage settings, and
margin-tier rules. Math does not fetch markets, choose account snapshots, evaluate freshness, submit
margin transfers, or predict liquidation execution. All public inputs use canonical asset refs, not
display coin names or pre-derived asset keys.

## Canonical margin data

Every position in a margin account input is keyed by a validated `CanonicalAssetRef`. A normalized
account rejects duplicate canonical asset keys after applying the identifier grammar in
`spec/identifiers.md`.

```ts
type PerpMarginTier = {
  lowerBound: string;
  maxLeverage: string;
};

type PerpMarginPosition = {
  asset: CanonicalAssetRef;
  signedSize: string;
  markPrice: string;
  leverage: string;
  marginMode:
    | { kind: "cross" }
    | {
        kind: "isolated";
        isolatedMarginValue: string;
        marginRemoval: "allowed" | "strict";
      };
  marginTiers: readonly PerpMarginTier[];
};
```

`signedSize` may be zero only in account-level scenario working state; public margin primitives for a
single position return `not-applicable` for zero exposure. `markPrice`, non-zero size absolute value,
leverage, tier lower bounds, max leverage, and isolated margin value are decimal strings. `leverage`
is the user's leverage setting (official `position.leverage.value`, converted to a decimal string);
it is an integer in protocol terms and is distinct from a tier's market `maxLeverage`, which must
also be a positive integer decimal string. The margin mode lives solely in `marginMode.kind`;
there is no separate leverage mode field.

For each tier:

- `maintenanceRate = 1 / (2 * maxLeverage)`;
- tier 0 has deduction `0`;
- tier n deduction is
  `previousDeduction + lowerBound_n * (maintenanceRate_n - maintenanceRate_(n-1))`;
- notional intervals are half-open: `[lowerBound, nextLowerBound)`;
- an exact tier boundary belongs to the higher tier.

The recurrence is normative because it preserves maintenance-margin continuity at every legal tier
boundary. Invalid tiers include empty arrays, negative lower bounds, non-positive or non-integer
max leverage,
non-zero first lower bound, non-increasing lower bounds, or a computed negative maintenance margin.

`crossAccountValue` is the caller-provided account value for cross positions only under the same
frozen marks as the positions. It includes unrealized PnL for cross positions and excludes isolated
margin value, isolated PnL, spot, vault, portfolio-margin, and any transport-layer balance concepts.
Kit should map this from the matching DEX `crossMarginSummary.accountValue`, not from a broader
`marginSummary.accountValue` unless a fixture proves equivalence. `isolatedMarginValue` is the
isolated position's independent account value at the supplied mark and already includes that
position's unrealized PnL; Math must not count it again inside `crossAccountValue`.

## `hl.margin.initial.calculate` v1

Source ID: `HLM.SPEC.MARGIN.INITIAL.V1`

Public function: `calculatePerpInitialMargin`.

Input is exactly `{ position }`, where the position has non-zero exposure, a positive mark price,
and an integer leverage between 1 and the first tier's max leverage.

```text
notional = abs(signedSize) * markPrice
initialMargin = notional / leverage
transferMarginRequirement = max(initialMargin, 0.1 * notional)
selectedTier = tierFor(notional)
openingLeverageSatisfied = leverage <= selectedTier.maxLeverage
```

The transfer requirement is the official minimum required to transfer margin or open isolated margin
under the supplied leverage. It is not a liquidation threshold and does not prove server acceptance
of a real margin-transfer action. The result also exposes the selected tier, its max leverage, and an
objective `hl.margin.initial.leverage-within-tier` constraint check. A violation does not invalidate
the arithmetic: official leverage is checked when exposure is opened, while an already-open position
can later move into another tier as marks change. Kit decides whether a contemplated opening action
must be blocked; current-snapshot risk views may still consume the computed margin values. Authority
is `local-exact`; maturity is `stable`.

## `hl.margin.maintenance.calculate` v1

Source ID: `HLM.SPEC.MARGIN.MAINTENANCE.V1`

Public function: `calculatePerpMaintenanceMargin`.

Input is exactly `{ position }`. The function selects the tier for
`notional = abs(signedSize) * markPrice`, derives rate and deduction by the recurrence above, and
returns:

```text
maintenanceMargin = notional * maintenanceRate - deduction
backstopThreshold = (2 / 3) * maintenanceMargin
```

The output includes notional, selected tier index, lower bound, optional next lower bound,
maintenance rate, deduction, maintenance margin, and backstop threshold. Backstop threshold is only
the objective `2/3` maintenance fact from the official liquidation documentation; it does not predict
partial liquidation, backstop execution, ADL, or the order in which HyperCore will act.

Authority is `local-exact`; maturity is `stable` for explicit tiers and frozen marks.

## `hl.margin.account.evaluate` v1

Source ID: `HLM.SPEC.MARGIN.ACCOUNT_EVALUATE.V1`

Public function: `evaluatePerpAccountMargin`.

Input is exactly:

```ts
{
  crossAccountValue: string;
  positions: readonly PerpMarginPosition[];
}
```

The function normalizes all positions once, rejects
duplicate canonical asset keys, and evaluates initial and maintenance facts for each non-zero
position. Zero-exposure rows are dropped from the public account result entirely; only the
scenario engine's internal views preserve them as `not-applicable` row facts.

Cross aggregate:

- includes positions with `marginMode.kind = "cross"`;
- `crossNotional = sum(abs(size) * markPrice)`;
- `crossInitialMargin = sum(position initialMargin)`;
- `crossTransferMarginRequirement = max(crossInitialMargin, 0.1 * crossNotional)`;
- `crossMaintenanceMargin = sum(position maintenanceMargin)`;
- `crossBackstopThreshold = (2 / 3) * crossMaintenanceMargin`;
- `crossMarginAvailable = crossAccountValue - crossMaintenanceMargin`;
- `crossInitialMarginAvailable = crossAccountValue - crossInitialMargin`;
- `crossTransferMarginAvailable = crossAccountValue - crossTransferMarginRequirement`.
- `crossMaxRemovableMargin = max(crossTransferMarginAvailable, 0)`.

Pseudo-code names map onto output fields as: `crossNotional` → `cross.positionValue`,
`crossMarginAvailable` → `cross.maintenanceMarginAvailable`, `crossInitialMarginAvailable` →
`cross.initialMarginAvailable`, `crossTransferMarginAvailable` → `cross.transferMarginAvailable`,
and the isolated row facts appear on each row as `maintenanceMarginAvailable`,
`initialMarginAvailable`, `transferMarginAvailable`, `maxRemovableMargin`, plus the row's
`marginValue` echo of `isolatedMarginValue`.

Isolated row facts:

- use only the row's `isolatedMarginValue`, never `crossAccountValue`;
- `isolatedMarginAvailable = isolatedMarginValue - maintenanceMargin`;
- `isolatedInitialMarginAvailable = isolatedMarginValue - initialMargin`;
- `isolatedTransferMarginAvailable = isolatedMarginValue - transferMarginRequirement`;
- when `marginRemoval = "allowed"`,
  `maxRemovableMargin = max(isolatedMarginValue - transferMarginRequirement, 0)`;
- when `marginRemoval = "strict"`, `maxRemovableMargin = 0`.

The account result contains row facts, cross aggregate facts, totals by margin mode, and trace
assumptions for frozen marks, complete tier rules, and same-snapshot account values. Each row
reports `marginMode` as `{ kind: "cross" }` or `{ kind: "isolated", marginRemoval }` — the same
object shape the liquidation result uses. It returns
values and objective constraint facts only; severity, warnings, blocking behavior, freshness, and
submission policy belong to Kit.

Authority is `local-exact`; maturity is `stable` for complete account snapshots.

## Scenario margin allocation helper

Source ID: `HLM.SPEC.MARGIN.AUTO_FROM_LEVERAGE.V1`

This rule is specified here so M3 scenarios can reuse the same margin semantics without inventing a
second formula. It is not a standalone public margin primitive unless the public manifest explicitly
adds it later.

For a new or increased isolated position under `auto-from-leverage`:

```text
targetInitialMargin = abs(projectedSignedSize) * frozenMarkPrice / targetLeverage
topUp = max(targetInitialMargin - existingIsolatedMarginValue, 0)
```

The price basis is the scenario's frozen mark for the projected position, not an order limit, oracle,
last trade, or future mark. The source of `topUp` is the scenario cross account value. The rule never
auto-removes excess isolated margin when `existingIsolatedMarginValue > targetInitialMargin`; removal
requires an explicit isolated-margin-delta or leverage/margin effect. If `topUp` exceeds available
cross value under the scenario's constraints, the scenario is `indeterminate` rather than partially
funding the isolated position.

Authority is `local-exact` for the counterfactual arithmetic. Protocol support for real
`updateLeverage` mode switches or margin reallocations remains `unverified` until a dated testnet
fixture proves the acceptance matrix.

## `hl.margin.unified-account-ratio.calculate` v1

Source ID: `HLM.SPEC.MARGIN.UNIFIED_ACCOUNT_RATIO.V1`

Public function: `calculateUnifiedAccountRatio`.

Input is exactly:

```ts
{
  readonly dexes: readonly {
    readonly dexIndex: number;
    readonly collateralToken: number;
    readonly crossMaintenanceMarginUsed: string;
    readonly isolatedMarginUsed: string;
  }[];
  readonly spotBalances: readonly {
    readonly token: number;
    readonly total: string;
  }[];
}
```

Both arrays must be dense and contain at most 1024 rows. Indexes are non-negative safe integers.
`dexIndex` values are unique, spot `token` values are unique, cross and isolated amounts are
non-negative decimal strings, and spot totals are signed decimal strings. Every collateral token
referenced by a DEX row must have a spot balance row. Unreferenced spot rows are validated but do
not appear in output.

Rows are grouped by collateral token:

```text
crossMaintenanceMarginUsed = sum(dex.crossMaintenanceMarginUsed)
isolatedMarginUsed = sum(dex.isolatedMarginUsed)
available = spotBalance.total - isolatedMarginUsed
```

For a token with `crossMaintenanceMarginUsed = 0` and `isolatedMarginUsed = 0`, `ratio = 0` without
division, regardless of the sign of `available`. Otherwise `available` must be positive:

```text
ratio = crossMaintenanceMarginUsed / available
accountRatio = max(token.ratio)
```

The result is:

```ts
{
  readonly tokens: readonly {
    readonly collateralToken: number;
    readonly spotTotal: string;
    readonly crossMaintenanceMarginUsed: string;
    readonly isolatedMarginUsed: string;
    readonly available: string;
    readonly ratio: string;
  }[];
  readonly accountRatio: string;
}
```

Tokens are sorted by `collateralToken`. Empty `dexes` returns
`{ tokens: [], accountRatio: "0" }`. Missing referenced spot rows return `invalid-input`. A token
with any margin occupation and `available <= 0` makes the whole call `indeterminate` with reason
`non-positive-unified-available-balance`; no partial value, non-positive division, `Infinity`, or
`NaN` is returned.

These are two deliberate normative divergences from the official TypeScript reference:

1. The official reference defaults a missing spot row to zero; this contract requires an explicit
   row and returns `invalid-input` when it is absent.
2. The official reference silently skips `available <= 0`; this contract returns `indeterminate`
   when the token has cross or isolated occupation. Zero-occupation tokens retain the official
   maximum-contribution semantics of zero without division.

Authority is `local-exact` on the valid domain; maturity is `experimental`. This function monitors
the documented unified account ratio only. It is not a portfolio margin ratio and does not define a
liquidation threshold, LTV, borrowing, caps, interest, eligibility, or liquidation execution.

## Trace and oracle boundary

Successful margin traces include source IDs, formula IDs, selected tier details, deduction recurrence
terms, account-snapshot assumptions, and maturity/authority. Invalid input traces are incomplete and
must not claim formula assumptions that did not run.

Official margin and margin-tier docs are the formula authority. Dated `meta.marginTables` and
`clearinghouseState` fixtures provide schema and snapshot-mapping evidence. The official
Python SDK does not provide independent margin arithmetic oracles, so its coverage for these formulas
is `not-supported` unless a later fixture proves otherwise.

## Limits

This contract does not cover liquidation price solving, projected scenario action ordering, portfolio
margin, spot margin, HIP-3 collateral behavior, actual server submission, or real liquidation
execution. Those domains must have separate specs, fixtures, tests, and maturity gates before public
runtime export.
