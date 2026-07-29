# Spot Contract

Status: M5 verified
Last verified: 2026-07-19

Official sources: `HL.DOC.INFO.SPOT.2026-07-19`, `HL.DOC.ENTRY_PNL.2026-07-19`,
`HL.DOC.HIP1.2026-07-19`

Fixture sources: `HL.LIVE.MAINNET.M5.2026-07-19`, `HL.LIVE.TESTNET.M5.2026-07-19`

Spot Math receives explicit token metadata, balances, prices, and events. It does not fetch spot
metadata, select a mid price, submit orders, model matching, or decide whether a dust action should be
executed. Server balance fields such as `entryNtl` are evidence to reconcile against; they are not a
self-proving formula input.

## Canonical spot data

Spot token units use the official token metadata:

- `weiDecimals` is the decimal scale of the token's minimal unit;
- `szDecimals` is the minimum tradable size precision;
- one tradable lot is `10 ** (weiDecimals - szDecimals)` minimal units;
- `szDecimals + 5 <= weiDecimals` is an official HIP-1 deployment constraint.

All public values are plain decimal strings subject to the package-wide 256-character input budget.
Minimal-unit inputs are non-negative integer decimal strings. Human token sizes are non-negative
plain decimal strings. Prices and marks are positive plain decimal strings unless the function
explicitly accepts zero.

## `hl.spot.units.convert` v1

Source ID: `HLM.SPEC.SPOT.UNITS_CONVERT.V1`

Input is exactly `{ value, weiDecimals, direction }`, where `direction` is `human-to-minimal` or
`minimal-to-human`.

- `weiDecimals` is a non-negative safe integer in the local defensive range `0..255`; this is an
  input-size guard, not a claim about the server's deployment limit.
- `value` is rejected as `decimal-string-too-long` before conversion when its raw spelling exceeds
  256 characters.
- `minimal-to-human` requires `value` to be a non-negative integer decimal string and returns
  `value / 10 ** weiDecimals`.
- `human-to-minimal` requires `value * 10 ** weiDecimals` to be an integer. Fractional minimal units
  are invalid input; Math does not round user balances or deployment supplies.
- Output is `{ value }` with canonical decimal spelling.
- Authority is `local-exact`; maturity is `stable`.

## `hl.spot.order-deltas.calculate` v1

Source ID: `HLM.SPEC.SPOT.ORDER_DELTAS.V1`

Input is exactly `{ side, baseSize, price }` in human base/quote units.

- `side` is `buy` or `sell`; `baseSize` and `price` are positive plain decimal strings.
- Quote commitment and order notional are `price * baseSize`.
- A buy increases base and decreases quote by the computed commitment. A sell decreases base and
  increases quote by the computed commitment.
- Output includes `{ notional, baseDelta, quoteDelta }`; signed deltas use the user's balance
  convention.
- M1 `quantizePrice`/`quantizeSize` and `convertSpotTokenUnits` are the separate precision and
  minimal-unit contracts. This function does not reinterpret the HIP-1 prose's internally scaled
  `px`/`sz` commitment notation as API human-unit strings.
- Fees, rebates, holds, partial fills, self-trade prevention, and final server acceptance are outside
  this deterministic order-delta contract.
- Authority is `local-exact`; maturity is `stable`.

## `hl.spot.position-event.project` v1

Source ID: `HLM.SPEC.SPOT.POSITION_EVENT_PROJECT.V1`

Input is exactly `{ position, event }`. A spot position is either flat
`{ kind: "flat" }` or open `{ kind: "open", balance, entryPrice }`; open balance and entry price are
positive plain decimal strings.

Events are explicit caller evidence:

- `{ kind: "buy", size, price, feeQuoteAmount }`;
- `{ kind: "sell", size, price, feeQuoteAmount }`;
- `{ kind: "transfer", size, markPrice, direction }`, where `direction` is exactly `"in"`
  (tokens arriving into this venue) or `"out"` (tokens leaving it);
- `{ kind: "genesis", size, maxSupply }`;
- `{ kind: "initialize-from-existing-balance", balance, eventPrice }`.

State transition rules:

1. A buy opens or increases spot inventory. Entry becomes size-weighted:
   `(oldBalance * oldEntry + size * price) / newBalance`.
2. A sell closes inventory up to the current balance. Entry is unchanged for partial sells and flat
   after a full sell. Selling more than the current balance is invalid input.
3. Realized price PnL for a sell is `(price - entryPrice) * size`. `feeQuoteAmount` is a signed user
   cost already normalized by Kit into the quote token (positive charge, negative rebate); `closedPnl =
   grossRealizedPnl - feeQuoteAmount`. A buy has zero gross realized PnL and closed PnL equal to
   `-feeQuoteAmount`. For a fee paid in base token, the current API does not define whether a raw server
   fill size is gross or net inventory; Kit must not guess or silently subtract the fee. It may call this
   function only after independently proving and supplying the actual inventory delta as `size` and a
   separately sourced quote-value fee as `feeQuoteAmount`; otherwise the event is not-supported. A future
   input variant may carry an explicit base-fee amount once official schema and live semantics exist.
4. A transfer in opens or increases at the supplied mark price. A transfer out closes at the supplied
   mark price. This follows the official spot entry/PnL rule that transfers use mark for entry/PnL
   accounting; Math does not prove mark freshness.
5. A genesis event opens or increases using the official 10,000 USDC token market-cap basis:
   `entryPrice = 10000 / maxSupply`, where `maxSupply` is the positive human-token maximum supply.
6. The first post-feature event for a pre-existing balance may be represented by
   `initialize-from-existing-balance`; it opens the supplied balance at the first supplied trade or
   send event price and records the assumption in trace. This initialization event is valid only
   from a flat local state; applying it to an already-open state is invalid input because silently
   replacing tracked inventory would discard caller evidence.

Output reports previous/next position, classification, gross realized PnL, fee amount,
fee account-value delta, closed PnL, and any opened or closed size. Unknown server display fields,
historical balances before the first supplied event, and undocumented `entryNtl` semantics are
not-supported.

Authority is `local-exact`; maturity is `stable` for buy/sell and transfer formulas, and
`experimental` for genesis and pre-existing-balance initialization because those rely on dated official
prose plus caller-supplied market-cap/mark evidence.

## `hl.spot.portfolio-value.calculate` v1

Source ID: `HLM.SPEC.SPOT.PORTFOLIO_VALUE.V1`

Input is exactly `{ balances }`, where `balances` is a dense array of at most 1024 entries. Each entry
is exactly `{ tokenKey, balance, entryPrice, markPrice }`. `tokenKey` is a caller-chosen join key
echoed back in per-token outputs; the recommended value is the official `spotMeta.tokens[].name`
(unique per token), and any non-empty string is accepted as long as it is unique within the call.

- `balance` is a non-negative plain decimal string; `entryPrice` and `markPrice` are positive.
- `tokenValue = balance * markPrice`, `entryNotional = balance * entryPrice`, and
  `unrealizedPnl = tokenValue - entryNotional`.
- Output includes per-token values plus `portfolioValue`, `entryNotional`, and `unrealizedPnl`
  aggregates. Duplicate `tokenKey` values are invalid input.

Kit owns token discovery, mark selection, freshness, portfolio-margin eligibility, vault balances, and
whether to include held or pending amounts. Authority is `local-exact`; maturity is `stable`.

## `hl.spot.dust-eligibility.evaluate` v1

Source ID: `HLM.SPEC.SPOT.DUST_ELIGIBILITY.V1`

Input is exactly `{ balance, midPrice, weiDecimals, szDecimals, usdThreshold }`.

- `balance` is a non-negative human token balance and `midPrice` is positive.
- `usdThreshold` is a non-negative decimal string; callers normally pass the official 1 USD threshold.
- `weiDecimals` and `szDecimals` are non-negative safe integers in the local defensive range
  `0..255`, and `szDecimals <= weiDecimals` is required so the lot is an integer number of minimal
  units. This evaluator deliberately does not re-apply the stricter current HIP-1 deployment rule to
  already-deployed legacy tokens.
- `lotSizeWei = 10 ** (weiDecimals - szDecimals)` and the corresponding human-token lot is
  `lotSize = 10 ** (-szDecimals)`.
- A balance is eligible iff `balance < lotSize` and `balance * midPrice <= usdThreshold`.
- Output includes `{ lotSizeWei, lotSize, notionalUsd, eligible, checks }`.

The official dust service runs on a daily cadence and may skip dusting for one-sided liquidity or high
market impact. Math only evaluates the deterministic balance/notional predicate for a frozen mid price.
Authority is `local-exact`; maturity is `stable`.

## `hl.spot.dust-allocation.project` v1

Source ID: `HLM.SPEC.SPOT.DUST_ALLOCATION_PROJECT.V1`

Input is exactly `{ aggregateDustSize, executedProceeds, userDustSize, aggregateLotSize }`.

- `aggregateDustSize`, `executedProceeds`, and `userDustSize` are non-negative plain decimal strings;
  `aggregateLotSize` is positive, as every token lot is non-zero.
- `userDustSize` must not exceed `aggregateDustSize`.
- If `aggregateDustSize < aggregateLotSize`, `executedProceeds` must be zero and output is
  `{ mode: "burn", allocationRatio: "0", userProceeds: "0" }`.
- Otherwise `allocationRatio = userDustSize / aggregateDustSize` and
  `userProceeds = executedProceeds * allocationRatio`; output mode is `converted`.
- Output includes the mode, allocation ratio, and projected user proceeds.

This function projects a caller-supplied aggregate sale outcome. It does not decide whether HyperCore
will sell or burn dust, compute market impact, choose routes, model slippage, or reproduce final server
allocation rounding. Authority is `local-exact`; maturity is `experimental`.

## Trace assumptions

Successful M5 spot traces state the frozen token metadata, marks, mid prices, explicit event order,
fee convention, and any genesis/pre-existing-balance assumptions. Invalid input traces do not claim
formula completion. Any result using a caller-supplied `markPrice`, `midPrice`, or `executedProceeds`
must record that Math did not fetch or verify the value.

Every Decimal40 division boundary is recorded in `trace.rounding` with `mode: "half-even"`, including
weighted entry, the genesis-entry basis, and converted-dust allocation ratios. A rounding record
discloses the configured finite-precision boundary; it does not assert that the particular operands
lost digits. Multiplication-only and exact unit-shift operations do not add division records.

## Oracle boundary

Official spot info fixtures prove token metadata, balances, holds, total balances, and observed
`entryNtl` fields. They do not prove undocumented server entry formulas or dust execution. The official Python SDK
provides spot API schemas and wire helpers only; schema-only evidence is
`not-supported` as formula coverage. Actual matching, daily dust execution, market-impact decisions, and allocation
rounding remain server-authoritative and are not-supported in Math.
