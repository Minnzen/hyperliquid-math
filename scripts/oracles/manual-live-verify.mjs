#!/usr/bin/env node
// Manual live oracle verification against one public mainnet account.
//
//   node scripts/oracles/manual-live-verify.mjs <0x-address>
//
// Pulls `meta` and `clearinghouseState`, maps them into Math inputs exactly as
// documented in spec/KIT-MAPPING.md, then compares:
//   - evaluatePerpAccountMargin cross aggregates vs server crossMaintenanceMarginUsed
//     and totalMarginUsed;
//   - calculatePerpLiquidationPrice vs server liquidationPx for every position
//     that has one (0.1% relative tolerance).
//
// Marks are derived as positionValue/|szi| from the SAME clearinghouseState
// response instead of fetching metaAndAssetCtxs, deliberately trading the mapped
// markPx source for snapshot atomicity — server liquidationPx was computed against
// these marks. Float math here lives only in this diagnostic's tolerance checks,
// never in the library. Far-out-of-the-money roots are hypersensitive to
// accountValue, so a large account can show small deviations there purely from
// snapshot timing drift; near-money roots should match tightly.
//
// This script performs network I/O and is NOT part of the package or its CI.
// The package itself never fetches anything.
import { calculatePerpLiquidationPrice } from '../../dist/liquidation/index.js'
import { evaluatePerpAccountMargin } from '../../dist/margin/index.js'

const USER = process.argv[2]
if (!USER || !/^0x[0-9a-fA-F]{40}$/.test(USER)) {
  console.error('usage: node scripts/oracles/manual-live-verify.mjs <0x-address>')
  console.error('Pick any public account, e.g. from the leaderboard, with open positions.')
  process.exit(1)
}
const api = (body) =>
  fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json())

const [meta, chs] = await Promise.all([
  api({ type: 'meta' }),
  api({ type: 'clearinghouseState', user: USER }),
])

const tableById = new Map(meta.marginTables.map(([id, t]) => [id, t]))
const marketByCoin = new Map(
  meta.universe.map((u, i) => [
    u.name,
    {
      index: i,
      marginTiers: (
        tableById.get(u.marginTableId)?.marginTiers ?? [
          { lowerBound: '0', maxLeverage: u.maxLeverage },
        ]
      ).map((t) => ({ lowerBound: t.lowerBound, maxLeverage: String(t.maxLeverage) })),
    },
  ]),
)

const rows = chs.assetPositions.map(({ position: p }) => {
  const mkt = marketByCoin.get(p.coin)
  const abs = Math.abs(Number(p.szi))
  const markPrice = (Number(p.positionValue) / abs).toString()
  const asset = { network: 'mainnet', marketKind: 'perp', dex: null, index: mkt.index }
  const marginMode = { kind: p.leverage.type === 'cross' ? 'cross' : 'isolated' }
  return {
    coin: p.coin,
    serverLiqPx: p.liquidationPx,
    serverMarginUsed: p.marginUsed,
    marginPos: {
      asset,
      signedSize: p.szi,
      markPrice,
      leverage: String(p.leverage.value),
      marginMode,
      marginTiers: mkt.marginTiers,
    },
    liqPos: {
      asset,
      signedSize: p.szi,
      entryPrice: p.entryPx,
      markPrice,
      marginMode,
      marginTiers: mkt.marginTiers,
    },
  }
})

const margin = evaluatePerpAccountMargin({
  crossAccountValue: chs.crossMarginSummary.accountValue,
  positions: rows.map((r) => r.marginPos),
})
console.log('=== evaluatePerpAccountMargin:', margin.value.status)
if (margin.value.status === 'ok') {
  const d = margin.value.data
  console.log('local  crossMaintenanceMargin   :', d.cross.maintenanceMargin.slice(0, 16))
  console.log('server crossMaintenanceMarginUsed:', chs.crossMaintenanceMarginUsed)
  console.log('local  crossInitialMargin(sum)  :', d.cross.initialMargin.slice(0, 16))
  console.log('server totalMarginUsed          :', chs.marginSummary.totalMarginUsed)
}

let pass = 0,
  fail = 0,
  skipped = 0
const diffs = []
for (const r of rows) {
  if (r.serverLiqPx == null) {
    skipped++
    continue
  }
  const res = calculatePerpLiquidationPrice({
    targetAsset: r.liqPos.asset,
    crossAccountValue: chs.crossMarginSummary.accountValue,
    positions: rows.map((q) => q.liqPos),
  })
  if (res.value.status !== 'ok') {
    console.log(r.coin, 'NOT-OK:', JSON.stringify(res.value).slice(0, 200))
    fail++
    continue
  }
  const local = Number(res.value.data.liquidationPrice)
  const server = Number(r.serverLiqPx)
  const relDiff = Math.abs(local - server) / server
  if (relDiff < 0.001) pass++
  else {
    fail++
    diffs.push(
      `DIFF ${r.coin.padEnd(8)} local=${local.toPrecision(10)} server=${server} rel=${relDiff.toExponential(2)}`,
    )
  }
}
for (const d of diffs.slice(0, 8)) console.log(d)
console.log(
  `\n=== liquidationPx: ${pass} pass / ${fail} fail / ${skipped} no-server-value (rel tolerance 0.1%)`,
)
