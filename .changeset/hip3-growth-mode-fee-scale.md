---
'hyperliquid-math': patch
---

`calculateHip3FeeRates` now evaluates growth-mode deployer fee scales above one instead of
returning `indeterminate`.

The previous behavior assumed the official Fees page and the `SetDeployerFees` schema disagreed
about the growth-mode limit. They do not: the Fees page states the deployer fee *share*
(0-300%, 0-100% under growth mode) and the schema states the fee *scale* (`[0, 3]`, or `[0, 10)`
under growth mode). Growth mode multiplies every fee by `0.1`, so a growth-mode scale of 10 is the
100% share ceiling and a non-growth scale of 3 is the 300% share ceiling. The official nine-row
worked-example table is now executed as an oracle, including the `3.01` and `9.99` growth-mode rows.

No previously successful result changes value, and the accepted input ranges are unchanged: a
growth-mode scale of `10` or above and a non-growth scale above `3` remain `invalid-input`.

The `isAlignedQuoteToken` input is documented as eligibility for the AQAv1 fee benefit under the
current fee schedule. AQAv2 carries no trading-fee or volume-contribution benefit, and classifying a
token remains the caller's responsibility. No arithmetic changed.

Documentation only: the ten official pages that drifted since the last verification are re-pinned at
2026-09-17, and `spec/KIT-MAPPING.md` now declares the official surfaces this package does not map,
including HIP-3 funding multipliers, interest rates, clamps and the HIP-3 responsive premium.
