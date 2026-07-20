# Formula Manual

Status: M0–M5 implemented; formula index verified against `spec/public-functions.json`

M0–M5 are this project's delivery milestones: M0 foundation and precision, M1 identifiers and
orderbook, M2 fees/positions/funding, M3 margin/liquidation/scenarios, M4 orders and
reconciliation, M5 spot/HIP-1/HIP-3. The numbering survives in file and fixture names as a
stable grouping label.

This directory is the normative mathematical manual for `hyperliquid-math`. The architecture and
milestone documents explain why the package exists; the files here define what every public function
computes. Read this page together with [NUMERICS.md](NUMERICS.md), [WORKED-EXAMPLES.md](WORKED-EXAMPLES.md),
[KIT-MAPPING.md](KIT-MAPPING.md), [SOURCES.md](SOURCES.md), and [oracles.md](oracles.md).

Every public runtime function validates plain data, performs Decimal40 arithmetic, and returns a
`MathResult` containing a value state plus a calculation trace. `local-exact` means exact under the
declared inputs, rounding model, and assumptions; it does not mean the package predicts future server
acceptance or execution.

Oracle abbreviations below are P = official Python SDK and L = dated live fixtures.
`full`, `partial`, and `none` are formula-specific evidence states, not package maturity labels.

## Public formula index

| Public function | Formula and result | Contract | Maturity | Oracle P/L |
| --- | --- | --- | --- | --- |
| `canonicalizeDecimalString` | Canonicalizes a plain decimal string without numerical rounding. | [precision](precision.md) · `hl.precision.decimal.canonicalize` | stable | none/none |
| `quantizePrice` | Selects the directional protocol-valid price from the union of the decimal/significant-figure rule and the integer-price exemption. | [precision](precision.md) · `hl.precision.price.quantize` | stable | partial/partial |
| `quantizeSize` | Computes `floor(value × 10^szDecimals) / 10^szDecimals`. | [precision](precision.md) · `hl.precision.size.quantize` | stable | partial/partial |
| `deriveCanonicalAssetKey` | Encodes network, market kind, official dex name (null for the first-party dex), and index into a collision-resistant Math identity. | [identifiers](identifiers.md) · `hl.identifiers.asset-key.derive` | stable | none/none |
| `encodeAssetId` | Encodes perp `i`, spot `10000+i`, or HIP-3 `100000+10000d+i`. | [identifiers](identifiers.md) · `hl.identifiers.asset-id.encode` | stable | partial/partial |
| `decodeAssetId` | Inverts supported perp, spot, and HIP-3 ranges and fails closed for the gap/outcome ranges. | [identifiers](identifiers.md) · `hl.identifiers.asset-id.decode` | stable supported ranges | partial/partial |
| `calculateBookMetrics` | Computes `mid=(bid+ask)/2`, `spread=ask-bid`, and `spreadBps=spread/mid×10000`. | [orderbook](orderbook.md) · `hl.orderbook.metrics` | stable | none/partial |
| `simulateBookFill` | Walks frozen levels, then derives fills, notional, VWAP, worst price, unfilled amount, and side-aware slippage. | [orderbook](orderbook.md) · `hl.orderbook.fill.simulate` | stable frozen snapshot | none/partial |
| `calculateTradeFee` | Computes `notional=price×size`, `fee=notional×rate`, and account delta `−fee`. | [fees](fees.md) · `hl.fees.trade-fee.calculate` | stable | none/none |
| `calculateWeightedFeeVolume` | Computes the official tier volume `perpsVolume + 2×spotVolume`. | [fees](fees.md) · `hl.fees.weighted-volume.calculate` | stable | none/none |
| `selectFeeTier` | Selects the highest strictly exceeded volume threshold and returns its maker/taker rates. | [fees](fees.md) · `hl.fees.tier.select` | stable | none/partial |
| `calculatePerpUnrealizedPnl` | Computes `signedSize×(markPrice−entryPrice)` and current position value. | [positions](positions.md) · `hl.positions.unrealized-pnl.calculate` | stable | none/partial |
| `projectPerpFill` | Applies open/increase/reduce/close/flip transition algebra, weighted entry, realized PnL, and explicit fee. | [positions](positions.md) · `hl.positions.fill.project` | stable | none/partial |
| `projectPerpFillSequence` | Left-folds ordered fills and sums gross PnL, fees, account deltas, and Math-defined closed PnL. | [positions](positions.md) · `hl.positions.sequence.project` | stable | none/partial |
| `calculatePerpBreakEvenPrice` | Computes `entryPrice + cumulativeCost / signedSize`. | [positions](positions.md) · `hl.positions.break-even-price.calculate` | stable | none/none |
| `calculateFundingPremiumIndex` | Computes `[max(impactBid−oracle,0)−max(oracle−impactAsk,0)]/oracle`. | [funding](funding.md) · `hl.funding.premium-index.calculate` | stable explicit inputs | none/partial |
| `calculateFundingRate` | Applies the supplied interest clamp, interval division, and symmetric hourly cap. | [funding](funding.md) · `hl.funding.rate.calculate` | stable explicit rules | none/partial |
| `calculateFundingPayment` | Computes `payment=signedSize×oraclePrice×rate` and account delta `−payment`. | [funding](funding.md) · `hl.funding.payment.calculate` | stable explicit inputs | none/partial |
| `annualizeFundingRate` | Computes either `r×n` or `(1+r)^n−1` under an explicit convention. | [funding](funding.md) · `hl.funding.rate.annualize` | stable | none/none |
| `calculatePerpInitialMargin` | Computes notional/leverage margin, 10% transfer floor, selected tier, and opening-leverage check. | [margin](margin.md) · `hl.margin.initial.calculate` | stable frozen input | none/partial |
| `calculatePerpMaintenanceMargin` | Computes tier-continuous `notional×rate−deduction` and the `2/3` backstop threshold. | [margin](margin.md) · `hl.margin.maintenance.calculate` | stable frozen input | none/none |
| `evaluatePerpAccountMargin` | Aggregates cross and isolated initial, transfer, maintenance, availability, and removable-margin facts. | [margin](margin.md) · `hl.margin.account.evaluate` | stable complete snapshot | none/none |
| `calculatePerpLiquidationPrice` | Solves the positive tier-consistent root where frozen account equity equals maintenance margin. | [liquidation](liquidation.md) · `hl.liquidation-price.calculate` | stable local root; cross-tier server parity unverified | none/partial |
| `simulatePerpAccountScenario` | All-or-nothing folds fills and account/margin/leverage actions, then recomputes positions, margins, constraints, and liquidation. | [scenarios](scenarios.md) · `hl.scenario.perp-account.simulate` | experimental | none/none |
| `validatePerpOrder` | Evaluates precision, minimum-notional, and price-band constraints without submitting or silently rounding. | [orders](orders.md) · `hl.orders.perp.validate` | stable local checks | none/none |
| `calculatePerpMaxOrderSize` | Computes the down-quantized minimum of collateral, reducible, and available order-value bounds. | [orders](orders.md) · `hl.orders.perp.max-size.calculate` | stable local upper bound | none/none |
| `evaluatePerpReduceOnly` | Classifies reduce/close/flip/increase and reports the objective reduce-only constraint. | [orders](orders.md) · `hl.orders.perp.reduce-only.evaluate` | stable | none/none |
| `calculatePerpSlippagePrice` | Applies side-aware bps to a caller reference and quantizes toward the user protection boundary. | [orders](orders.md) · `hl.orders.perp.slippage-price.calculate` | stable | none/none |
| `classifyPerpTrigger` | Classifies mark-relative TP/SL/at-mark and checks the closing order side. | [orders](orders.md) · `hl.orders.perp.trigger.classify` | stable | none/none |
| `derivePerpTriggerPrice` | Solves `entry + (targetNetPnl+cumulativeCost)/signedSize`, with explicit ROE margin basis when requested. | [orders](orders.md) · `hl.orders.perp.trigger-price.derive` | stable | none/none |
| `buildPerpScaleLadder` | Builds a local linear/geometric price ladder and exact conservative size partition. | [orders](orders.md) · `hl.orders.perp.scale.build` | stable local algorithm | none/none |
| `calculatePerpTwapSchedule` | Builds deterministic 30-second cumulative targets and the official 3× catch-up bound. | [orders](orders.md) · `hl.orders.perp.twap-schedule.calculate` | stable deterministic subset | none/none |
| `replayPerpAccountEvents` | Replays complete ordered fills/funding/transfers into positions, cash ledger, totals, and server-field residuals. | [reconciliation](reconciliation.md) · `hl.reconciliation.perp-account.replay` | stable complete evidence | none/partial |
| `reconcilePerpAccountSnapshot` | Computes observed-minus-projected cash/position residuals and tolerance checks, preserving observed correction authority. | [reconciliation](reconciliation.md) · `hl.reconciliation.perp-account.reconcile` | stable complete evidence | none/partial |
| `convertSpotTokenUnits` | Converts exactly between human units and integer minimal units using `10^weiDecimals`. | [spot](spot.md) · `hl.spot.units.convert` | stable | none/partial |
| `calculateSpotOrderDeltas` | Computes spot notional and signed base/quote balance deltas. | [spot](spot.md) · `hl.spot.order-deltas.calculate` | stable | none/none |
| `projectSpotPositionEvent` | Applies buy/sell/transfer/genesis/initialization cost-basis transitions and quote-normalized fees. | [spot](spot.md) · `hl.spot.position-event.project` | stable core; genesis/init experimental | none/none |
| `calculateSpotPortfolioValue` | Sums `balance×mark`, `balance×entry`, and their difference per token and portfolio. | [spot](spot.md) · `hl.spot.portfolio-value.calculate` | stable | none/partial |
| `evaluateSpotDustEligibility` | Checks `balance < lotSize` and `balance×midPrice <= usdThreshold`. | [spot](spot.md) · `hl.spot.dust-eligibility.evaluate` | stable frozen inputs | none/partial |
| `projectSpotDustAllocation` | Projects burn or pro-rata proceeds from caller-supplied aggregate dust execution. | [spot](spot.md) · `hl.spot.dust-allocation.project` | experimental | none/none |
| `validateHip1Deployment` | Evaluates name, decimal, lot, positive-supply, and genesis-checksum constraints. | [HIP-1](hip1.md) · `hl.hip1.deployment.validate` | experimental | none/partial |
| `evaluateHip1AnchorGenesisEligibility` | Computes `max(holderBalanceWei − anchorTokenMaxSupplyWei/10⁶, 0)` eligibility weight. | [HIP-1](hip1.md) · `hl.hip1.anchor-genesis.evaluate` | experimental | none/none |
| `resolveHip3CollateralSource` | Maps explicit account-abstraction mode and collateral metadata to an objective balance route. | [HIP-3](hip3.md) · `hl.hip3.collateral-source.resolve` | experimental | none/partial |
| `evaluateHip3MarginMode` | Resolves normal/noCross/strictIsolated support, effective mode, removal semantics, and checks. | [HIP-3](hip3.md) · `hl.hip3.margin-mode.evaluate` | experimental | none/partial |
| `calculateHip3FeeRates` | Applies official deployer scale, growth, referral, and aligned-quote maker/taker adjustments. | [HIP-3](hip3.md) · `hl.hip3.fee-rates.calculate` | experimental | none/partial |

## Result interpretation

- `ok` means the declared formula completed; violated or not-evaluated constraint checks can still be
  present inside the data.
- `invalid-input` means the public plain-data contract was not satisfied.
- `not-applicable` means valid input describes a state where the calculation has no value, such as a
  flat-position break-even price.
- `indeterminate` means a unique result cannot be established from supported evidence or assumptions.
- `trace.authority` describes arithmetic authority. Server observations and corrections are tagged
  explicitly and never overwritten by a local projection.

The executable delivery truth is `spec/public-functions.json`; the generated capability registry is
architecture scope only and explicitly does not assert implementation status.
