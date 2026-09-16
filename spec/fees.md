# Fees Contract

Status: M2 complete
Last verified: 2026-09-17

Official sources: `HL.DOC.FEES.2026-07-19`, `HL.DOC.FEES.2026-09-17`,
`HL.DOC.ALIGNED_QUOTES.2026-09-17`, `HL.DOC.INFO.USER_FEES.2026-07-19`

The server decides the user's effective fee tier and the fee attached to an actual fill. Math only
evaluates explicit decimal rates and explicit, versioned schedules. It never infers referral,
staking, aligned-quote-asset, HIP-3, vault, or account eligibility.

## Signed fee convention

All M2 fee functions use one unambiguous user-cost convention:

- a positive `rate` or `feeAmount` is a charge paid by the user;
- a negative `rate` or `feeAmount` is a rebate received by the user;
- `accountValueDelta = -feeAmount`.

This convention is local to the Math contract. Kit maps server fields into it and preserves the raw
server value for later reconciliation. In particular, a server fill's `fee` and `closedPnl` fields
must not be treated as a self-proving signed ledger pair.

## `hl.fees.trade-fee.calculate` v1

Source ID: `HLM.SPEC.FEES.TRADE_FEE.V1`

Input is exactly `{ price, size, rate }`:

- `price` is a positive plain decimal string;
- `size` is a non-negative plain decimal string;
- `rate` is a signed plain decimal string supplied by Kit or the caller;
- `notional = price * size`;
- `feeAmount = notional * rate`;
- `accountValueDelta = -feeAmount`.

A zero size is valid but returns `not-applicable` with `zero-trade-size`. Math applies no hidden
minimum, maximum, tier, or rounding. Authority is `local-exact`; maturity is `stable`.

## `hl.fees.weighted-volume.calculate` v1

Source ID: `HLM.SPEC.FEES.WEIGHTED_VOLUME.V1`

Input is exactly `{ perpsVolume, spotVolume }`, both non-negative plain decimal strings.

`weightedVolume = perpsVolume + 2 * spotVolume`

The two-times spot weighting is the official rolling-14-day fee-tier rule. The function does not
fetch, window, deduplicate, or date volume events. Authority is `local-exact`; maturity is `stable`.

## `hl.fees.tier.select` v1

Source ID: `HLM.SPEC.FEES.TIER_SELECT.V1`

Input is exactly `{ weightedVolume, baseRates, tiers }`:

- `weightedVolume` is non-negative;
- `baseRates` is exactly `{ makerRate, takerRate }` with signed decimal rates;
- `tiers` is a dense plain array of at most 128 entries;
- each entry is exactly `{ minimumWeightedVolume, makerRate, takerRate }`;
- thresholds are positive and strictly increasing;
- an entry activates only when `weightedVolume > minimumWeightedVolume`, matching the official
  table's strict `>` thresholds;
- the selected tier is the highest activated entry; otherwise base rates apply.

The output identifies `{ kind: "base" }` or
`{ kind: "volume", index, minimumWeightedVolume }` and returns the selected maker/taker rates.
Schedules are data supplied by Kit/API; v1 contains no mutable fee table. Authority is
`local-exact`; maturity is `stable`.

Official `userFees.feeSchedule` naming: **`cross` is the taker rate and `add` is the maker rate**;
`tiers.vip[].ntlCutoff` maps to `minimumWeightedVolume`. All rates are decimal fractions
(`"0.00045"` = 4.5 bps), matching this contract. The official `tiers.mm[]` market-maker rebate
tiers activate on a maker-fraction cutoff, not a volume threshold; they are not expressible in this
volume-threshold model and are `not-supported` — as are referral and staking discounts, which Kit
applies to the rates before calling Math.

## Aligned quote assets

Source IDs: `HL.DOC.ALIGNED_QUOTES.2026-09-17`, `HL.DOC.FEES.2026-09-17`

"Aligned quote asset" is not one designation, and alignment by itself confers nothing in this
contract. Two specs coexist, and only one of them touches fees:

- **AQAv1** is the designation that carries the fee benefits — 20% lower taker fees, 50% larger
  maker rebates, and 20% more volume contribution toward fee tiers — when the token is the quote
  asset of a spot pair or the collateral asset of a HIP-3 perp.
- **AQAv2** extends the aligned designation to stablecoins that are not exclusive to Hyperliquid and
  states that there is **no trading-fee and no volume-contribution benefit**. An AQAv2 token is
  aligned and still charges, rebates, and contributes exactly like an unaligned quote token.

The official fee page presents the benefits under an unqualified "aligned quote assets" link; they
resolve to AQAv1 only on the aligned-quote-assets page. Read that sentence as a summary of AQAv1,
never as a property of being aligned.

What follows for this contract:

- The M2 fee functions classify nothing and take no alignment input. `calculateTradeFee` consumes
  the `rate` it is given, and `calculateWeightedVolume` applies only the official
  `perps + 2 * spot` rule. HIP-3 deployer fee composition, including how an explicit caller-supplied
  aligned-quote input is consumed, is normative in `spec/hip3.md`.
- An AQAv1 rate adjustment or volume uplift must already be reflected in the rates and volumes the
  caller passes in, taken from the same dated snapshot as the rest of the schedule.
- Deciding whether a token is AQAv1, AQAv2, or unaligned is the caller's responsibility and needs
  caller evidence. The `userFees`, perpetuals-metadata, and spot-metadata responses pinned at
  `HL.DOC.INFO.ORDERS_FILLS.2026-09-17`, `HL.DOC.INFO.PERP.2026-09-17`, and
  `HL.DOC.INFO.SPOT.2026-09-17` publish no aligned-quote classification field, so the classification
  cannot be read out of a fee or metadata snapshot and must not be inferred from one.
- A caller flag that means only "aligned" is ambiguous between the two specs. Math cannot detect the
  ambiguity, and a wrong classification silently produces wrong money.

## Trace and oracle boundary

All functions return `MathResult` and record normalized decimal inputs, formula/source IDs, Decimal40
arithmetic, and completion. The official Python SDK exposes fee-related API shapes but no
independent implementation of these formulas, so its formula coverage is `not-supported`. Dated
official API fixtures give partial schema/schedule evidence only. The server's final tier and actual
fill fee remain server-authoritative.
