---
'hyperliquid-math': minor
---

Replace `calculatePerpTwapSchedule` with `calculatePerpTwapExecutionTarget`. This is an intentional
breaking 0.x contract change: callers must supply `elapsedMs` and consume one cumulative execution
target; the package no longer claims a fixed 30-second child schedule, catch-up size, or slippage
field. Growth-mode HIP-3 fee scales above `1` and below `10` now return `indeterminate` because the
current official Fees and deployer-action documents conflict.
