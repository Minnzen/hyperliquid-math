# Precision Contract

Status: M1 verified
Last verified: 2026-07-19

Official sources: `HL.DOC.TICK_LOT.2026-07-19`, `HL.DOC.SIGNING.2026-07-19`

Fixture sources: `HL.LIVE.MAINNET.M1.2026-07-19`, `HL.LIVE.TESTNET.M1.2026-07-19`

## `hl.precision.decimal.canonicalize` v1

Source ID: `HLM.SPEC.PRECISION.CANONICAL_DECIMAL.V1`

- Input is exactly `{ value: string }`; unknown fields are invalid input.
- Grammar is `^-?\d+(?:\.\d+)?$`.
- Reject exponent notation, `+`, whitespace, non-finite tokens, `.5`, and `1.`.
- Normalize leading integer zeroes, remove insignificant fractional zeroes, emit no exponent, and map every signed zero to `0`.
- No protocol rounding occurs; `rounding` is empty.
- Authority is `local-exact`; maturity is `stable`.
- External Hyperliquid/Python/live oracles are `not-supported` because this is the package's own serialization contract.

## `hl.precision.price.quantize` v1

Source ID: `HLM.SPEC.PRECISION.PRICE.V1`

- Input is exactly `{ value, marketKind, szDecimals, rounding }`.
- `value` is a positive plain decimal string. `marketKind` is `perp` or `spot`; `rounding` is
  explicitly `down` or `up`. Math does not infer an order side or execution strategy.
- `szDecimals` is a non-negative safe integer no greater than `6` for perps or `8` for spot.
- First round to at most `MAX_DECIMALS - szDecimals` decimal places, where `MAX_DECIMALS` is `6`
  for perps and `8` for spot. If the result is not an integer, round it to at most five significant
  figures using the same explicit direction. Integer results are exempt from the significant-figure
  limit.
- Because prices are positive, `down` is toward zero and `up` is away from zero. A result that
  quantizes to zero is invalid input because it cannot represent a positive protocol price.
- The public result is `MathResult<{ value: string; precisionChanged: boolean }>`:
  - valid input returns `{ status: "ok", data: { value, precisionChanged } }`;
  - invalid shape, enum, integer bound, decimal grammar, non-positive input, or a result rounded to
    zero returns `{ status: "invalid-input", issues }`;
  - this total deterministic operation never returns `not-applicable` or `indeterminate`.
- `value` is canonical, has no exponent or trailing zeroes, and `precisionChanged` compares numeric
  value rather than source spelling.
- Trace uses formula ID `hl.precision.price.quantize`, version `1`, the two spec/official source
  references, and the `DECIMALJS.10.6.0` implementation source. A changed output records each applied
  decimal-place or significant-figure decision in `trace.rounding`; unchanged output records none.
- Authority is `local-exact`; maturity is `stable`. The acceptance limits are official protocol
  facts. Rounding direction is an explicit caller-provided local calculation, not a claim about
  server rounding.

## `hl.precision.size.quantize` v1

Source ID: `HLM.SPEC.PRECISION.SIZE.V1`

- Input is exactly `{ value, szDecimals }`.
- `value` is a positive plain decimal string. `szDecimals` is a non-negative safe integer no greater
  than `8`. This is the v1 supported-range ceiling observed in the dated mainnet/testnet fixtures,
  not an official protocol-wide maximum. Metadata above that ceiling remains unsupported until a
  versioned contract extends the bound; the local guard prevents unbounded Decimal quantization.
- Quantize to `szDecimals` decimal places using `down`. Size is unsigned, so this never increases the
  requested exposure.
- A result that quantizes to zero is invalid input.
- The public result is `MathResult<{ value: string; precisionChanged: boolean }>` with canonical
  trailing-zero-free serialization:
  - valid input returns `ok` with that data;
  - invalid shape, integer bound, decimal grammar, non-positive input, or a result rounded to zero
    returns `invalid-input` with issues;
  - the operation never returns `not-applicable` or `indeterminate`.
- Trace uses formula ID `hl.precision.size.quantize`, version `1`, the spec/official source references,
  and `DECIMALJS.10.6.0`. A changed output records one `down` decision; unchanged output records none.
- Authority is `local-exact`; maturity is `stable`.

## Oracle boundary

- The pinned official Python SDK canonicalizes valid numeric order values to wire strings, strips
  trailing zeroes, and rejects values that would require wire rounding, but it does not own a full
  protocol tick/lot validator. The M1 harness covers valid fixture values only, so it is partial
  wire-string evidence rather than a quantization oracle.
- Live L2/meta fixtures prove real `szDecimals` and accepted response spelling. They do not prove how
  the server would round an invalid submitted order, so live precision coverage is partial.

## M0 trace budget

For `hl.precision.decimal.canonicalize` v1, the median public-facade/internal-kernel ratio is at most
35 and the serialized valid result is at most 640 UTF-8 bytes under `scripts/benchmark.mjs`. The
repository records portable ceilings, not machine-specific timings. Increasing either ceiling requires
a reviewed architecture rationale and fresh benchmark evidence.
