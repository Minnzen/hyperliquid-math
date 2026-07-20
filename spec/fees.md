# Fees Contract

Status: M2 complete
Last verified: 2026-07-19

Official sources: `HL.DOC.FEES.2026-07-19`, `HL.DOC.INFO.USER_FEES.2026-07-19`

The server decides the user's effective fee tier and the fee attached to an actual fill. Math only
evaluates explicit decimal rates and explicit, versioned schedules. It never infers referral,
staking, aligned-quote, HIP-3, vault, or account eligibility.

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

## Trace and oracle boundary

All functions return `MathResult` and record normalized decimal inputs, formula/source IDs, Decimal40
arithmetic, and completion. The official Python SDK exposes fee-related API shapes but no
independent implementation of these formulas, so its formula coverage is `not-supported`. Dated
official API fixtures give partial schema/schedule evidence only. The server's final tier and actual
fill fee remain server-authoritative.
