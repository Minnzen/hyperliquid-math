# Worked Formula Examples

These compact vectors are for hand audit. Inputs are abbreviated but use the exact public semantics;
domain specs define the full plain-data shapes and trace fields.

Twelve representative cross-domain vectors are also stored as plain data in
[`WORKED-EXAMPLES.json`](WORKED-EXAMPLES.json) and executed by the formula-manual contract test. The
table remains the complete 49-function human index; the JSON set protects high-risk arithmetic examples
from documentation drift.

| Public function | Hand-checkable example |
| --- | --- |
| `canonicalizeDecimalString` | `001.2300 → 1.23`; every spelling of signed zero becomes `0`. |
| `quantizePrice` | Perp `103436.7`, `szDecimals=0`, down: the normal candidate is `103430`, integer candidate is `103436`, so the tight result is `103436`. |
| `quantizeSize` | `1.239` at two size decimals becomes `floor(123.9)/100 = 1.23`. |
| `deriveCanonicalAssetKey` | mainnet perp first-party dex (`null`), index `0` becomes `hl:mainnet:perp::0`. |
| `encodeAssetId` | Outcome `1`, side `1`: `100000000 + 10×1 + 1 = 100000011`. |
| `decodeAssetId` | `100000011 − 100000000 = 11`, so outcome is `floor(11/10)=1` and side is `1`. |
| `calculateOutcomeDualPrice` | Price `0.37` has merged-book dual `1−0.37 = 0.63`. |
| `calculateOutcomeSettlement` | No token, settle fraction `0.8`, size `10`, entry `0.63`: payout fraction `0.2`, value `2`, notional `6.3`, gross PnL `-4.3`. |
| `evaluateRecurringOutcome` | Marks `100@t0` and `110@t1`, settled halfway: interpolated mark `105`; binary target equality settles Yes. |
| `calculateBookMetrics` | bid `99`, ask `101`: mid `100`, spread `2`, spread bps `2/100×10000 = 200`. |
| `simulateBookFill` | Buy `1.5` from asks `1@100, 1@110`: fills `1@100 + 0.5@110`, total notional `155`, VWAP `155/1.5`. |
| `calculateTradeFee` | `price=100`, `size=2`, `rate=0.001`: notional `200`, fee `0.2`, account delta `-0.2`. |
| `calculateWeightedFeeVolume` | Perps `100` and Spot `50`: `100 + 2×50 = 200`. |
| `selectFeeTier` | Threshold `100` is inactive at volume `100` and active at `100.0001` because comparison is strict `>`. |
| `calculatePerpUnrealizedPnl` | Long `2@100` marked `110`: `2×(110−100) = 20`. |
| `projectPerpFill` | Long `5@100` plus buy `1@160`: new size `6`, entry `(5×100+1×160)/6 = 110`. |
| `projectPerpFillSequence` | The preceding `6@110` followed by sell `6@120` ends flat with gross realized PnL `6×10 = 60`. |
| `calculatePerpBreakEvenPrice` | Long `2@100` with cumulative cost `4`: `100 + 4/2 = 102`. |
| `calculateFundingPremiumIndex` | Impact bid `110`, ask `90`, oracle `100`: `(10−10)/100 = 0`. |
| `calculateFundingRate` | Premium `0`, interest `0.0001`, eight-hour interval, no cap hit: hourly rate `0.0001/8 = 0.0000125`. |
| `calculateFundingPayment` | Long size `2`, oracle `100`, rate `0.001`: payment `0.2`, account delta `-0.2`. |
| `annualizeFundingRate` | Simple `0.001` for `365` periods gives `0.365`; compound uses `(1.001)^365−1`. |
| `calculatePerpInitialMargin` | `2×100=200` notional at `5×`: initial `40`; transfer requirement `max(40,20)=40`. |
| `calculatePerpMaintenanceMargin` | Notional `200`, max leverage `10`: rate `1/(2×10)=0.05`, maintenance `10`, backstop threshold `20/3`. |
| `evaluatePerpAccountMargin` | Cross account value `1000` with the preceding position: maintenance availability `990`, initial availability `960`. |
| `calculateUnifiedAccountRatio` | Cross maintenance `5`, isolated usage `1.5`, spot total `11.5`: available `10`, token and account ratio `0.5`. |
| `calculatePerpLiquidationPrice` | Isolated long `q=1`, mark `100`, value `20`, rate `0.05`, deduction `0`: `x=(−20+100)/(1−0.05)=80/0.95`. |
| `simulatePerpAccountScenario` | A complete `fill buy 1@100` action from flat is folded first; margin and liquidation are then recomputed from that projected state, never from a prefix after failure. |
| `validatePerpOrder` | `price=100`, `size=0.1`, minimum notional `10`, band `90..110`: notional `10`; both inclusive constraints pass. |
| `calculatePerpMaxOrderSize` | Collateral `100`, leverage `5`, reference `100`, long `2` selling non-reduce-only: opening `5` plus reducible `2` gives local bound `7`. |
| `evaluatePerpReduceOnly` | Long `2`, sell `3`: only `2` is reducible, so the request is `would-flip` and the check is violated. |
| `calculatePerpSlippagePrice` | Buy reference `100` with `50` bps: raw boundary `100×1.005 = 100.5`, then quantize down. |
| `classifyPerpTrigger` | Long position, sell order, mark `100`, trigger `110`: correct closing side and `take-profit`. |
| `derivePerpTriggerPrice` | Long `2@100`, target gross PnL `20`, no cost: `100 + 20/2 = 110`. |
| `buildPerpScaleLadder` | Linear `90..110`, size `1`, three legs, two size decimals: prices `90,100,110`; sizes `0.33,0.33,0.34`. |
| `calculatePerpTwapSchedule` | Size `6` over `90,000 ms`: three 30-second children, normal size `2`, cumulative targets `2,4,6`, catch-up bound `6`. |
| `replayPerpAccountEvents` | Cash `100`; open long `1@100`, then sell `1@110` with fee `1`: gross `10`, net cash delta `9`, final cash `109`. |
| `reconcilePerpAccountSnapshot` | Projected cash `109`, observed `109.01`, tolerance `0.02`: residual `0.01`, check satisfied. |
| `convertSpotTokenUnits` | Human `0.5` with `weiDecimals=5` becomes `0.5×10^5 = 50000` minimal units. |
| `calculateSpotOrderDeltas` | Buy base `2` at price `3`: notional `6`, base delta `+2`, quote delta `-6`. |
| `projectSpotPositionEvent` | Flat plus buy `2@3` with quote fee `0.1`: position `2@3`, gross PnL `0`, closed PnL `-0.1`. |
| `calculateSpotPortfolioValue` | Balance `2`, entry `3`, mark `4`: value `8`, entry notional `6`, unrealized PnL `2`. |
| `evaluateSpotDustEligibility` | Balance `0.5`, lot `1`, mid `0.07`, threshold `1`: below lot and notional `0.035≤1`, so eligible. |
| `projectSpotDustAllocation` | Aggregate size `10`, proceeds `5`, user size `2`, lot `1`: ratio `0.2`, user proceeds `1`. |
| `validateHip1Deployment` | `weiDecimals=8`, `szDecimals=3`: lot is `10^(8−3)=100000`; `userGenesis+anchorGenesis` must equal max supply. |
| `evaluateHip1AnchorGenesisEligibility` | Holder `2`, max supply `1,000,000`: threshold `1`, weight `max(2−1,0)=1`. |
| `resolveHip3CollateralSource` | Deprecated DEX abstraction with collateral index equal to validator-perp USDC index resolves to the validator-perp USDC balance. |
| `evaluateHip3MarginMode` | `assetMarginMode=noCross`, requested `cross`: locally unsupported with a violated support check. |
| `calculateHip3FeeRates` | Maker `0.001`, taker `0.002`, deployer scale `0.5`, no discount/growth/alignment: HIP-3 scale `1.5`, effective rates `0.0015` and `0.003`. |

The examples intentionally do not hide missing evidence. Where server behavior is not an executable
oracle, the corresponding formula remains a local deterministic contract and the oracle registry says
`not-supported`.
