#!/usr/bin/env node
import { Decimal40 } from '../../dist/core/decimal.js'
import { calculatePerpLiquidationPrice } from '../../dist/liquidation/index.js'
import { evaluatePerpAccountMargin } from '../../dist/margin/index.js'

// Manual live oracle verification against one public mainnet account.
//
//   node scripts/oracles/manual-live-verify.mjs <0x-address> --standard-account
//
// Pulls `metaAndAssetCtxs` and `clearinghouseState`, maps them into Math inputs exactly as
// documented in spec/KIT-MAPPING.md, then compares:
//   - evaluatePerpAccountMargin cross aggregates vs server crossMaintenanceMarginUsed
//     and crossMarginSummary.totalMarginUsed;
//   - calculatePerpLiquidationPrice vs server liquidationPx for every cross position
//     that has one (0.1% relative tolerance).
//
// Marks come from the official metaAndAssetCtxs response. The two requests are issued
// together but are not an atomic server snapshot, so far-out-of-the-money roots can
// still move with snapshot timing. All comparisons use Decimal40; diagnostic math
// never converts financial values through JavaScript Number.
//
// This script performs network I/O and is used only by the scheduled/manual
// Reliability - Live Differential workflow, never by the published package.
// The package itself never fetches anything.

const MARGIN_ABSOLUTE_TOLERANCE = new Decimal40('0.000001')
const LIQUIDATION_RELATIVE_TOLERANCE = new Decimal40('0.001')

const USER = process.argv[2]
const ACCOUNT_MODE_ASSERTION = process.argv[3]
if (!USER || !/^0x[0-9a-fA-F]{40}$/.test(USER) || ACCOUNT_MODE_ASSERTION !== '--standard-account') {
  console.error(
    'usage: node scripts/oracles/manual-live-verify.mjs <0x-address> --standard-account',
  )
  console.error(
    'This verifier supports only standard-mode accounts with cross positions; unified and portfolio margin require different aggregation.',
  )
  process.exit(1)
}
const api = (body) =>
  fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((response) => {
    if (!response.ok) throw new Error(`${body.type} returned HTTP ${response.status}`)
    return response.json()
  })

const [[meta, ctxs], chs] = await Promise.all([
  api({ type: 'metaAndAssetCtxs' }),
  api({ type: 'clearinghouseState', user: USER }),
])

const tableById = new Map(meta.marginTables.map(([id, t]) => [id, t]))
const marketByCoin = new Map(
  meta.universe.map((u, i) => [
    u.name,
    {
      index: i,
      markPrice: ctxs[i]?.markPx,
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
  if (!mkt || typeof mkt.markPrice !== 'string') {
    throw new Error(`missing market metadata or mark price for ${p.coin}`)
  }
  const asset = { network: 'mainnet', marketKind: 'perp', dex: null, index: mkt.index }
  const isCross = p.leverage.type === 'cross'
  if (!isCross) {
    return {
      coin: p.coin,
      isCross,
      serverLiqPx: p.liquidationPx,
    }
  }
  const marginMode = { kind: 'cross' }
  return {
    coin: p.coin,
    isCross,
    serverLiqPx: p.liquidationPx,
    marginPos: {
      asset,
      signedSize: p.szi,
      markPrice: mkt.markPrice,
      leverage: String(p.leverage.value),
      marginMode,
      marginTiers: mkt.marginTiers,
    },
    liqPos: {
      asset,
      signedSize: p.szi,
      entryPrice: p.entryPx,
      markPrice: mkt.markPrice,
      marginMode,
      marginTiers: mkt.marginTiers,
    },
  }
})

const crossRows = rows.filter((row) => row.isCross)
if (crossRows.length === 0) {
  console.error('standard-account live differential requires at least one cross position')
  process.exit(1)
}
const margin = evaluatePerpAccountMargin({
  crossAccountValue: chs.crossMarginSummary.accountValue,
  positions: crossRows.map((row) => row.marginPos),
})
console.log('=== evaluatePerpAccountMargin:', margin.value.status)
let marginPass = 0
let marginFail = 0
const compareMargin = (label, localValue, serverValue) => {
  const difference = new Decimal40(localValue).minus(serverValue).abs()
  if (difference.lte(MARGIN_ABSOLUTE_TOLERANCE)) {
    marginPass++
    return
  }
  marginFail++
  console.log(`DIFF ${label} local=${localValue} server=${serverValue} abs=${difference.toFixed()}`)
}
if (margin.value.status === 'ok') {
  const d = margin.value.data
  compareMargin('crossMaintenanceMargin', d.cross.maintenanceMargin, chs.crossMaintenanceMarginUsed)
  compareMargin('crossInitialMargin', d.cross.initialMargin, chs.crossMarginSummary.totalMarginUsed)
} else {
  marginFail += 2
  console.log('margin NOT-OK:', JSON.stringify(margin.value).slice(0, 400))
}
console.log(
  `=== margin aggregates: ${marginPass} pass / ${marginFail} fail (absolute tolerance ${MARGIN_ABSOLUTE_TOLERANCE.toFixed()})`,
)

let pass = 0,
  fail = 0,
  skipped = 0,
  unsupportedIsolated = 0
const diffs = []
for (const r of rows) {
  if (!r.isCross) {
    unsupportedIsolated++
    continue
  }
  if (r.serverLiqPx == null) {
    skipped++
    continue
  }
  const res = calculatePerpLiquidationPrice({
    targetAsset: r.liqPos.asset,
    crossAccountValue: chs.crossMarginSummary.accountValue,
    positions: crossRows.map((row) => row.liqPos),
  })
  if (res.value.status !== 'ok') {
    console.log(r.coin, 'NOT-OK:', JSON.stringify(res.value).slice(0, 200))
    fail++
    continue
  }
  const local = new Decimal40(res.value.data.liquidationPrice)
  const server = new Decimal40(r.serverLiqPx)
  const relDiff = server.isZero()
    ? local.isZero()
      ? new Decimal40(0)
      : new Decimal40(Infinity)
    : local.minus(server).abs().div(server.abs())
  if (relDiff.lt(LIQUIDATION_RELATIVE_TOLERANCE)) pass++
  else {
    fail++
    diffs.push(
      `DIFF ${r.coin.padEnd(8)} local=${local.toFixed()} server=${server.toFixed()} rel=${relDiff.toSignificantDigits(4).toString()}`,
    )
  }
}
for (const d of diffs.slice(0, 8)) console.log(d)
console.log(
  `\n=== liquidationPx: ${pass} pass / ${fail} fail / ${skipped} no-server-value / ${unsupportedIsolated} isolated-not-supported (relative tolerance 0.1%)`,
)

if (marginFail > 0 || fail > 0) process.exitCode = 1
