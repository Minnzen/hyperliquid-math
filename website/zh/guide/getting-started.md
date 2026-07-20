# 快速开始

`hyperliquid-math` 从 plain data 确定性地计算 Hyperliquid 各类数值。它不碰网络：**取数和映射是你的
代码**，这个包只负责计算，返回 `{ value, trace }`。

## 安装

```sh
npm install hyperliquid-math    # 或 pnpm / yarn / bun
```

纯 ESM。Node ≥ 22（也可在浏览器运行——CI 验证 Chromium 下字节级一致）。

## 60 秒算出清算价

这个包只负责计算；取数和映射是你的代码。逐字段映射规则见
[字段映射](./field-mapping)——下面的例子是真实可跑、对过主网的：

```ts
import { calculatePerpLiquidationPrice } from 'hyperliquid-math/liquidation'
import { quantizePrice } from 'hyperliquid-math/precision'

const info = (body: object) =>
  fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json())

const user = '0x…' // 任意地址
const [meta, state] = await Promise.all([
  info({ type: 'meta' }),
  info({ type: 'clearinghouseState', user }),
])

// 官方字段 → Math 输入（number 转字符串；对象逐字段重建）
// cross 清算价取决于整个账户，所以要映射全部仓位
const tables = new Map(meta.marginTables.map(([id, t]) => [id, t.marginTiers]))
const indexByCoin = new Map(meta.universe.map((u, i) => [u.name, i]))
const toPosition = ({ position: p }) => {
  const i = indexByCoin.get(p.coin)
  return {
    asset: { network: 'mainnet', marketKind: 'perp', dex: null, index: i },
    signedSize: p.szi,                       // 自带符号；负数 = 空头
    entryPrice: p.entryPx,
    markPrice: String(Number(p.positionValue) / Math.abs(Number(p.szi))),
    marginMode: { kind: 'cross' }, // isolated 仓位映射不同——见「字段映射」
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
    value: result.value.data.liquidationPrice,   // 全精度，如 '57620.2531645569…'
    marketKind: 'perp',
    szDecimals: meta.universe[i].szDecimals,
    rounding: 'down',
  })
  console.log('清算价:', display.value.status === 'ok' && display.value.data.value)
  console.log('距清算的相对距离:', result.value.data.adverseDistanceRatio)
}
```

## 统一契约

所有函数遵循同一契约——plain data 进、`{ value, trace }` 出，永不 throw：

```ts
value.status === 'ok'              // → value.data
value.status === 'invalid-input'   // → value.issues: [{ code, path, actual, expected }]
value.status === 'not-applicable'  // → 数学上无解（如零仓位）
value.status === 'indeterminate'   // → 声明的规则不完整
```

错误信息可“自愈”——`expected` 直接告诉你正确的 key 列表或格式，大多数映射错误看一眼报错就能改对。

## 下一步

- [字段映射](./field-mapping) —— 把官方 API 响应逐字段映射成 Math 输入（英文）。
- [错误处理与单位](./error-handling) —— 完整的结果契约与单位约定。
- [公式索引](/reference/) —— 每个公开函数、公式与 oracle 覆盖状态（英文）。
- [面向 AI Agent](./for-ai-agents) —— 给编码 agent 的精简指南（英文）。
