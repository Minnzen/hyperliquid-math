<h1 align="center">hyperliquid-math</h1>

<p align="center">
  Deterministic Hyperliquid math on plain decimal strings.<br>
  No network I/O; every result carries a calculation trace.
</p>

<p align="center">
  <a href="https://github.com/Minnzen/hyperliquid-math/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Minnzen/hyperliquid-math/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="coverage" src="https://img.shields.io/badge/coverage-100%25_lines%20·%20branches%20·%20functions-brightgreen">
  <img alt="runtime deps" src="https://img.shields.io/badge/runtime_deps-1_(decimal.js)-blue">
  <img alt="network I/O" src="https://img.shields.io/badge/network_I%2FO-zero-blue">
  <img alt="types" src="https://img.shields.io/badge/types-included-3178c6">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-green">
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="https://minnzen.github.io/hyperliquid-math/">Documentation</a> ·
  <a href="spec/CONSUMER-INTEGRATION.md">Consumer integration</a> ·
  <a href="spec/README.md">Formula manual</a> ·
  <a href="SKILL.md">AI-agent guide</a>
</p>

---

## What it does

- **Exact decimal arithmetic.** Every value is a decimal string; arithmetic runs on 40-significant-digit
  decimals, and quantization rounds in the direction that is conservative for the user — down for size and
  buy prices, up for sell prices. Monetary values never pass through floating point.
- **A trace on every result.** Each function returns `{ value, trace }`. The trace records the normalized
  inputs, the formula and source IDs, each rounding decision, and each assumption, so any output can be
  traced back to the rule it came from.
- **Covers the derived formulas.** Liquidation-price root solving across margin tiers (with maintenance
  deductions and backstop thresholds), account margin evaluation, PnL attribution, funding, fees, order
  previews, TWAP/scale schedules, ledger replay, spot units, HIP-1/HIP-3 constraints, HIP-4 outcome
  projection, and the documented unified-account monitoring ratio.
- **Evidence is explicit, not blanket parity.** The runtime source is held at 100% test coverage. A pinned
  official Python SDK supplies four declared partial oracle slices; dated live fixtures supply 24 partial
  slices. The remaining slices are recorded as `not-supported`, and none is labeled full server-formula
  parity. A [scheduled/manual live comparison](scripts/oracles/manual-live-verify.mjs) fails on standard-mode
  cross-margin aggregate or liquidation-price differences instead of silently reporting them.

## Install

```sh
npm install hyperliquid-math
```

Also available through pnpm, yarn, and bun. The package is ESM-only and requires Node ≥ 22 (it also
runs in browsers — CI verifies byte-identical results in Chromium).

For a source checkout, use `pnpm install --frozen-lockfile && pnpm build`.

## Example: computing a liquidation price

The package computes; **you** fetch, establish the account abstraction mode, and map. Field-by-field
mapping is documented in [`spec/KIT-MAPPING.md`](spec/KIT-MAPPING.md). This example is deliberately
limited to a standard-mode account whose open positions are all cross margin. Unified and portfolio
margin require different account aggregation; isolated positions require independently proven
per-position isolated margin:

```ts
import { calculatePerpLiquidationPrice } from 'hyperliquid-math/liquidation'
import { quantizePrice } from 'hyperliquid-math/precision'

const info = async (body: object) => {
  const response = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Hyperliquid info returned HTTP ${response.status}`)
  return response.json()
}

const user = '0x…' // a standard-mode address with cross positions
const accountMode = getAccountModeFromYourConfiguration(user) // consumer-owned, not inferred here
if (accountMode !== 'standard') {
  throw new Error('this example does not map unified or portfolio-margin accounts')
}
const [[meta, ctxs], state] = await Promise.all([
  info({ type: 'metaAndAssetCtxs' }),   // [meta, assetCtxs] aligned by universe index
  info({ type: 'clearinghouseState', user }),
])

// Map official fields -> Math inputs (numbers become strings; objects are rebuilt exactly).
// A cross liquidation price depends on the WHOLE per-DEX cross account.
const tables = new Map(meta.marginTables.map(([id, t]) => [id, t.marginTiers]))
const indexByCoin = new Map(meta.universe.map((u, i) => [u.name, i]))
const toPosition = ({ position: p }) => {
  if (p.leverage.type !== 'cross') {
    throw new Error('isolated positions require independently proven isolatedMarginValue')
  }
  const i = indexByCoin.get(p.coin)
  if (i === undefined || meta.universe[i] === undefined || ctxs[i] === undefined) {
    throw new Error(`missing market metadata for ${p.coin}`)
  }
  return {
    asset: { network: 'mainnet', marketKind: 'perp', dex: null, index: i },
    signedSize: p.szi,                       // already signed; negative = short
    entryPrice: p.entryPx,
    markPrice: ctxs[i].markPx,               // official mark, already a decimal string
    marginMode: { kind: 'cross' },
    // Low-numbered marginTableIds are implicit single-tier tables absent from marginTables.
    marginTiers: (
      tables.get(meta.universe[i].marginTableId) ??
      [{ lowerBound: '0', maxLeverage: meta.universe[i].maxLeverage }]
    ).map((t) => ({ lowerBound: t.lowerBound, maxLeverage: String(t.maxLeverage) })),
  }
}

const coin = 'BTC'
const i = indexByCoin.get(coin)
if (i === undefined || meta.universe[i] === undefined) {
  throw new Error(`missing market metadata for ${coin}`)
}
const result = calculatePerpLiquidationPrice({
  targetAsset: { network: 'mainnet', marketKind: 'perp', dex: null, index: i },
  crossAccountValue: state.crossMarginSummary.accountValue,
  positions: state.assetPositions.map(toPosition),
})

if (result.value.status === 'ok') {
  const display = quantizePrice({
    value: result.value.data.liquidationPrice,   // full precision, e.g. '57620.2531645569…'
    marketKind: 'perp',
    szDecimals: meta.universe[i].szDecimals,
    rounding: 'down',
  })
  console.log('liquidation price:', display.value.status === 'ok' && display.value.data.value)
  console.log('distance to liq:', result.value.data.adverseDistanceRatio)
}
```

Every function follows the same contract — plain-data in, `{ value, trace }` out, and it never
throws:

```ts
value.status === 'ok'              // → value.data
value.status === 'invalid-input'   // → value.issues: [{ code, path, actual, expected }]
value.status === 'not-applicable'  // → the math has no answer here (e.g. flat position)
value.status === 'indeterminate'   // → a declared rule was incomplete
```

Validation errors are specific — the `expected` field states the exact keys or format required, so most
mapping mistakes are clear from the first error.

## What's inside

| Subpath | Functions |
| --- | --- |
| `/precision` | `canonicalizeDecimalString` · `quantizePrice` · `quantizeSize` |
| `/identifiers` | `deriveCanonicalAssetKey` · `encodeAssetId` · `decodeAssetId` (including outcome asset IDs) |
| `/hip4` | `calculateOutcomeDualPrice` · `calculateOutcomeSettlement` · `evaluateRecurringOutcome` |
| `/orderbook` | `calculateBookMetrics` · `simulateBookFill` |
| `/fees` | `calculateTradeFee` · `calculateWeightedFeeVolume` · `selectFeeTier` |
| `/positions` | `calculatePerpUnrealizedPnl` · `projectPerpFill` · `projectPerpFillSequence` · `calculatePerpBreakEvenPrice` |
| `/funding` | `calculateFundingPremiumIndex` · `calculateFundingRate` · `calculateFundingPayment` · `annualizeFundingRate` |
| `/margin` | `calculatePerpInitialMargin` · `calculatePerpMaintenanceMargin` · `evaluatePerpAccountMargin` · `calculateUnifiedAccountRatio` |
| `/liquidation` | `calculatePerpLiquidationPrice` |
| `/scenarios` | `simulatePerpAccountScenario` |
| `/orders` | `validatePerpOrder` · `calculatePerpMaxOrderSize` · `evaluatePerpReduceOnly` · `calculatePerpSlippagePrice` · `classifyPerpTrigger` · `derivePerpTriggerPrice` · `buildPerpScaleLadder` · `calculatePerpTwapExecutionTarget` |
| `/reconciliation` | `replayPerpAccountEvents` · `reconcilePerpAccountSnapshot` |
| `/spot` | `convertSpotTokenUnits` · `calculateSpotOrderDeltas` · `projectSpotPositionEvent` · `calculateSpotPortfolioValue` · `evaluateSpotDustEligibility` · `projectSpotDustAllocation` |
| `/hip1` | `validateHip1Deployment` · `evaluateHip1AnchorGenesisEligibility` |
| `/hip3` | `resolveHip3CollateralSource` · `evaluateHip3MarginMode` · `calculateHip3FeeRates` |

Formulas, derivations, 49 hand-checkable worked examples, and per-function oracle coverage live in
the [spec manual](spec/README.md), which ships inside the package.

## The boundary

```mermaid
flowchart LR
    A["Official API responses<br/>(you fetch)"] --> B["Your mapping<br/>(spec/KIT-MAPPING.md)"]
    B --> C["hyperliquid-math<br/>pure · deterministic · traced"]
    C --> D["{ value, trace }"]
    D --> E["Your policy layer<br/>display · warnings · signing · submission"]
```

This package deliberately does **not**: fetch, cache, sign, or submit anything; decide freshness,
severity, or blocking policy; or predict server acceptance, queue position, actual fills,
liquidation execution, or ADL. Server-authoritative values (effective fee tier, final funding
settlements) are inputs or comparison evidence, never outputs. The full statement of what stays on
your side of the line is in [`spec/KIT-MAPPING.md`](spec/KIT-MAPPING.md).

## FAQ

**What do I put in `dex`?** The official builder-dex name from `perpDexs` (`'xyz'`, `'flx'`, …), or
`null` for the first-party dex — which is what you want for BTC, ETH, and every standard perp.
Spot is always `null`.

**Why are outputs 40-digit strings?** Because the package refuses to round until you tell it how.
Pass results through `quantizePrice`/`quantizeSize` for display or order construction; the rounding
direction is then recorded in the trace.

**Why decimal strings instead of numbers?** `0.1 + 0.2 !== 0.3` is not a property you want in a
liquidation price. Official responses already use strings for most money fields; the few JSON
numbers (`maxLeverage`, `leverage.value`) convert with `String()`.

**Node < 22?** The library targets Node 22+ for CI-verified determinism guarantees; it has no
runtime APIs beyond ES2023 + `decimal.js`, so older ESM-capable runtimes will typically work, but
they're outside the tested envelope.

## License

MIT © Zen
