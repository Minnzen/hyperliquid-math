# Perpetual Order Math Contract

Status: M4 complete (independently reviewed)
Last verified: 2026-08-12

Official sources: `HL.DOC.TICK_LOT.2026-07-19`, `HL.DOC.ORDER_TYPES.2026-08-12`,
`HL.DOC.TP_SL.2026-07-19`, `HL.DOC.ORDER_ERRORS.2026-07-19`,
`HL.DOC.CONTRACT_SPECIFICATIONS.2026-07-19`, `HL.DOC.EXCHANGE.2026-08-12`

Fixture source: `HL.LIVE.MAINNET.M4.2026-07-19`

This domain receives explicit order facts and rules. It does not choose TIF, grouping, signing/wire
payloads, reference-price freshness, submission policy, or whether a violated check blocks the UI.
Every successful validation result may contain violated or not-evaluated checks; Kit owns policy.

## Shared rule availability

Mutable protocol rules are represented as exactly one of:

- `{ kind: "available", value }`;
- `{ kind: "not-applicable", reason }`;
- `{ kind: "not-supported", reason }`.

`reason` is fully validated plain data. Missing or unavailable rules never become satisfied checks.

## `hl.orders.perp.validate` v1

Source ID: `HLM.SPEC.ORDERS.VALIDATE.V1`

- Input is exactly `{ price, size, szDecimals, minimumNotional, priceBand }`.
- Price and size are positive canonical decimal strings. `szDecimals` is a safe integer in `[0, 6]`.
- Price precision is satisfied iff applying the official perp precision rule with `down` does not
  change the numeric price. Size precision is satisfied iff conservative size quantization does not
  change the numeric size.
- `notional = price × size` using Decimal40.
- An available minimum-notional rule is satisfied iff `notional >= minimumNotional`.
- An available price band is exactly `{ lowerBound, upperBound }`, both positive, with
  `lowerBound <= upperBound`; it is satisfied iff `lowerBound <= price <= upperBound`.
- `not-applicable` produces a not-applicable check. `not-supported` produces a not-evaluated check
  with the supplied reason. Neither is silently omitted.
- Valid input returns `ok` with `{ notional, checks }` even when checks are violated or not evaluated.
  Invalid shape, decimal grammar, precision metadata, rule payload, or inverted band returns
  `invalid-input`.
- Authority is `local-exact`; maturity is `stable`. Server margin, open interest, account limits,
  liquidity, ALO marketability, and final acceptance are outside this result.

## `hl.orders.perp.max-size.calculate` v1

Source ID: `HLM.SPEC.ORDERS.MAX_SIZE.V1`

- Input is exactly `{ availableCollateral, leverage, referencePrice, currentSignedSize, side,
  reduceOnly, szDecimals, orderValueLimit }`.
- `availableCollateral` is non-negative; `leverage` and `referencePrice` are positive;
  `currentSignedSize` is signed; `side` is `buy` or `sell`; `reduceOnly` is boolean.
- `openingCapacity = availableCollateral × leverage / referencePrice`.
- The quantity that can reduce the current position before opening is `abs(currentSignedSize)` only
  when the order side opposes the current position; otherwise it is zero.
- If `reduceOnly`, the collateral bound is exactly the reducible quantity. Otherwise it is
  `reducibleQuantity + openingCapacity`.
- An available order-value limit contributes `orderValueLimit / referencePrice` as a bound on the
  entire requested order. A missing limit remains a not-evaluated check; it is not treated as infinity
  in the completeness report.
- The returned `localUpperBoundSize` is the minimum of all available local bounds, quantized down to
  `szDecimals`; zero is a valid bound. The result also exposes each component and checks.
- This is a deterministic local upper bound, not the server-accepted max size. Margin tiers, current
  open interest, dynamic user limits, resting orders, and liquidity remain server-authoritative.
- Authority is `local-exact`; maturity is `stable`.

## `hl.orders.perp.reduce-only.evaluate` v1

Source ID: `HLM.SPEC.ORDERS.REDUCE_ONLY.V1`

- Input is exactly `{ currentSignedSize, side, requestedSize }`.
- `requestedSize` is positive. Zero position is valid and has reducible size zero.
- A long position is reducible only by `sell`; a short position only by `buy`.
- `requestedEffect` is one of `reduce`, `close`, `would-flip`, or `would-increase`.
- The result exposes `reducibleSize`, `acceptedTransitionSize` only when the request is an exact
  reduce/close, and an objective reduce-only constraint check.
- Requests larger than reducible size are reported as `would-flip` with a violated check. Math never
  silently clamps the request or predicts server behavior. Wrong-side and flat requests are
  `would-increase` with a violated check.
- Authority is `local-exact`; maturity is `stable`.

## `hl.orders.perp.slippage-price.calculate` v1

Source ID: `HLM.SPEC.ORDERS.SLIPPAGE_PRICE.V1`

- Input is exactly `{ side, referencePrice, slippageBps, szDecimals }`.
- `slippageBps` is a non-negative decimal. `rawPrice` is
  `referencePrice × (1 + slippageBps / 10000)` for buys and
  `referencePrice × (1 - slippageBps / 10000)` for sells.
- A non-positive sell boundary is invalid input.
- To remain conservative for the user-defined boundary, buy prices quantize down and sell prices
  quantize up under the official perp price rule.
- If conservative protocol quantization collapses the positive raw boundary to zero, the function
  returns `invalid-input: rounded-to-zero`; zero is never emitted as an order price.
- Output is `{ rawPrice, protectionPrice, rounding }` and records any precision decision in trace.
- The caller chooses and proves the reference price. Math does not fetch BBO, mid, mark, or oracle.
- Authority is `local-exact`; maturity is `stable`.

## `hl.orders.perp.trigger.classify` v1

Source ID: `HLM.SPEC.ORDERS.TRIGGER_CLASSIFY.V1`

- Input is exactly `{ positionSide, orderSide, markPrice, triggerPrice }`.
- TP/SL uses mark price. The closing side is `sell` for a long and `buy` for a short.
- For a long, a trigger above mark is take-profit and below mark is stop-loss. For a short, below mark
  is take-profit and above mark is stop-loss.
- Equality is `at-mark` and violates the trigger-direction check. A non-closing order side violates
  the closing-side check. Both are objective facts; the function still returns `ok` for valid input.
- Output includes relation, classification, expected closing side, and checks.
- Parent/child grouping, placement lifecycle, mark freshness, and server `BadTriggerPx` handling are
  Kit/server responsibilities.
- Authority is `local-exact`; maturity is `stable`.

## `hl.orders.perp.trigger-price.derive` v1

Source ID: `HLM.SPEC.ORDERS.TRIGGER_DERIVE.V1`

- Input is exactly `{ position, target, cumulativeCost }`; position must be open.
- `cumulativeCost` is a non-negative decimal representing fees/funding already chosen by the caller.
- For `{ kind: "pnl", amount }`, `targetNetPnl = amount`.
- For `{ kind: "roe", ratio, leverage }`, initial-margin basis is
  `abs(size) × entryPrice / leverage` and `targetNetPnl = ratio × initialMarginBasis`.
- `targetGrossPnl = targetNetPnl + cumulativeCost` and
  `triggerPrice = entryPrice + targetGrossPnl / signedSize`.
- A non-positive derived trigger returns `indeterminate: no-positive-trigger-price-under-assumptions`.
- Output is not protocol-quantized. The caller validates or quantizes it explicitly before order use.
- The ROE denominator is this declared initial-margin basis; the function does not claim to reproduce
  any changing frontend display convention.
- Authority is `local-exact`; maturity is `stable`.

## `hl.orders.perp.scale.build` v1

Source ID: `HLM.SPEC.ORDERS.SCALE.V1`

- Input is exactly `{ side, lowerPrice, upperPrice, totalSize, legCount, distribution, szDecimals }`.
- `legCount` is a safe integer in `[2, 100]`; `lowerPrice < upperPrice`; `distribution` is `linear` or
  `geometric`; total size must already be valid at `szDecimals`.
- Linear raw prices are `lower + (upper-lower) × i/(n-1)`.
- Geometric raw prices are `lower × (upper/lower)^(i/(n-1))` under Decimal40 precision.
- Buy prices quantize down and sell prices quantize up. Quantized prices must remain strictly
  increasing and positive; collapsed levels or a level rounded to zero are invalid input.
- The first `n-1` legs receive `floor(totalSize/n, szDecimals)`. The last leg receives the exact
  canonical remainder, so allocated size equals total size and never exceeds it. A zero leg is invalid.
- Output order is ascending by price. Kit may reverse presentation, attach TIF, or submit the legs.
- A reviewed composition contract maps the returned legs, in order, to explicit `fill` actions for
  `simulatePerpAccountScenario`. That existing scenario facade owns sequential position, margin, and
  liquidation projection; the ladder builder does not duplicate it or imply that orders will fill.
- Official docs only establish that Scale is multiple limits in a range. This algorithm is the
  caller-selected local ladder contract, not a claim about a hidden native server split algorithm.
- Authority is `local-exact`; maturity is `stable`.

## `hl.orders.perp.twap-execution-target.calculate` v1

Source ID: `HLM.SPEC.ORDERS.TWAP_EXECUTION_TARGET.V1`

- Input is exactly `{ totalSize, durationMs, elapsedMs }`.
- `totalSize` is a positive decimal string. `durationMs` is a positive safe integer. `elapsedMs` is a
  non-negative safe integer no greater than `durationMs`.
- `cumulativeTargetSize = totalSize × elapsedMs / durationMs` under Decimal40/HALF_EVEN arithmetic.
  The result is exactly zero at elapsed time zero and exactly total size at full duration.
- The official order-types documentation defines this continuous execution target, while the server
  computes its fixed child interval from total size and running time. The public documentation does
  not expose the child-count formula, so this function deliberately returns no child count, interval,
  normal-child size, catch-up size, slippage field, or synthetic schedule.
- The mutable 5-minute-to-7-day duration range and minimum order value are Kit admission rules, not
  arithmetic preconditions. Randomization, child rounding, scheduling, fills, catch-up decisions, and
  final completion remain server-authoritative and are excluded.
- Authority is `local-exact`; maturity is `stable`; capability coverage remains partial because live
  execution is intentionally excluded.

## Trace assumptions

Successful M4 order traces state mutable caller evidence explicitly: available collateral, position,
reference/mark price, mutable protocol-rule availability, target-cost completeness, the caller-selected
local Scale algorithm, and the caller-provided TWAP duration with server scheduling excluded. Invalid
or validation-stopped traces remain assumption-free.

## Oracle boundary

- The pinned official Python SDK provides order schemas, wire formatting, and request
  builders only. Because those surfaces do not execute the public order formulas independently,
  their formula coverage is `not-supported`, including validation and the continuous TWAP target.
- The dated mainnet fixture proves fill/order/status fields and endpoint truncation boundaries. It does
  not prove local order acceptance or hidden server scheduling.
- No signed order is submitted. Market, testnet, or mainnet execution remains outside this milestone.
