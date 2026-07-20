# 错误处理与单位

每个公开函数都自行校验 plain-data 输入、永不 throw，返回 `{ value, trace }`。本页完整说明结果契约，
以及所有输入输出遵循的单位约定。

## 结果契约

```ts
value.status === 'ok'              // → value.data
value.status === 'invalid-input'   // → value.issues: [{ code, path, actual, expected }]
value.status === 'not-applicable'  // → 输入合法，但此状态下数学上无值（如零仓位）
value.status === 'indeterminate'   // → 该输入下某条声明的规则不完整
```

- `ok` 表示声明的公式已完成。`value.data` 内部的 constraint check 仍可能报告 violated 或 not-evaluated
  状态——要去读它，而不是把 `ok` 当成可以直接执行的授权。
- `invalid-input` 的 issue 带 `{ code, path, actual, expected }`。`expected` 直接给出正确的 key 列表或
  格式，答案就在报错里。按它重建出问题的字段，不要盲目重试。
- `not-applicable` 和 `indeterminate` 是答案，不是失败。`not-applicable` 表示该状态确实没有值；
  `indeterminate` 表示在支持的证据或假设下无法确定唯一结果。两者都不该重试。

## 取整由你决定

输出是全精度 decimal 字符串（至多 40 位有效数字）。在你告诉它取整方向之前，这个包拒绝替你取整。
展示价格或下单前，先量化：

```ts
quantizePrice({ value, marketKind, szDecimals, rounding })
```

取整方向永远对用户保守——买单选 `'down'`，卖单选 `'up'`。你选的方向会被记录进 trace，决策始终可审计。

## 单位约定

- **钱永远是 decimal 字符串。** `'1.25'`，不是 `1.25`。少数官方 JSON number（`maxLeverage`、
  `leverage.value`）用 `String()` 转换。整数计数（`index`、`szDecimals`、`weiDecimals`、`timestampMs`、
  tier 下标）保持 number。
- **费率处处是 decimal 分数。** `'0.00045'` = 4.5 bps = 0.045%。以 basis point 计的字段会在名字里标明
  （`slippageBps`、`spreadBps`）。
- **时间戳是毫秒安全整数**（`timestampMs`、`durationMs`）。
- **费用是带符号的用户成本：** 正 = 用户付出，负 = 返佣。
- **Funding 的 `payment`：** 正 = 仓位付出。`accountValueDelta = -payment`。
- **尺寸：** `signedSize` 描述一个仓位（负数 = 空头）；`size` 恒为正，与 `side: 'buy' | 'sell'` 配对。

## 这个包不替你决定什么

`hyperliquid-math` 返回 values、constraint checks、assumptions 和 trace。它不判断严重级别、告警、拦截或
新鲜度，也不 fetch、不签名、不提交。服务器权威的值——生效费率档位、最终 funding 结算、清算执行——只作为
输入或对照证据，永远不是输出。这些属于你的策略层和传输层。完整边界见
[字段映射](./field-mapping)。
