# Identifier Contract

Status: M1 verified; M6 outcome v2 API/spec frozen
Last verified: 2026-07-30

Official sources: `HL.DOC.ASSET_IDS.2026-07-30`, `HL.DOC.INFO.PERP.2026-07-19`,
`HL.DOC.INFO.SPOT.2026-07-19`, `HL.DOC.INFO.OUTCOME_META.2026-07-30`

## `hl.identifiers.asset-key.derive` v1

Source ID: `HLM.SPEC.IDENTIFIERS.CANONICAL_KEY.V1`

- Input is exactly `{ network, marketKind, dex, index }`.
- `network` is `mainnet` or `testnet`; `marketKind` is `perp` or `spot`; `index` is a non-negative
  safe integer.
- `dex` is the official builder-dex name exactly as returned by `perpDexs` (for example `xyz`), or
  `null` for the first-party dex — the official `perpDexs` entry for the first-party dex is `null`.
  An empty string is normalized to `null` because the official `dex` request parameter uses `""` for
  the same meaning. A non-null `dex` must be Unicode NFC, well-formed, and contain no C0/C1 control
  characters. `marketKind: "spot"` requires `dex: null`; the spot universe has no builder dexes.
- `index` is the market's position in that dex's `meta.universe` (spot: the pair index in
  `spotMeta.universe`).
- Output grammar is `hl:<network>:<market-kind>:<encoded-dex>:<index>`, where a `null` dex encodes as
  an empty segment (`hl:mainnet:perp::0` is first-party perp index 0).
- Dex encoding follows the RFC 3986 component rules. Percent-encoding uses UTF-8 and uppercase
  hexadecimal. A literal percent sign is encoded again, preventing pre-encoded/raw ambiguity.
- The key is Math-owned join identity used to match rows within one call. Coin/display names and SDK
  wire mappings remain Kit inputs.
- Authority is `local-exact`; maturity is `stable`.
- The public result is `MathResult<string>`: a valid input returns `ok`; invalid shape, enums,
  dex, or integer input returns `invalid-input`; `not-applicable` and `indeterminate` are not
  used. Trace formula ID is `hl.identifiers.asset-key.derive` v1, sourceRefs contain this spec source,
  and rounding/assumptions are empty.

## `hl.identifiers.asset-id.encode` v2

Source ID: `HLM.SPEC.IDENTIFIERS.ASSET_ID.V2`

Input is exactly one of:

- `{ kind: "perp", index }` -> `index`;
- `{ kind: "spot", index }` -> `10000 + index`;
- `{ kind: "hip3-perp", dexIndex, index }` -> `100000 + dexIndex * 10000 + index`;
- `{ kind: "outcome", outcome, side }` -> `100000000 + 10 * outcome + side`.

All indexes are non-negative safe integers. Perp and HIP-3 `index` must be below `10000`, matching
the protocol's 10,000-ID blocks. Spot `index` must produce an ID below `100000`. HIP-3 `dexIndex`
starts at `1`, and the result must remain below the outcome-asset range at `100000000`. Outcome is a
non-negative safe integer, side is the number `0` or `1`, and the encoded asset ID must remain a safe
integer.

The output is a JSON safe integer. Network metadata determines which indexes exist; this formula
only encodes an explicitly supplied metadata index. The public result is `MathResult<number>`: a
valid supported-range input returns `ok`; invalid shape, discriminator, integer, or range returns
`invalid-input`; `not-applicable` and `indeterminate` are not used. Trace formula ID is
`hl.identifiers.asset-id.encode` v1, sourceRefs contain the spec plus official asset-ID source, and
rounding/assumptions are empty. Existing perp, spot, and HIP-3 valid inputs preserve their v1 output
bytes. Outcome results use `maturity: "experimental"`; existing supported ranges remain `stable`.

## `hl.identifiers.asset-id.decode` v2

Source ID: `HLM.SPEC.IDENTIFIERS.ASSET_ID.V2`

- Input is exactly `{ assetId }`, a non-negative safe integer wrapped in a plain object.
- `0..9999` decodes to `{ kind: "perp", index: assetId }`.
- `10000..99999` decodes to `{ kind: "spot", index: assetId - 10000 }`.
- `100000..109999` is a locally unsupported gap derived from the documented builder formula and the
  current SDK/fixture layout, where builder `dexIndex` starts at `1`. Hyperliquid does not explicitly
  name this range as reserved; v1 rejects it rather than fabricating a main-DEX builder decode.
- `110000..99999999` decodes by `dexIndex = floor((assetId - 100000) / 10000)` and
  `index = (assetId - 100000) mod 10000`.
- For IDs at or above `100000000`, `encoding = assetId - 100000000`,
  `side = encoding mod 10`, and `outcome = floor(encoding / 10)`.
- Outcome side `0` or `1` returns `{ kind: "outcome", outcome, side }`.
- Outcome side digits `2..9` return `invalid-input` with reason
  `invalid-outcome-side-encoding` at `/assetId`; the function never guesses.

Encode/decode authority is `local-exact`; maturity is `stable` for perp, spot, and HIP-3 ranges and
`experimental` for outcome ranges.

The public result is
`MathResult<{ kind: "perp" | "spot"; index: number } | { kind: "hip3-perp"; dexIndex: number; index: number } | { kind: "outcome"; outcome: number; side: 0 | 1 }>`:

- a supported-range safe integer returns `ok` with the exact decoded discriminated union;
- invalid shape/integer and the locally unsupported `100000..109999` gap return `invalid-input`;
- a valid outcome side digit returns `ok`; an invalid side digit returns `invalid-input`;
- `not-applicable` is not used.

Trace formula ID is `hl.identifiers.asset-id.decode` v2, sourceRefs contain the v2 spec plus official
asset-ID source, and rounding/assumptions are empty. Outcome results are complete and experimental;
existing supported results are complete and stable. The v1 outcome `indeterminate` result and its
`/outcomeDexIndex`/`/marketIndex` missing hints are removed because they do not describe the official
encoding.

## Oracle boundary

- The official Python SDK is a full oracle for main-perp and spot metadata mapping and partial for
  HIP-3/reverse decoding.
- Live metadata fixtures prove index alignment and network-specific existence, but the documented
  arithmetic remains the normative source. Fixture coverage is partial unless an ID is returned by
  an official endpoint in the same schema.
