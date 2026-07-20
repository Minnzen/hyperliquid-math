# Math / Kit Integration Boundary

This package computes deterministic values from a frozen plain-data snapshot. Hyperliquid Kit owns
transport, identity resolution, freshness, policy, and execution. The split is intentional:

| Concern | Kit provides | Math returns |
| --- | --- | --- |
| Precision | market kind, `szDecimals`, raw user value, explicit direction | canonical protocol-valid candidate or objective precision check |
| Asset identity | network, official dex name, metadata index, market kind | canonical asset key and numeric asset-ID arithmetic |
| Orderbook | ordered L2 snapshot and chosen reference price | mid/spread, deterministic book walk, VWAP/slippage |
| Positions | ordered fills, normalized fee convention, starting cost basis | state transitions, entry, realized/unrealized/closed PnL |
| Fees/funding | current schedule/rate rules, oracle/impact prices, settlement interval | tier arithmetic, fee amount, premium/rate/payment/annualization |
| Margin/liquidation | same-snapshot positions, marks, cross account value, isolated values, official tiers | current/projected margin facts and tier-consistent liquidation roots |
| Order preview | current position/collateral, protocol rule availability, caller target assumptions | objective checks, local max bound, reduce-only, trigger, scale, deterministic TWAP |
| Replay | ordered/deduplicated events, completeness evidence, observed snapshot | ledger projection, residuals, objective reconciliation checks |
| Spot/HIP | token metadata, marks, normalized fee token value, account-abstraction and DEX facts | units, cost basis, dust predicates/projection, HIP-1/HIP-3 deterministic constraints |

## Two rules that apply to every mapping

1. **Every money-like Math input is a decimal string.** Official responses mix strings
   (`szi`, `entryPx`, `lowerBound`) and JSON numbers (`universe[].maxLeverage`,
   `marginTiers[].maxLeverage`, `leverage.value`). Number fields must be converted with `String()`
   before they enter Math; a raw number is rejected with `invalid-decimal-string`. The only numeric
   Math inputs are integer counts and indices (`index`, `szDecimals`, `weiDecimals`, `timestampMs`,
   tier indices).
2. **Official response objects are rebuilt, not passed through.** Math validates exact key sets, so
   extra server fields (`cumFunding`, `returnOnEquity`, `coin`, `time`, …) are rejected as
   `invalid-input-shape`. Kit rebuilds each input object field by field. This is deliberate: it makes
   every mapping explicit and auditable. The one intentional exception: official `l2Book` level rows
   `{ px, sz, n }` are already the exact input shape and pass through unchanged (the response's outer
   `coin`/`time` wrapper is still stripped).

## Official API field mapping

### Asset identity

- `{ network, marketKind: 'perp', dex, index }`: `dex` is the official dex name from `perpDexs`
  (`'xyz'`, `'flx'`, …) and is `null` for the first-party dex — the official `perpDexs` entry for it
  is `null`, and an empty-string `dex` request parameter means the same thing, so Kit passes `null`
  (Math normalizes `''` to `null`). `index` is the market's position in that dex's `meta.universe`.
- Fill/market `coin` strings route by syntax: a bare name (`"BTC"`) is a first-party perp, `"@N"` is
  spot pair index `N`, and `"dex:NAME"` is a HIP-3 perp on that dex. Kit performs this routing;
  Math's perp functions accept perp rows only.

### Margin tiers and market metadata

- `meta.marginTables` is an array of `[marginTableId, { description, marginTiers }]` pairs. Kit joins
  `universe[].marginTableId` to the matching pair and maps each inner `marginTiers[]` entry as
  `{ lowerBound, maxLeverage: String(maxLeverage) }`, preserving order.
- **Not every `marginTableId` appears in `marginTables`.** Low-numbered IDs (observed: IDs below 50,
  equal to the market's `maxLeverage`) denote an implicit single-tier schedule; map them as
  `[{ lowerBound: '0', maxLeverage: String(universe[i].maxLeverage) }]`. This fallback is verified
  by dated live liquidation-price comparisons on markets using such IDs.
- `meta.universe[].szDecimals` (or Spot token metadata) supplies `szDecimals`.
- `meta.universe[].marginMode === "strictIsolated"` maps to `marginRemoval: 'strict'`; every other
  market maps to `marginRemoval: 'allowed'`. Standard first-party perps are `'allowed'`.

### Account snapshots (`clearinghouseState`)

- `position.szi` → `signedSize` (already signed; negative is short). `position.entryPx` →
  `entryPrice`. `position.leverage.value` → `leverage` via `String()`.
- `crossAccountValue` ← `crossMarginSummary.accountValue` — **not** `marginSummary.accountValue`;
  the two differ whenever isolated positions exist.
- `isolatedMarginValue`: dated fixture evidence (`fixtures/live/2026-07-19-mainnet-m3.json`
  `mappingAssertions`) proves that with one isolated position it equals
  `marginSummary.accountValue − crossMarginSummary.accountValue`, unrealized PnL included. Official
  responses do not publish a per-position isolated equity field, so with multiple isolated positions
  this mapping is unevidenced and must be treated as unmapped until a fixture proves a per-position
  derivation.
- Observed `liquidationPx` and `marginUsed` are replay/verification evidence, not Math inputs.

### Prices and funding (`metaAndAssetCtxs`)

- The response is a `[meta, assetCtxs]` pair aligned by `universe` index. `assetCtx.oraclePx` →
  `oraclePrice`, `markPx` → `markPrice`, `impactPxs[0]` → `impactBidPrice`, `impactPxs[1]` →
  `impactAskPrice`.
- `assetCtx.funding` is already the hourly funding rate as a decimal fraction (`"0.0000125"` means
  0.00125%/hour). It is directly usable as `fundingRate` for `calculateFundingPayment` — do not
  rescale it by the 8-hour base interval; that convention is internal to the rate formula inputs.

### Fee schedule (`userFees`)

- Official naming: **`cross` is the taker rate and `add` is the maker rate.** `feeSchedule.base`
  maps as `baseRates: { makerRate: add, takerRate: cross }`; each `feeSchedule.tiers.vip[]` entry
  maps as `{ minimumWeightedVolume: ntlCutoff, makerRate: add, takerRate: cross }`.
- `userFees.userCrossRate`/`userAddRate` are the account's effective rates and can be passed directly
  as `rate` to `calculateTradeFee`.
- `feeSchedule.tiers.mm[]` (maker-fraction-cutoff market-maker rebate tiers) is not expressible in
  the volume-threshold tier model and is `not-supported`; referral and staking discounts remain Kit
  policy inputs applied to the rates before Math sees them.

### Fills and replay events (`userFills`)

- `side: "B"` → `'buy'`, `side: "A"` → `'sell'`. `px` → `price`, `sz` → `size`.
- Server `fee` sign matches Math's signed user-cost convention (positive charge, negative rebate) as
  observed on dated fills (taker `crossed: true` positive, maker rebate negative), so it may be
  passed as `fee: { kind: 'explicit', amount }` once Kit has verified the `feeToken` is the quote
  currency.
- `startPosition`, `closedPnl`, and `fee` pass verbatim into `serverFillEvidence`; Math reports
  neutral residuals rather than assuming a server formula.
- `userFills`, funding updates, transfers, and snapshots become ordered replay events only after Kit
  has backfilled, deduplicated, routed by market kind, and established completeness.
- `cashBalance` (replay/reconcile snapshots) is the account's USDC cash ledger excluding unrealized
  PnL. The recommended mapping is `marginSummary.accountValue − Σ position.unrealizedPnl` computed
  from one snapshot; whichever convention Kit picks must be applied identically to the base and
  observed snapshots, because replay projects cash as
  `base cash + realized PnL + fees + funding + transfers`.
- For Spot fees paid in base token, Kit must not assume raw fill `size` is gross or net. It may call
  `projectSpotPositionEvent` only when it has independently established the actual base inventory delta
  and quote-valued fee; otherwise the mapping is not-supported until an explicit base-fee input contract
  is sourced.

## What Kit must not infer from an `ok` result

An `ok` Math result is not an execution authorization. Kit still owns warnings, severity, blocking,
freshness, wallet/signature/nonce handling, API errors, rate limits, mutable server limits, order
submission, and reconciliation after execution. In particular:

- local max size is not the server-accepted maximum;
- a liquidation root is not a prediction of partial liquidation, backstop fill, ADL, or scheduling;
- a deterministic TWAP/Scale projection is not a fill forecast;
- HIP-1/HIP-3 experimental results do not prove deployment, collateral, or cross-margin eligibility;
- `not-evaluated` constraints must remain visible to product policy rather than being treated as
  satisfied.

Math has no network, subscription, clock, persistence, mutable cache, signing, nonce, or wire-action
mapping. Its only runtime dependency is `decimal.js`.
