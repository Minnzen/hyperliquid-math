# Numerical Semantics

Status: normative for every public runtime function

## Decimal kernel

All financial values enter and leave Math as plain decimal strings. Runtime arithmetic uses a cloned
`decimal.js` constructor with 40 significant digits and `ROUND_HALF_EVEN`. JavaScript `number` is
restricted to guarded structural integers such as indexes, counts, and millisecond durations.

Accepted decimal grammar is `^-?\d+(?:\.\d+)?$`. Every caller-supplied decimal or integer-decimal
spelling is limited to 256 characters before regex evaluation or Decimal construction. Exponents,
leading `+`, whitespace, `.5`, `1.`, `NaN`, infinity, and over-budget spellings are invalid.
Canonical output has no exponent, redundant leading zeroes, trailing fractional zeroes, or signed
zero.

The 256-character ceiling is a local resource budget, not a protocol precision claim. An over-budget
input returns `decimal-string-too-long`; its issue records `string-length:N` rather than echoing the
payload into the result or trace. Formula-specific expansion budgets are stated in the domain spec.

## Exactness and operation boundaries

Addition, subtraction, multiplication, and integer decimal shifts are exact while the 40-significant-
digit budget is not exceeded. Division and non-integer powers are finite-precision boundaries and use
HALF_EVEN. A `trace.rounding` record discloses such a boundary even when the particular operands divide
exactly; it is an operation audit, not a claim that digits were lost.

Protocol quantization is different from Decimal40 arithmetic rounding. It is always explicit and uses
the direction stated by the formula:

| Operation | Direction | Safety meaning |
| --- | --- | --- |
| Size quantization | down | Never increases requested exposure. |
| Buy protection/scale price | down | Never loosens the caller's maximum boundary. |
| Sell protection/scale price | up | Never loosens the caller's minimum boundary. |
| Order validation | compare with down-quantized value | Reports a violation; never mutates the order. |
| Book notional partial size | down | Never spends more notional than requested. |

## Hyperliquid price set

For positive price `x`, market decimal limit `D`, and direction `dir`, the valid price set is the
union of:

1. values with at most `D` decimal places and, when non-integer, at most five significant figures;
2. every positive integer, because official rules explicitly exempt integer prices from the
   significant-figure limit.

This is the integer-price exemption.

The quantizer computes the tight directional member of that union. Let `q_sig` be the value produced
by the decimal/significant-figure pipeline, `floor(x)` the greatest integer not above `x`, and
`ceil(x)` the least integer not below `x`:

```text
quantizeDown(x) = max(q_sig_down, floor(x))
quantizeUp(x)   = min(q_sig_up,   ceil(x))
```

This matters for large prices: a six-digit integer can be a tighter valid boundary than a five-
significant-figure non-integer candidate.

## Comparison and tolerances

Core formulas do not apply hidden epsilons. Tier boundaries, fee thresholds, and constraints use the
documented strict or inclusive relation exactly. Tolerances exist only when a public reconciliation
input explicitly supplies them or a test compares a display-rounded server observation.

`null`, zero, `not-applicable`, and `indeterminate` are not interchangeable. A positive-price formula
never emits zero as a sentinel. Missing protocol evidence is represented by a result state or a
not-evaluated constraint, not by infinity, an arbitrary cap, or a guessed default.

## Aggregation order

Event sequences, fills, and scenario actions are left-folded in caller-provided array order. Math does
not sort evidence. Every weighted-entry division occurs at the transition where it is required, so a
later fold consumes the already normalized prior state. Complete replay claims therefore require Kit
to provide ordered, deduplicated evidence.
