---
"hyperliquid-math": minor
---

Add HIP-4 outcome pricing, settlement, and recurring-outcome math; support outcome asset IDs; and
add the fail-closed unified-account ratio.

Outcome asset IDs that previously returned `indeterminate` now decode successfully when their final
side digit is `0` or `1`; digits `2` through `9` return `invalid-input`. Unified ratio callers must
provide every referenced Spot balance explicitly and handle occupied non-positive availability as
`indeterminate`.
