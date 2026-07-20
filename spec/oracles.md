# Oracle Coverage Contract

Status: M5 complete (independently reviewed)
Last verified: 2026-07-19

Each public runtime function records `full`, `partial`, or `not-supported` independently for the
official Python SDK and live fixtures. `partial` must name the supported slice; a fixture replay
is not promoted to a server-authoritative formula comparison.

The community `@nktkas/hyperliquid` SDK served as an additional dev-only differential oracle for the
M1 precision/asset-ID slice through 2026-07-19 and was removed on 2026-07-20 to keep the oracle
surface limited to official code and dated live evidence. The retained differential vectors in
`test/differential/precision/quantize.test.ts` were originally cross-checked against it. The official
Python SDK is a float-based implementation; when it disagrees with this package at extreme precision,
the official documentation and dated live behavior adjudicate, not the SDK.

`partial` also requires executable evidence that consumes the claimed oracle slice. Formula-parity
slices invoke the public function; wire-only slices are named as such and never promoted to formula
parity. A type, request, response, or metadata schema by itself is `not-supported` for formula
coverage. `test/oracle/oracle-coverage.test.ts` rejects schema-only partial descriptions, while the
domain replay and adapter tests execute the retained slices.

## Pinned implementations

- official Python SDK: `hyperliquid-python-sdk==0.24.0`, commit
  `2fdb18f9517675ea03695a0962bd19eece9c83f0`, MIT, test-only.

## M1 support slices

| Formula | Official Python SDK | Live fixtures |
| --- | --- | --- |
| price quantize | partial: valid fixture wire canonicalization | partial: meta/response precision |
| size quantize | partial: valid fixture wire canonicalization | partial: meta/response precision |
| canonical asset key | not-supported | not-supported |
| asset ID encode | partial: main perp/spot plus one HIP-3 fixture | partial metadata alignment |
| asset ID decode | partial | partial metadata alignment |
| book metrics | not-supported | partial fixture replay |
| book fill simulation | not-supported | partial fixture replay only |

The CI harness must fail if an adapter expected by a `full`/`partial` slice is silently absent. A
domain without an applicable oracle remains explicitly `not-supported`.

## M2 and M3 support slices

- M2 coverage is recorded in `fixtures/oracles/m2-oracle-coverage.json`; positions, fees, and funding
  use live fields only as partial replay evidence because neither pinned SDK provides an independent
  formula implementation.
- M3 coverage is recorded in `fixtures/oracles/m3-oracle-coverage.json`. The pinned SDKs expose
  margin/action schemas but no independent initial-margin, maintenance-margin, liquidation, or
  scenario engine implementation.
- Mainnet/testnet M3 fixtures provide partial `meta.marginTables`, account-summary, mark, and server
  `liquidationPx` evidence. The official isolated-position response example is mapping evidence, not
  a dated live response.
- Credentialed actual-fill and `updateLeverage` testnet gates were not executed. Scenario coverage is
  `not-supported` by live fixtures and its runtime maturity remains experimental until such evidence
  exists.

## M4 support slices

- M4 coverage is recorded in `fixtures/oracles/m4-oracle-coverage.json`.
- The pinned SDKs expose price/size formatting, order/TWAP wire schemas, and state-query wrappers. They
  do not expose independent max-size, reduce-only, trigger-price, scale-allocation, TWAP-schedule,
  account-replay, or reconciliation formula engines.
- The M4 mainnet fixture contains a bounded `userFillsByTime` slice, one matching `orderStatus`, and
  open-order samples. The same recent fill orders are absent from the capped 2,000-row
  `historicalOrders` response, so full-history replay remains explicitly unavailable. Replay consumes
  the raw `startPosition`, `closedPnl`, and `fee` fields and reports neutral residuals; this evidence
  does not identify a server display-field formula without a trustworthy pre-fill cost basis.
- No signed order or credentialed testnet action is executed. Schema or snapshot evidence is never
  promoted to formula parity.

## M5 support slices

- M5 coverage is recorded in `fixtures/oracles/m5-oracle-coverage.json` and inherits the M4 coverage
  contract.
- Mainnet/testnet fixtures capture `spotMeta`, `spotMetaAndAssetCtxs`, `allMids`, `perpDexs`, and one
  real HIP-3 DEX `meta`/`metaAndAssetCtxs` response per network. The selected public HLP child has an
  empty `spotClearinghouseState` on both networks; this is absence evidence, not Spot PnL parity.
- The pinned SDKs expose metadata, formatting, asset-ID, and deploy/action schemas. Schema-only
  surfaces are recorded as `not-supported` rather than partial formula coverage. They do not expose
  independent Spot cost-basis/PnL, dust, HIP-1 genesis, HIP-3 collateral-routing, margin-mode, or
  effective fee-rate formula engines.
- Live metadata is partial schema and observed-value evidence only. Existing legacy/testnet tokens do
  not prove current deployment acceptance rules, and current HIP-3 metadata does not prove signed
  action acceptance or formula parity.
- No signed Spot, HIP-1, or HIP-3 action is executed. Actual matching, dust conversion/allocation,
  deployment acceptance, cross eligibility, settlement, and server rounding remain unsupported.
