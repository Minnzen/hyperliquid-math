# Perpetual Liquidation Contract

Status: M3 complete (independently reviewed)
Last verified: 2026-07-19

Official formula sources: `HL.DOC.LIQUIDATIONS.2026-07-19`,
`HL.DOC.MARGINING.2026-07-19`, `HL.DOC.MARGIN_TIERS.2026-07-19`

Snapshot-mapping reference: `HL.DOC.INFO.PERP.2026-07-19` (Kit/API schema context, not a formula
source and therefore not emitted by the arithmetic trace).

Hyperliquid documents liquidation as a mark-price margin test over account value and maintenance
margin. Math therefore computes the exact local liquidation root for a frozen, complete caller
snapshot. It does not predict partial liquidation execution, backstop fills, ADL, oracle/mark
updates, or server-side liquidation scheduling.

## Canonical liquidation snapshot

`calculatePerpLiquidationPrice` accepts exactly one target asset and a complete account snapshot:

```ts
type PerpLiquidationInput = {
  targetAsset: CanonicalAssetRef;
  crossAccountValue: string;
  positions: readonly PerpLiquidationPosition[];
};

type PerpLiquidationPosition = {
  asset: CanonicalAssetRef;
  signedSize: string;
  entryPrice: string;
  markPrice: string;
  marginMode:
    | { kind: "cross" }
    | {
        kind: "isolated";
        isolatedMarginValue: string;
        marginRemoval: "allowed" | "strict";
      };
  marginTiers: readonly { lowerBound: string; maxLeverage: string }[];
};
```

Each position has a non-zero signed size, positive entry and mark prices, one canonical asset
identity, and a dense margin-tier schedule. `targetAsset` must match exactly one position after
canonical key derivation. `crossAccountValue` is the frozen cross account value for the same marks as
the cross positions; it excludes isolated margin value, isolated PnL, spot, vault, and portfolio
margin assets. `isolatedMarginValue` is the isolated position's account value at its supplied mark
and already includes that position's unrealized PnL. Account values are signed because a captured
liquidatable snapshot can already be below zero. Math rejects duplicate assets, missing target
positions, empty tier schedules, negative tier lower bounds, non-increasing tier lower bounds,
non-positive or non-integer max leverage, and non-plain decimal amounts.

The snapshot is atomic and frozen. All non-target marks remain fixed while solving for the target
mark. Math does not fetch, cache, refresh, or timestamp data; freshness and snapshot mapping belong
to Kit.

## Tier schedule

Source ID: `HLM.SPEC.LIQUIDATION.PRICE.V1`

For each margin tier:

- `maintenanceRate = 1 / (2 * maxLeverage)`;
- tier 0 has `deduction = 0`;
- tier `n` has `deduction = previousDeduction + lowerBound_n * (rate_n - previousRate)`;
- maintenance margin at mark `p` is `abs(size) * p * maintenanceRate - deduction`;
- the selected tier is based on notional `abs(size) * p`;
- tier ranges are half-open: `[lowerBound_n, lowerBound_next)`;
- exact equality with a tier lower bound selects the higher tier.

The deduction rule makes maintenance margin continuous at valid tier boundaries. A tier schedule whose
derived maintenance margin can become negative at a candidate notional is invalid for this function;
callers must pass the official `meta.marginTables` schedule for the target market's dex and index.

## Cross liquidation equation

For a cross target, Math keeps all other cross positions at their frozen marks and excludes all
isolated positions from the cross margin pool.

Let:

- `q` be the target signed size;
- `z = abs(q)`;
- `p0` be the target mark in the input snapshot;
- `x` be the unknown target liquidation mark;
- `A0` be `crossAccountValue`;
- `M_other` be the frozen maintenance margin of every non-target cross position;
- `r` and `d` be the candidate target tier maintenance rate and deduction.

The cross account value at candidate price `x` is:

```text
A(x) = A0 + q * (x - p0)
```

The target maintenance margin at candidate price `x` is:

```text
M_target(x) = z * x * r - d
```

The liquidation boundary solves:

```text
A0 + q * (x - p0) = M_other + z * x * r - d
x = (M_other - d - A0 + q * p0) / (q - z * r)
```

Math evaluates this root against every target tier, then keeps the unique positive finite root whose
target liquidation notional selects that same tier. If a candidate root lands exactly on a tier lower
bound, the higher-tier rule is applied before accepting the root.

## Isolated liquidation equation

For an isolated target, Math ignores every other position and uses only the target isolated account
value. `crossAccountValue` is still validated as account-snapshot context but is not part of the
isolated margin pool.

Let `A0` be the target `isolatedMarginValue` at `p0`; `M_other = 0`; and all other terms match the
cross equation. The isolated boundary is:

```text
A0 + q * (x - p0) = z * x * r - d
x = (-d - A0 + q * p0) / (q - z * r)
```

`marginRemoval` is reported as a fact for scenario composition and trace context. It does not
change the current liquidation root unless the caller models an explicit isolated-margin delta in a
scenario action before calling the normalized liquidation primitive.

## Result

For complete, valid, frozen inputs, authority is `local-exact` and maturity is `stable`.

That stability label applies to the documented local equation and the self-consistent tier selection,
not to byte-for-byte server display parity. When the input mark's tier differs from the root's tier,
the implementation solves the root under the tier selected by liquidation notional; the official
prose does not publish a separate cross-tier worked vector. Dated evidence currently contains only a
single-tier server `liquidationPx` comparison. Cross-tier server display parity therefore remains
unverified and must not be represented as a passed oracle.

A successful result returns:

- `assetKey` and `marginMode`;
- `liquidationPrice`;
- `liquidationNotional`;
- selected tier lower bound, maintenance rate, and deduction;
- account equity at the liquidation price;
- target maintenance margin at the liquidation price;
- total account maintenance margin at the liquidation price;
- `adverseDistance = side * (markPrice - liquidationPrice)`, where side is `1` for long and `-1`
  for short;
- `adverseDistanceRatio = adverseDistance / markPrice`;
- `currentlyAtOrBelowMaintenance`, evaluated at the frozen input mark;
- `backstopPrice` computed by the same frozen-root method from
  `accountValue = (2 / 3) * totalMaintenanceMargin`;
- `backstopMaintenanceThreshold`, evaluated at that backstop root rather than at the liquidation
  root;
- `backstopAdverseDistance` from the frozen input mark to the backstop root;
- trace source IDs, normalized tier derivation, candidate roots, and assumptions.

The backstop equation is solved independently of the liquidation equation, so a valid liquidation
root does not guarantee a backstop root. When no positive tier-consistent backstop root exists —
for example, a cross account whose other-position maintenance dominates the `2 / 3` factor and
drives every backstop candidate non-positive — `backstopPrice`, `backstopMaintenanceThreshold`, and
`backstopAdverseDistance` are `null`, the result remains `ok` for the liquidation fields, and the
`backstop-root` trace step records reason `no-positive-tier-consistent-backstop-root`.

For both long and short positions, a liquidation boundary in the adverse direction gives a positive
`adverseDistance`; a non-positive value is an objective fact that the frozen mark is at or beyond the
boundary. Math returns objective values only; Kit decides display wording, warnings, blocking
behavior, and freshness.

## Not-applicable and indeterminate cases

The function returns `not-applicable` when:

- no positive finite root exists in any target tier;
- no candidate root is consistent with the tier selected by its own liquidation notional.

A missing target, duplicate target, or a flat row in this public input is `invalid-input`, not
`not-applicable`. A currently liquidatable frozen snapshot can still return its mathematical boundary
and sets `currentlyAtOrBelowMaintenance = true`.

The function returns `indeterminate` when the caller declares an incomplete rule or unsupported
margin model that participates in the formula. Portfolio margin, HIP-3 collateral-specific margin,
and non-USDC collateral variants are not evaluated by this core perps function.

## Server replay boundary

Official `clearinghouseState.assetPositions[].position.liquidationPx` is replay evidence for the
server's current snapshot, not a second implementation oracle. Local equality to server
`liquidationPx` can only be claimed for dated fixtures that include the complete account value,
position set, target marks, margin-table source, and server field from one observed snapshot.

Projected liquidation after fills, isolated-margin changes, or leverage/mode actions belongs to the
scenario engine. Those projections reuse this normalized primitive after applying explicit actions.
They remain experimental for protocol-submit parity until controlled testnet actual-fill and
`updateLeverage` fixtures verify server acceptance and post-action snapshot mapping.
