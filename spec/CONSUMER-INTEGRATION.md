# Consumer Integration Guide

`hyperliquid-math` is a pure math package. It never fetches, caches, signs, submits,
subscribes, timestamps, or retries. Consumers own transport, mapping, freshness, policy,
execution, and post-trade reconciliation.

The package boundary is:

1. Fetch official API responses in your application or SDK layer.
2. Rebuild plain Math inputs field by field, using decimal strings for money-like values.
3. Call `hyperliquid-math`.
4. Apply your policy layer to the returned `{ value, trace }`.

Every returned trace is a per-call deeply frozen snapshot. Store or serialize it as evidence;
do not treat it as a mutable annotation object.

The normative mapping contract is [`KIT-MAPPING.md`](KIT-MAPPING.md). This guide is a quick
access document for public consumers.

## Fetch Boundary

Use Hyperliquid's public or authenticated APIs outside this package. Do not put fetch
wrappers, websocket clients, retry logic, caches, clocks, or credentials behind Math calls.

Common public reads that consumers map into Math inputs:

| Official request | Consumer use | Math boundary |
| --- | --- | --- |
| `{ type: 'meta' }` | Perp universe, `szDecimals`, `maxLeverage`, `marginTableId`, `marginTables` | Market metadata and margin tiers |
| `{ type: 'metaAndAssetCtxs' }` | Perp marks, oracle prices, impact prices, funding values | Explicit price and funding inputs |
| `{ type: 'clearinghouseState', user }` | Signed positions, entry prices, leverage mode/value, account summaries, observed server `liquidationPx` | Account snapshot mapping and comparison evidence |
| per-DEX `{ type: 'meta', dex }` and `{ type: 'clearinghouseState', user, dex }` | Collateral token, cross maintenance, isolated margin usage | Unified-account ratio rows |
| `{ type: 'userFees', user }` | Effective maker/taker rates and schedule inputs | Fee-rate inputs after consumer policy chooses the applicable rate |
| `{ type: 'userFills', user, ... }` | Ordered fill events with `side`, `px`, `sz`, `fee`, `feeToken`, `closedPnl`, `startPosition` | Replay events only after pagination, dedupe, routing, and completeness checks |
| `{ type: 'l2Book', coin }` | Ordered book levels | Book metrics and deterministic fill simulation |
| `{ type: 'spotMeta' }` / `{ type: 'spotMetaAndAssetCtxs' }` | Spot token metadata, spot pair metadata, marks | Spot units, portfolio value, and dust math |
| `{ type: 'spotClearinghouseState', user }` | Unified-mode token totals | Unified-account ratio spot rows |
| `{ type: 'outcomeMeta', ... }` / `{ type: 'settledOutcome', ... }` | Outcome IDs, side labels, settlement observations | Identifier mapping and comparison evidence; never formula authority |

Networked live comparisons are diagnostics, not package behavior. The scheduled
`Reliability - Live Differential` workflow runs only outside pull requests, requires the configured
address to be explicitly asserted as standard mode through the workflow input or
`HYPERLIQUID_LIVE_ORACLE_ACCOUNT_MODE`, requires at least one cross position, compares cross-margin
aggregates and liquidation prices, fails on differences beyond its declared tolerances, and skips
with `not-supported` when no public account is configured.

## Map Boundary

Math validates exact plain-data input shapes. Rebuild objects instead of passing official
responses through.

Establish the user's
[account abstraction mode](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/account-abstraction-modes)
before mapping margin or liquidation inputs. The official modes have materially different collateral
boundaries:

- **Standard:** perp and spot balances are separate, and cross margin applies to each DEX separately.
  A single DEX `clearinghouseState` can be mapped to the per-DEX cross formulas below.
- **Unified:** spot and perps share balances by collateral asset across DEXs. The official API documents
  balances and holds in `spotClearinghouseState`; individual perp-DEX user states are not meaningful.
  Do not pass one DEX's `crossMarginSummary.accountValue` to the standard-account example.
- **Portfolio margin:** eligible spot balances, borrows, and cross positions are collectively margined
  with a [separate portfolio-maintenance formula](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/portfolio-margin).
  The current per-DEX liquidation API does not implement that model.

Unified mode is recommended for most users, but the official documentation does not establish that
every new account defaults to it. An arbitrary public address is therefore not a safe standard-mode
fixture. Consumers own the authoritative account-mode configuration; do not infer it from the
presence or shape of one `clearinghouseState` response.

Important rules:

- Convert official JSON numbers such as `maxLeverage`, `marginTiers[].maxLeverage`, and
  `position.leverage.value` with `String()` before calling Math.
- Strip unrelated official fields such as `coin`, `cumFunding`, `returnOnEquity`, and response
  timestamps.
- Route assets before calling a domain function: bare coin names are first-party perps, `@N`
  names are spot pairs, and `dex:NAME` names are HIP-3 perps.
- Use `crossMarginSummary.accountValue` for cross account equity. Do not substitute
  `marginSummary.accountValue` when isolated positions exist.
- Map missing low-numbered `marginTableId` entries as a single implicit tier:
  `{ lowerBound: '0', maxLeverage: String(universe[i].maxLeverage) }`.
- Treat observed fields such as server `liquidationPx`, `marginUsed`, `closedPnl`, and final
  funding settlements as evidence or reconciliation inputs, not formulas Math claims to own.

## Policy Boundary

An `ok` Math result is a deterministic local calculation, not permission to trade. Your
application still decides:

- data freshness and snapshot consistency;
- severity, warnings, and blocking behavior;
- account eligibility, permissions, wallet state, signatures, nonces, and submission;
- rate-limit handling, retries, stale-cache behavior, and API error handling;
- final display rounding and conservative order construction;
- whether `not-applicable`, `indeterminate`, or `not-evaluated` should block a workflow.

Math returns objective values, issues, constraint checks, assumptions, and trace data. It does
not promise server parity for mutable acceptance rules, order matching, queue position, partial
liquidation execution, ADL, actual fills, deployment acceptance, or future governance changes.

## Common API Mapping

### Liquidation and Margin

The following mapping is only for one standard-mode DEX account. Map every open cross perp position
from the same snapshot: cross liquidation depends on the whole per-DEX cross account, not only the
target market.

```ts
const tables = new Map(meta.marginTables.map(([id, table]) => [id, table.marginTiers]))
const indexByCoin = new Map(meta.universe.map((market, index) => [market.name, index]))

const mapMarginTiers = (market) =>
  (tables.get(market.marginTableId) ?? [
    { lowerBound: '0', maxLeverage: market.maxLeverage },
  ]).map((tier) => ({
    lowerBound: tier.lowerBound,
    maxLeverage: String(tier.maxLeverage),
  }))

const mapPerpPosition = ({ position }) => {
  const index = indexByCoin.get(position.coin)
  if (index === undefined) {
    throw new Error(`missing market metadata for ${position.coin}`)
  }
  const market = meta.universe[index]
  const assetCtx = assetCtxs[index]
  if (market === undefined || assetCtx === undefined) {
    throw new Error(`incomplete market context for ${position.coin}`)
  }
  if (position.leverage.type !== 'cross') {
    throw new Error('isolated positions require independently proven isolatedMarginValue evidence')
  }
  return {
    asset: { network: 'mainnet', marketKind: 'perp', dex: null, index },
    signedSize: position.szi,
    entryPrice: position.entryPx,
    markPrice: assetCtx.markPx,
    leverage: String(position.leverage.value),
    marginMode: { kind: 'cross' },
    marginTiers: mapMarginTiers(market),
  }
}
```

For isolated margin, do not invent per-position equity allocation when an account has multiple
isolated positions. Keep that slice unmapped until your source evidence proves the allocation.
For portfolio-margin accounts, do not reuse this standard-account mapping. Unified accounts use the
separate documented aggregation below.

### Unified Account Ratio

Call `calculateUnifiedAccountRatio` only after independently establishing unified mode and collecting
one consistent snapshot across every relevant DEX plus Spot. Build each DEX row field by field:

```ts
const dexes = dexSnapshots.map(({ dexIndex, meta, state }) => ({
  dexIndex,
  collateralToken: meta.collateralToken,
  crossMaintenanceMarginUsed: state.crossMaintenanceMarginUsed,
  isolatedMarginUsed: state.assetPositions
    .filter(({ position }) => position.leverage.type === 'isolated')
    .reduce(
      (sum, { position }) => decimalStringAdd(sum, position.marginUsed),
      '0',
    ),
}))

const spotBalances = spotState.balances.map(({ token, total }) => ({ token, total }))
const ratio = calculateUnifiedAccountRatio({ dexes, spotBalances })
```

`decimalStringAdd` above belongs in the consumer mapping layer and must use exact decimal arithmetic;
do not aggregate money with JavaScript numbers. The package then revalidates and reaggregates the
normalized rows with Decimal40.

The first-party DEX is index `0` with collateral token `0`; builder DEX indexes follow the official
`perpDexs` ordering, and each DEX's `meta.collateralToken` is authoritative. Every referenced
collateral token needs an explicit Spot row. Do not silently synthesize a missing balance unless the
same snapshot independently proves the API omitted a true zero.

Two fail-closed differences from the official float reference are deliberate:

- a missing referenced Spot row returns `invalid-input` instead of defaulting to zero;
- a token with margin occupation and `total − isolatedMarginUsed <= 0` returns `indeterminate`
  instead of being skipped.

A zero-occupation token contributes ratio `"0"` without division even if its available balance is
zero or negative. The result is a monitoring fact, not a liquidation threshold and not portfolio
margin.

### Outcome IDs and HIP-4

Outcome asset IDs encode as `100000000 + 10 × outcome + side`, with binary numeric side `0 | 1`.
Keep that numeric identity separate from the semantic settlement label:

```ts
const assetId = encodeAssetId({ kind: 'outcome', outcome, side })
const tokenSide =
  sideSpec.label === 'Yes'
    ? 'yes'
    : sideSpec.label === 'No'
      ? 'no'
      : undefined
if (tokenSide === undefined) {
  throw new Error(`unsupported semantic outcome label: ${sideSpec.label}`)
}
const payout = calculateOutcomeSettlement({
  tokenSide,
  settleFraction,
  size,
  entryPrice,
})
```

The label mapping must come from the same `outcomeMeta.sideSpecs` snapshot; Math never assumes that
numeric side `0` means Yes or No. `evaluateRecurringOutcome` likewise requires the caller to select
the mark updates around settlement. `settledOutcome` is post-settlement comparison evidence, not an
input that determines the formula.

### Fees

Official `userFees.feeSchedule.base.cross` is the taker rate and `base.add` is the maker rate.
Pass effective account rates directly to `calculateTradeFee` only after your policy layer has
selected the correct maker/taker side and fee-token convention.

### Funding

`metaAndAssetCtxs[1][i].funding` is already the hourly funding rate as a decimal fraction. Use
`oraclePx`, not `markPx`, for funding payment inputs.

### Replay and Reconciliation

Replay requires ordered, deduplicated, complete events. Raw paginated responses are not enough.
If your consumer cannot prove fill/funding/transfer completeness for the requested interval,
surface that as a policy limitation rather than treating a neutral residual as server parity.
