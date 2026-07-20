# Funding Contract

Status: M2 complete
Last verified: 2026-07-19

Official sources: `HL.DOC.FUNDING.2026-07-19`, `HL.DOC.INFO.PERP.2026-07-19`

Funding functions operate on explicit impact prices, oracle price, rate rules, position size, and
time convention. Math does not select validator oracle prices, sample the five-second premium
window, predict future samples, or assert the server's final settlement.

## `hl.funding.premium-index.calculate` v1

Source ID: `HLM.SPEC.FUNDING.PREMIUM_INDEX.V1`

Input is exactly `{ impactBidPrice, impactAskPrice, oraclePrice }`, with all three values positive.
Impact prices are caller-provided average execution prices for the explicit impact notional.

```text
impactPriceDifference = max(impactBidPrice - oraclePrice, 0)
                      - max(oraclePrice - impactAskPrice, 0)
premiumIndex = impactPriceDifference / oraclePrice
```

The function does not derive impact prices from a book; callers may use the M1 book-fill primitive.
Authority is `local-exact`; maturity is `stable` for explicit inputs.

The official source also specifies a different responsive premium formula for HIP-3 perps. That
branch is deliberately deferred to the M5 HIP-3 domain so a core-perps function cannot silently
select deployer-perp behavior.

## `hl.funding.rate.calculate` v1

Source ID: `HLM.SPEC.FUNDING.RATE.V1`

Input is exactly `{ averagePremiumIndex, rules }`, where rules is exactly
`{ interestRate, clampLower, clampUpper, baseIntervalHours, hourlyCap }`:

- all rates are signed plain decimal strings except non-negative `hourlyCap`;
- `clampLower <= 0 <= clampUpper`;
- `baseIntervalHours` is a positive safe integer no greater than 24;
- premium, interest, and clamp values use the base-interval convention supplied by the caller;
- no version-sensitive rule is hardcoded in runtime code.

```text
clampedDifference = clamp(interestRate - averagePremiumIndex, clampLower, clampUpper)
baseIntervalRate = averagePremiumIndex + clampedDifference
uncappedHourlyRate = baseIntervalRate / baseIntervalHours
hourlyRate = clamp(uncappedHourlyRate, -hourlyCap, hourlyCap)
```

The output reports every term and whether the hourly cap applied. The official default evidence is
an eight-hour base formula paid hourly at one eighth, with a 4% hourly cap; callers must still pass
those versioned rules explicitly. The officially documented standard-perp rule values are
`interestRate: "0.0001"` (0.01% per 8h), `clampLower: "-0.0005"`, `clampUpper: "0.0005"`
(±0.05%), `baseIntervalHours: 8`, and `hourlyCap: "0.04"` (4%/hour); all rates are decimal
fractions, never percentages or bps. Authority is `local-exact`; maturity is `stable`.

## `hl.funding.payment.calculate` v1

Source ID: `HLM.SPEC.FUNDING.PAYMENT.V1`

Input is exactly `{ signedPositionSize, oraclePrice, fundingRate }`; oracle price is positive and the
rate uses the actual settlement interval convention supplied by the caller. The official
`assetCtx.funding` field is already the hourly settlement rate as a decimal fraction and is directly
usable here without rescaling; `userFunding.delta.fundingRate` is likewise directly usable for
replaying past settlements.

- `payment = signedPositionSize * oraclePrice * fundingRate`;
- positive payment means the position pays funding;
- negative payment means the position receives funding;
- `accountValueDelta = -payment`.

Zero position size returns `not-applicable`. The official formula specifically uses oracle, not mark,
price. Authority is `local-exact`; maturity is `stable` for explicit inputs.

## `hl.funding.rate.annualize` v1

Source ID: `HLM.SPEC.FUNDING.ANNUALIZE.V1`

Input is exactly `{ periodicRate, periodsPerYear, convention }`; `periodsPerYear` is a positive safe
integer at most 100000 and convention is `simple` or `compound`.

- simple: `annualizedRate = periodicRate * periodsPerYear`;
- compound: `annualizedRate = (1 + periodicRate) ^ periodsPerYear - 1`.

Compound requires `1 + periodicRate > 0`. The convention is an explicit analytical assumption, not
a claim that funding receipts are reinvested. Authority is `local-exact`; maturity is `stable`.

## Trace and oracle boundary

Traces record formula/source IDs, normalized rates, explicit rule versions, Decimal40 division/power
boundaries, and caller-supplied snapshot assumptions. Dated API fixtures partially validate funding
schema, signs, current/historical rates, and user settlement fields. The official Python
SDK exposes those schemas but no independent funding implementation; its formula coverage is
`not-supported`. Validator premium averaging, final oracle, and settlement remain server-authoritative.
