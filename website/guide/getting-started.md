# Getting Started

`hyperliquid-math` computes deterministic Hyperliquid values from plain data. It never touches the
network: **you** fetch and map; the package computes and returns `{ value, trace }`.

## Install

```sh
npm install hyperliquid-math    # or pnpm / yarn / bun
```

ESM-only. Node ≥ 22 (also runs in browsers — CI verifies byte-identical results in Chromium).

## Sixty seconds to a liquidation price

The package computes; you fetch and map. Field-by-field mapping is documented in
[Field Mapping](./field-mapping) — this example is the real thing, verified against mainnet:

```ts
import { calculatePerpLiquidationPrice } from 'hyperliquid-math/liquidation'
import { quantizePrice } from 'hyperliquid-math/precision'

const info = (body: object) =>
  fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json())

const user = '0x…' // any address
const [meta, state] = await Promise.all([
  info({ type: 'meta' }),
  info({ type: 'clearinghouseState', user }),
])

// Map official fields -> Math inputs (numbers become strings; objects are rebuilt exactly).
// A cross liquidation price depends on the WHOLE account, so map every position.
const tables = new Map(meta.marginTables.map(([id, t]) => [id, t.marginTiers]))
const indexByCoin = new Map(meta.universe.map((u, i) => [u.name, i]))
const toPosition = ({ position: p }) => {
  const i = indexByCoin.get(p.coin)
  return {
    asset: { network: 'mainnet', marketKind: 'perp', dex: null, index: i },
    signedSize: p.szi,                       // already signed; negative = short
    entryPrice: p.entryPx,
    markPrice: String(Number(p.positionValue) / Math.abs(Number(p.szi))),
    marginMode: { kind: 'cross' }, // isolated positions map differently — see Field Mapping
    marginTiers: tables
      .get(meta.universe[i].marginTableId)
      .map((t) => ({ lowerBound: t.lowerBound, maxLeverage: String(t.maxLeverage) })),
  }
}

const coin = 'BTC'
const i = indexByCoin.get(coin)
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

## The universal contract

Every function follows the same contract — plain data in, `{ value, trace }` out, and it never
throws:

```ts
value.status === 'ok'              // → value.data
value.status === 'invalid-input'   // → value.issues: [{ code, path, actual, expected }]
value.status === 'not-applicable'  // → the math has no answer here (e.g. flat position)
value.status === 'indeterminate'   // → a declared rule was incomplete
```

Error messages are self-healing — `expected` states the exact keys or format required, so most
mapping mistakes fix themselves on the first read.

## Next steps

- [Field Mapping](./field-mapping) — turn official API responses into Math inputs, field by field.
- [Error Handling & Units](./error-handling) — the result contract and unit conventions in full.
- [Formula Index](/reference/) — every public function, its formula, and its oracle coverage.
- [For AI Agents](./for-ai-agents) — the compact guide for coding agents.
