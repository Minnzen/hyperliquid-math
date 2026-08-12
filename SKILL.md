---
name: hyperliquid-math
description: Use when computing Hyperliquid values locally — margin, liquidation price, PnL, funding, fees, order previews, spot/HIP-3/HIP-4 math, and unified-account ratios — from official API responses. Covers input construction rules, official-field mapping, and error recovery for the hyperliquid-math npm package.
---

# hyperliquid-math — agent guide

Deterministic Hyperliquid math on plain data. No network I/O, no floats, one runtime dependency
(`decimal.js`). Every public function validates its input, never throws, and returns
`{ value, trace }` where `value.status` is `'ok' | 'invalid-input' | 'not-applicable' | 'indeterminate'`.

```ts
import { calculatePerpLiquidationPrice } from 'hyperliquid-math/liquidation'
const { value, trace } = calculatePerpLiquidationPrice(input)
if (value.status === 'ok') use(value.data.liquidationPrice)
```

## Five rules that prevent 90% of errors

1. **Money is always a decimal string.** `'1.25'`, never `1.25`. Official responses mix strings and
   JSON numbers — convert numbers (`maxLeverage`, `leverage.value`) with `String()`. Integer counts
   (`index`, `szDecimals`, `weiDecimals`, `timestampMs`) stay numbers.
2. **Rebuild official response objects; don't pass them through.** Inputs validate exact key sets;
   extra keys (`cumFunding`, `coin`, `time`, …) are rejected. Rebuild every input object field by
   field. Sole exception: official `l2Book` level rows `{ px, sz, n }` are already the exact input
   shape (strip the outer `coin`/`time` wrapper).
3. **Asset identity is `{ network, marketKind, dex, index }`.** `dex` is the official builder-dex
   name from `perpDexs` (`'xyz'`), or `null` for the first-party dex (BTC, ETH, …). `index` is the
   market's position in that dex's `meta.universe`. The same asset must use the identical ref
   everywhere within one call — it is a join key, nothing more.
4. **Outputs are full-precision (up to 40 significant digits).** Before showing a price to a user or
   putting it in an order, quantize it: `quantizePrice({ value, marketKind, szDecimals, rounding })`.
   Rounding direction is always chosen against the user's favor — pick `'down'` for buys, `'up'`
   for sells.
5. **Read the error, it tells you the fix.** `invalid-input` issues carry
   `{ code, path, actual, expected }` — `expected` states the exact keys or format required.
   `not-applicable` means the math has no answer for this input (e.g. flat position);
   `indeterminate` means a declared rule is incomplete. Neither is a failure to retry.

## Official API → input mapping (the glue you must write)

| You have (official) | You build (Math input) |
| --- | --- |
| `perpDexs[]` entry name / `null` | `dex` (pass `null` for first-party; `''` is normalized to `null`) |
| `meta.universe[i]` | `index: i`, `szDecimals`, `String(maxLeverage)` |
| `meta.marginTables` `[id, {marginTiers}]` pairs, joined via `universe[i].marginTableId` | `marginTiers: [{ lowerBound, maxLeverage: String(t.maxLeverage) }, …]` in order; **IDs absent from the pairs** (low-numbered) mean a single-tier schedule `[{ lowerBound: '0', maxLeverage: String(u.maxLeverage) }]` |
| `universe[i].marginMode === 'strictIsolated'` | `marginRemoval: 'strict'`; otherwise `'allowed'` |
| `position.szi` | `signedSize` (already signed; negative = short) |
| `position.entryPx` | `entryPrice` |
| `assetCtxs[i].markPx` | `markPrice` |
| `position.leverage.value` | `leverage: String(value)` |
| `crossMarginSummary.accountValue` (NOT `marginSummary`) | `crossAccountValue` |
| `marginSummary.accountValue − crossMarginSummary.accountValue` (single isolated position) | `isolatedMarginValue` |
| per-DEX `meta.collateralToken` | unified `collateralToken` |
| per-DEX top-level `crossMaintenanceMarginUsed` | unified `crossMaintenanceMarginUsed` |
| sum of isolated `position.marginUsed` strings | unified `isolatedMarginUsed` |
| `spotClearinghouseState.balances[].token` / `.total` | unified `spotBalances[].token` / `.total` |
| outcome ID plus numeric side from one `outcomeMeta` snapshot | `{ kind: 'outcome', outcome, side }`; resolve semantic Yes/No separately from `sideSpecs` |
| `assetCtxs[i].funding` (already hourly, decimal fraction) | `fundingRate` — do NOT multiply/divide by 8 |
| `assetCtxs[i].impactPxs[0]` / `[1]` | `impactBidPrice` / `impactAskPrice` |
| `feeSchedule` `cross` / `add` / `ntlCutoff` | `takerRate` / `makerRate` / `minimumWeightedVolume` (`cross`=taker, `add`=maker) |
| fill `side: 'B'` / `'A'` | `'buy'` / `'sell'` |
| fill `px` / `sz` / `fee` | `price` / `size` / `fee: { kind: 'explicit', amount: fee }` (sign already matches: positive = charge) |
| fill `startPosition`, `closedPnl`, `fee` | `serverFillEvidence` verbatim |
| `marginSummary.accountValue − Σ unrealizedPnl` | `cashBalance` (replay snapshots; apply the same convention to both snapshots) |

Coin-string routing before replay: bare `"BTC"` = first-party perp, `"@N"` = spot pair index N,
`"xyz:COIN"` = HIP-3 perp on dex `xyz`. Perp functions accept perp rows only.

For unified ratio inputs, aggregate strings with decimal arithmetic, never JavaScript numbers. Missing
referenced Spot rows are `invalid-input`; occupied collateral with non-positive available balance is
`indeterminate`; zero-occupation collateral has ratio `"0"` without division. These fail-closed rules
are deliberate and differ from the official float reference.

The full mapping contract with evidence citations is `spec/KIT-MAPPING.md` in the installed package.

## Function index (by subpath)

- `hyperliquid-math/precision` — `canonicalizeDecimalString`, `quantizePrice`, `quantizeSize`
- `hyperliquid-math/identifiers` — `deriveCanonicalAssetKey`, `encodeAssetId`, `decodeAssetId`
  (including outcome asset IDs; numeric side does not imply a Yes/No label)
- `hyperliquid-math/hip4` — `calculateOutcomeDualPrice`, `calculateOutcomeSettlement`,
  `evaluateRecurringOutcome` (`priceBinary` and three-bucket `priceBucket`)
- `hyperliquid-math/orderbook` — `calculateBookMetrics`, `simulateBookFill` (frozen snapshot only)
- `hyperliquid-math/fees` — `calculateTradeFee`, `calculateWeightedFeeVolume`, `selectFeeTier`
- `hyperliquid-math/positions` — `calculatePerpUnrealizedPnl`, `projectPerpFill`,
  `projectPerpFillSequence`, `calculatePerpBreakEvenPrice`
- `hyperliquid-math/funding` — `calculateFundingPremiumIndex`, `calculateFundingRate`,
  `calculateFundingPayment`, `annualizeFundingRate`
- `hyperliquid-math/margin` — `calculatePerpInitialMargin`, `calculatePerpMaintenanceMargin`,
  `evaluatePerpAccountMargin`, `calculateUnifiedAccountRatio`
- `hyperliquid-math/liquidation` — `calculatePerpLiquidationPrice` (tier-consistent root solving,
  cross and isolated, backstop price)
- `hyperliquid-math/scenarios` — `simulatePerpAccountScenario` (what-if fills / leverage / margin
  actions; results marked `experimental`, `protocolSupport: 'unverified'`)
- `hyperliquid-math/orders` — `validatePerpOrder`, `calculatePerpMaxOrderSize`,
  `evaluatePerpReduceOnly`, `calculatePerpSlippagePrice`, `classifyPerpTrigger`,
  `derivePerpTriggerPrice`, `buildPerpScaleLadder`, `calculatePerpTwapExecutionTarget`
- `hyperliquid-math/reconciliation` — `replayPerpAccountEvents`, `reconcilePerpAccountSnapshot`
- `hyperliquid-math/spot` — `convertSpotTokenUnits`, `calculateSpotOrderDeltas`,
  `projectSpotPositionEvent`, `calculateSpotPortfolioValue`, `evaluateSpotDustEligibility`,
  `projectSpotDustAllocation`
- `hyperliquid-math/hip1` — `validateHip1Deployment`, `evaluateHip1AnchorGenesisEligibility`
- `hyperliquid-math/hip3` — `resolveHip3CollateralSource`, `evaluateHip3MarginMode`,
  `calculateHip3FeeRates` (plus 14 re-exports for collateral-denominated use: positions, fees,
  margin, liquidation, scenario, and funding payment/annualize — the standard-perp funding
  premium/rate formulas are deliberately excluded; exact list in spec/hip3.md)

Per-function formulas, worked examples, and oracle coverage: `spec/README.md` (shipped in the
package) — 49 hand-checkable examples in `spec/WORKED-EXAMPLES.md`.

## Unit conventions

- Rates are decimal fractions everywhere: `'0.00045'` = 4.5 bps = 0.045%. Fields carrying bps say
  so in their name (`slippageBps`, `spreadBps`).
- Timestamps are millisecond safe integers (`timestampMs`, `durationMs`).
- Fees are signed user cost: positive = user pays, negative = rebate.
- `payment` in funding: positive = position pays. `accountValueDelta = -payment`.
- Sizes: `signedSize` (position, negative = short) vs `size` (always positive, with
  `side: 'buy' | 'sell'`).

## What this package will not do

No fetching, signing, or submitting; no freshness checks; no severity/warning policy; no prediction
of server acceptance, queue position, or actual fills. Server-authoritative things (effective fee
tier, final funding settlement, liquidation execution) are inputs or comparison evidence, never
outputs. If you need those, they belong in your transport/policy layer.
