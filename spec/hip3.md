# HIP-3 Perpetual Math Contract

Status: M5 verified
Last verified: 2026-07-19

Official sources: `HL.DOC.HIP3.2026-07-19`, `HL.DOC.HIP3_DEPLOYER_ACTIONS.2026-07-19`,
`HL.DOC.FEES.2026-07-19`, `HL.DOC.ACCOUNT_ABSTRACTION.2026-07-19`,
`HL.DOC.MARGINING.2026-07-19`, `HL.DOC.INFO.PERP.2026-07-19`

HIP-3 uses the same linear perpetual PnL, funding-settlement, fee-amount, margin, liquidation, order,
scenario, and reconciliation math as validator-operated perpetuals once Kit supplies the correct DEX
asset identity, collateral unit, snapshot, mark, margin table, leverage, and explicit fee rates. The
`./hip3` subpath may re-export those existing M2/M3/M4 public functions for integration ergonomics,
but their source IDs and formulas remain their original domain IDs. This spec adds only HIP-3-specific
collateral routing, margin-mode capability checks, and deployer/protocol fee-rate composition.

All HIP-3-specific APIs are `experimental` until dated testnet or mainnet fixtures prove the server
acceptance matrix for every supported account-abstraction mode and DEX margin mode.

## Collateral and account abstraction

HIP-3 DEXs may use any quote asset as collateral. Math never fetches the user's account-abstraction
mode, quote-token eligibility, borrow caps, portfolio-margin eligibility, or DEX state. It only maps an
explicit caller-supplied account-abstraction fact into the collateral source that Kit should use when
building a same-snapshot Math input.

The collateral amount unit is the DEX collateral asset unit chosen by the caller. Existing linear-perp
PnL, margin, liquidation, funding, fee, and scenario functions are unit-agnostic decimal arithmetic and
must be read as collateral-denominated for HIP-3 calls. They do not convert collateral to USDC unless
the caller explicitly provides USDC-denominated prices and balances.

## `hl.hip3.collateral-source.resolve` v1

Source ID: `HLM.SPEC.HIP3.COLLATERAL_SOURCE.V1`

Public function: `resolveHip3CollateralSource`.

Input is exactly `{ accountAbstractionMode, dex, collateralTokenIndex,
validatorPerpUsdcTokenIndex }`.

- `accountAbstractionMode` is one of `standard`, `unified`, `portfolio`, or
  `dex-abstraction-deprecated`. These are Math's names for the officially documented
  account-abstraction states; no info-API field returns this enum, so Kit derives the mode from the
  official account-abstraction documentation for the account's configuration and asserts it as an
  explicit input fact.
- `dex` is the non-empty official builder-dex name (HIP-3 deployments always have one; `null` is not valid here). Both token indexes are non-negative safe
  integers from the same dated metadata snapshot; Math does not identify USDC from a display symbol.
- Standard mode resolves to `{ kind: "per-dex-balance", dex, collateralTokenIndex }`. Cross margin
  applies only inside the same DEX.
- Unified mode resolves to `{ kind: "unified-spot-balance", collateralTokenIndex }`. The single
  balance for that asset backs spot activity and every cross-margin DEX using that collateral.
- Portfolio mode resolves to `{ kind: "portfolio-margin", collateralTokenIndex }`. Math does not evaluate
  collateral eligibility, LTV, borrow caps, interest, aggregation, fallback behavior, or liquidation
  across portfolio assets.
- Deprecated DEX abstraction resolves `collateralTokenIndex == validatorPerpUsdcTokenIndex` to
  `{ kind: "validator-perp-usdc-balance" }`; every non-USDC collateral resolves to
  `{ kind: "spot-balance", collateralTokenIndex }`.
- Output includes an objective route, account-abstraction checks, and trace assumptions that the mode,
  DEX, and collateral token came from a dated server snapshot or explicit caller evidence.
- Authority is `local-exact`; maturity is `experimental`.

## `hl.hip3.margin-mode.evaluate` v1

Source ID: `HLM.SPEC.HIP3.MARGIN_MODE.V1`

Public function: `evaluateHip3MarginMode`.

Input is exactly `{ assetMarginMode, requestedMode }`.

- `assetMarginMode` is one of:
  - `normal`: cross and isolated margin may both be available, subject to server eligibility and
    account-abstraction constraints;
  - `noCross`: only isolated margin is available, with margin removal enabled;
  - `strictIsolated`: only isolated margin is available and margin cannot be removed.
- `requestedMode` is one of `cross` or `isolated`.
- For `normal`, a `cross` request produces a satisfied local support check and an explicit
  `not-evaluated` eligibility check because mainnet validator requirements for HIP-3 cross margin are
  server-authoritative and may change.
- For `normal`, an `isolated` request is locally supported with margin removal allowed.
- For `noCross`, a `cross` request violates the margin-mode support check; an `isolated` request is
  locally supported with margin removal allowed.
- For `strictIsolated`, a `cross` request violates the margin-mode support check; an `isolated`
  request is locally supported with margin removal set to `strict`.
- Output includes `supportedLocally`, `effectiveMarginMode`, `marginRemoval`, and objective checks.
  It does not submit `setMarginModes`, `updateLeverage`, or margin-transfer actions.
- Authority is `local-exact`; maturity is `experimental`.

Existing M3 margin and liquidation functions remain the arithmetic contract after this margin-mode
fact is resolved. For example, a `strictIsolated` result maps to a M3 isolated position whose
`marginRemoval` is `strict`; a `noCross` result maps to isolated with `marginRemoval` `allowed`.

## `hl.hip3.fee-rates.calculate` v1

Source ID: `HLM.SPEC.HIP3.FEE_RATES.V1`

Public function: `calculateHip3FeeRates`.

Input is exactly:

```ts
{
  makerRate: string;
  takerRate: string;
  activeReferralDiscount: string;
  isAlignedQuoteToken: boolean;
  deployerFeeScale: string;
  growthMode: boolean;
}
```

- `makerRate` and `takerRate` are the signed decimal rates from the caller's frozen `userFees`
  evidence. Positive rates are charges and negative rates are rebates. `activeReferralDiscount` is in
  `[0, 1]` and is also explicit `userFees` evidence.
- `deployerFeeScale` is a decimal string in `[0, 3]`. When `growthMode` is true, it must be in
  `[0, 1]`.
- The v1 function is the official developer fee-rate formula expressed as decimal rates rather than
  UI percentages:

```text
growthMultiplier = growthMode ? 0.1 : 1
hip3Scale = deployerFeeScale < 1 ? deployerFeeScale + 1 : deployerFeeScale * 2
deployerShare = deployerFeeScale < 1
  ? deployerFeeScale / (1 + deployerFeeScale)
  : 0.5

makerRateBeforeAdjustments = makerRate * growthMultiplier
if makerRateBeforeAdjustments > 0:
  effectiveMakerRate = makerRateBeforeAdjustments * hip3Scale * (1 - activeReferralDiscount)
else:
  alignedMakerScale = isAlignedQuoteToken
    ? (1 - deployerShare) * 1.5 + deployerShare
    : 1
  effectiveMakerRate = makerRateBeforeAdjustments * alignedMakerScale

effectiveTakerRate = takerRate * hip3Scale * growthMultiplier * (1 - activeReferralDiscount)
alignedTakerScale = isAlignedQuoteToken
  ? (1 - deployerShare) * 0.8 + deployerShare
  : 1
effectiveTakerRate = effectiveTakerRate * alignedTakerScale
```

- The strict `< 1` branch means `deployerFeeScale = 1` uses the `2 * scale` and `0.5` branches, matching
  the official code exactly.
- Existing M2 `calculateTradeFee` consumes either effective rate and returns the fee
  amount/account-value delta in the caller's collateral unit.
- Output includes `{ effectiveMakerRate, effectiveTakerRate, hip3Scale, deployerShare,
  growthMultiplier, alignedMakerScale, alignedTakerScale, checks }` and trace assumptions for explicit
  caller-supplied rates, referral discount, aligned-quote status, deployer scale, and growth mode.
- Authority is `local-exact` for explicit rates and scales; maturity is `experimental`.

When `deployerFeeScale < 1`, the `deployerShare = scale / (1 + scale)` division is recorded in
`trace.rounding` as a Decimal40/HALF_EVEN boundary. The exact divide-by-ten growth adjustment is a
decimal shift and does not create a rounding record.

This function does not select the user's base fee tier, prove staking or aligned-quote eligibility,
fetch referral/deployer/growth inputs, apply volume/rate-limit accounting, or predict server rounding
of an actual fill.

## Re-exported HIP-3 integration surface

The `./hip3` subpath may re-export these existing runtime functions without changing their contracts:

- `calculatePerpUnrealizedPnl`, `projectPerpFill`, `projectPerpFillSequence`,
  `calculatePerpBreakEvenPrice`;
- `calculateTradeFee`, `calculateWeightedFeeVolume`, `selectFeeTier`;
- `calculateFundingPayment` and `annualizeFundingRate`; the standard funding premium/rate functions
  are deliberately excluded because HIP-3 premium behavior differs;
- `calculatePerpInitialMargin`, `calculatePerpMaintenanceMargin`, `evaluatePerpAccountMargin`;
- `calculatePerpLiquidationPrice` and `simulatePerpAccountScenario`.

Those functions keep their original stability labels. Their HIP-3 composition remains experimental
until live/testnet fixtures prove the required snapshot mapping and server acceptance behavior.

## Trace, assumptions, and oracle boundary

Successful HIP-3 traces must state:

- the account-abstraction mode and DEX collateral token were caller-supplied;
- cross-margin eligibility, portfolio-margin aggregation, quote-token eligibility, borrow caps,
  interest, fallback behavior, and liquidation sequencing were not locally evaluated;
- the supplied maker/taker rates already encode any upstream fee-tier or staking adjustment; referral
  discount, aligned-quote status, growth mode, and deployer fee scale were explicit inputs, not inferred
  by Math;
- all reused perp formulas remain denominated in the supplied collateral unit.

The official Python SDK provides HIP-3 API shape and asset-ID/wire examples, but it does not
provide independent collateral-routing, margin-mode, or fee-rate arithmetic oracles. Live fixtures can
prove schema and snapshot-mapping coverage only unless they include an actual accepted HIP-3 order or
account-state transition. No runtime HIP-3 function may perform network I/O.

## Limits

This contract does not support HIP-3 deployment auctions, staking, slashing, oracle publication,
funding-multiplier or interest-rate configuration, settlement, halting/resume actions, real order
submission, signed actions, wire serialization, portfolio-margin LTV math, borrow interest, cross-DEX
eligibility decisions, or freshness/severity policy. Those remain Kit/server domains unless a later
milestone adds separate source-backed specs and fixtures.
