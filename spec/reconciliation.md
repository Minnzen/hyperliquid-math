# Perpetual Reconciliation Contract

Status: M4 complete (independently reviewed)
Last verified: 2026-07-19

Official sources: `HL.DOC.INFO.ORDERS_FILLS.2026-07-19`,
`HL.DOC.WS.USER_FILLS.2026-07-19`, `HL.DOC.ENTRY_PNL.2026-07-19`

Runtime/source refs: `DECIMALJS.10.6.0`, `HLM.SPEC.POSITIONS.FILL_PROJECT.V1`

Fixture source: `HL.LIVE.MAINNET.M4.2026-07-19`

Reconciliation consumes an already ordered, deduplicated, complete event set. Kit owns REST/WS
backfill, pagination, endpoint caps, sorting evidence, `oid`/`cloid` joins, and freshness. `oid` is the
order lifecycle join key; `tid` plus transaction context is a fill identity input. Math does not infer
missing history from current state.

## `hl.reconciliation.perp-account.replay` v1

Source ID: `HLM.SPEC.RECONCILIATION.REPLAY.V1`

- Input is exactly `{ snapshot, events, completeness }`.
- Snapshot is exactly `{ cashBalance, positions }`. Positions are unique by canonical asset identity
  and each contains `{ asset, state }`, where state is the M2 perp position state.
- `cashBalance` is the account's cash ledger excluding unrealized PnL, under a caller-chosen
  convention applied identically to the base and observed snapshots. There is no same-named official
  field; the recommended mapping is `marginSummary.accountValue - sum(position.unrealizedPnl)` from
  one `clearinghouseState` snapshot. Replay projects it as
  `base cash + realized PnL + fee deltas + funding deltas + transfer deltas`.
- Completeness is `{ kind: "complete" }` or `{ kind: "incomplete", reason }`. Incomplete history
  returns `indeterminate` without exposing a replay prefix.
- Events are explicit array order and each has a unique non-empty `eventId` and safe-integer
  `timestampMs`. Timestamps must be nondecreasing; same-timestamp array order is authoritative input.
- Fill event: `{ kind: "fill", eventId, timestampMs, asset, fill, serverFillEvidence? }`. It reuses
  the normalized M2 fill transition directly, creates separate `realized-pnl` and `trade-fee` ledger
  lines, and changes cash balance by `grossRealizedPnl + feeAccountValueDelta`.
- Optional `serverFillEvidence` is exactly `{ startPosition, closedPnl, fee }` using canonical signed
  decimal strings copied from raw fill evidence after caller normalization. When supplied, replay
  returns objective residuals:
  - `startPositionResidual = server.startPosition - previous signed size`, using `0` for flat;
  - `serverClosedPnlMinusProjectedGrossRealizedPnl = server.closedPnl - projection.grossRealizedPnl`;
  - `serverClosedPnlMinusMathNetClosedPnl = server.closedPnl - projection.closedPnl`;
  - `serverFeeMinusProjectionFeeAmount = server.fee - projection.feeAmount`.
- These residuals compare raw server display fields to Math projections; they do not assert whether
  Hyperliquid's `closedPnl` field is gross, net, rounded, or otherwise protocol truth. When evidence
  is absent, replay still succeeds and each fill transition returns `serverFillEvidence: null` plus
  `serverFillResiduals.status = "not-evaluated"`.
- Funding event: `{ kind: "funding", eventId, timestampMs, asset, accountValueDelta }`. The signed
  server/caller-supplied delta becomes a `funding` ledger line. The theoretical funding formula remains
  the M2 API and is not recomputed from incomplete event fields.
- Transfer event: `{ kind: "transfer", eventId, timestampMs, accountValueDelta }`. The signed delta
  becomes a `transfer` ledger line.
- A fill for an asset absent from the initial snapshot starts from flat. Funding may reference any
  valid asset identity because it is already a settled account delta.
- Output includes initial/final snapshot, per-event transitions, objective ledger lines, and totals for
  realized PnL, fees, funding, transfers, and net cash delta.
- The reducer never calls public wrappers. Snapshot and all events are normalized once, then internal
  position transition logic is reused.
- Authority is `local-exact`; maturity is `stable`. Successful trace assumptions state that event
  ordering, event completeness, fill evidence normalization, and the initial snapshot are all
  caller-provided.

## `hl.reconciliation.perp-account.reconcile` v1

Source ID: `HLM.SPEC.RECONCILIATION.RECONCILE.V1`

- Input is exactly `{ projected, observed, tolerances, evidence }`.
- Projected and observed snapshots use the replay snapshot shape. Tolerances are non-negative decimal
  strings for `cashBalance`, `signedSize`, and `entryPrice`.
- Evidence is `{ kind: "complete", eventCount }` or `{ kind: "incomplete", reason }`. Incomplete
  evidence returns `indeterminate`; Math does not guess a unique cause.
- Cash residual is `observed.cashBalance - projected.cashBalance`.
- Assets are joined by canonical identity across the union of both snapshots:
  - flat/flat is matched;
  - open/open reports signed-size and entry-price residuals;
  - flat/open, open/flat, or a missing side reports an explicit state mismatch.
- Numeric checks are satisfied iff `abs(residual) <= tolerance`. State mismatches are violated checks.
- Output includes residuals, objective checks, and `corrected = observed`. The correction is tagged as
  explicit server/current-snapshot authority inside the public result; no local projection overwrites
  observed state.
- Residuals identify differences, not causes. Fee, funding, transfer, liquidation, or missing-fill
  attribution is only available when corresponding events were present in replay.
- Trace arithmetic authority is `local-exact`; maturity is `stable`. Successful trace assumptions
  state that the projected snapshot, current observed snapshot, event completeness evidence, and
  tolerances are caller-provided. The `corrected` snapshot itself remains server/current-snapshot
  authoritative in the public result.

## Oracle boundary

- Neither pinned SDK exposes a replay or reconciliation engine. Both are partial schema/snapshot
  evidence only.
- The mainnet fixture records a bounded `userFillsByTime` slice, one authoritative `orderStatus`, a
  changing open-order sample, and the failure to recover those very recent fills from the capped
  `historicalOrders` response. That is evidence for fail-closed completeness, not a full ledger oracle.
- Credential-free fixture capture does not prove ordering across REST/WS races. Kit must supply explicit
  ordering and completeness evidence.
