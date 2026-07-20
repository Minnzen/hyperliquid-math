# HIP-1 Contract

Status: M5 verified
Last verified: 2026-07-19

Official sources: `HL.DOC.HIP1.2026-07-19`, `HL.DOC.HIP1_DEPLOY.2026-07-19`

Fixture sources: `HL.LIVE.MAINNET.M5.2026-07-19`, `HL.LIVE.TESTNET.M5.2026-07-19`

HIP-1 Math validates deterministic deployment and genesis constraints from plain data. It does not
bid in auctions, submit deploy actions, create spot books, halt tokens, execute dusting, or predict
server governance decisions. Token names are display labels, not stable asset identity.

## `hl.hip1.deployment.validate` v1

Source ID: `HLM.SPEC.HIP1.DEPLOYMENT_VALIDATE.V1`

Input is exactly:

```ts
{
  name: string;
  weiDecimals: number;
  szDecimals: number;
  maxSupplyWei: string;
  userGenesisWei: string;
  anchorGenesisWei: string;
}
```

Rules:

- The official constraint is that `name` has at most 6 characters. This v1 contract deliberately
  interprets a character as one ECMAScript Unicode code point; that counting convention is a local
  defensive assumption, not a claim about undocumented server normalization. Unpaired surrogate
  spellings are invalid plain text. Math preserves leading and trailing spaces and does not trim,
  normalize, case-fold, or use the display label as identity. The official docs do not require
  token-name uniqueness, so Math does not check uniqueness.
- `weiDecimals` and `szDecimals` are non-negative safe integers in the local defensive range
  `0..255`; `szDecimals + 5 <= weiDecimals` is an objective deployment constraint.
- `lotSizeWei = 10 ** (weiDecimals - szDecimals)`.
- `maxSupplyWei`, `userGenesisWei`, and `anchorGenesisWei` are non-negative integer decimal strings;
  positive maximum supply is an objective constraint.
- `userGenesisWei + anchorGenesisWei == maxSupplyWei`. This is the documented `Genesis.maxSupply`
  checksum over preceding `UserGenesis` calls: `userGenesisWei` aggregates `userAndWei`, while
  `anchorGenesisWei` aggregates `existingTokenAndWei`.
- Every non-zero supply component must be an integer number of minimal units by construction. Math does
  not round supply values.
- Kit aggregates repeated `userGenesis` calls and anchor allocations into the two supplied totals;
  Math neither validates addresses nor submits deployment actions. Hyperliquidity is configured by a
  later action and is intentionally absent from this checksum.

Valid input returns `ok` with `{ lotSizeWei, totalGenesisWei, checks }`. Failed objective constraints
return `ok` with violated checks when the input shape is valid. Invalid shape, unsafe integers, invalid
Unicode, decimal grammar violations, negative values, or arithmetic overflow against the Decimal40
guard return `invalid-input`.

Authority is `local-exact`; maturity is `experimental` because HIP-1 deployment acceptance, auction
state, deployer permissions, and any future governance limits remain server-authoritative.

## `hl.hip1.anchor-genesis.evaluate` v1

Source ID: `HLM.SPEC.HIP1.ANCHOR_GENESIS_EVALUATE.V1`

Input is exactly `{ holderBalanceWei, anchorTokenMaxSupplyWei }`, both non-negative integer decimal
strings.

The official anchor genesis eligibility weight is:

`weightWei = max(holderBalanceWei - anchorTokenMaxSupplyWei / 1000000, 0)`

Equivalently, holders only receive positive weight above the `0.0001%` max-supply threshold.

- Output is `{ thresholdWei, weightWei, eligible }`.
- `eligible` is true iff `weightWei > 0`.
- Threshold and weight retain the exact fixed-six rational implied by the denominator. If an exact
  successful output would require more than 40 significant digits, the function returns
  `invalid-input` instead of silently rounding at Decimal40 precision.
- This function evaluates one holder's deterministic weight only. It does not allocate final token
  amounts across all holders, decide tie behavior, round final allocations, or prove snapshot
  inclusion. `thresholdWei` and `weightWei` may contain fractional minimal-unit values because the
  official proportional-weight formula is rational; this function does not round an allocation.

Authority is `local-exact`; maturity is `experimental`.

## Trace assumptions

Successful HIP-1 traces record the frozen deploy payload, the local code-point counting assumption,
decimal metadata, lot-size derivation, genesis checksum, and exact rational anchor-threshold
calculation.

## Oracle boundary

Official docs define the v1 constraints above. Live spot metadata can prove deployed token
`weiDecimals`, `szDecimals`, names, and token IDs after the fact, but it does not prove a rejected
deployment or final genesis allocation rule; legacy or testnet metadata that violates a current
deployment constraint is observation evidence, not a counter-oracle. The official Python SDK exposes deployment and
spot schemas only; it is not a formula oracle for acceptance, auction, or allocation. Server
deployment acceptance, auction state, actual genesis distribution, and token lifecycle actions are
not-supported in Math.
