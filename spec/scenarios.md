# Perpetual Scenario Contract

Status: M3 complete; public capability remains experimental pending credentialed testnet parity
Last verified: 2026-07-19

Official sources: `HL.DOC.MARGINING.2026-07-19`, `HL.DOC.MARGIN_TIERS.2026-07-19`,
`HL.DOC.LIQUIDATIONS.2026-07-19`, `HL.DOC.EXCHANGE.2026-07-19`,
`HL.DOC.INFO.PERP.2026-07-19`

Source ID: `HLM.SPEC.SCENARIOS.PERP_ACCOUNT.V1`

`simulatePerpAccountScenario` is the public M3 scenario facade. It projects explicit perp account
actions against one frozen canonical snapshot. It is a pure counterfactual reducer: no network I/O,
no signing, no submission, no clocks, no mutable cache, no freshness policy, and no SDK wire mapping.
Kit owns transport snapshots, action submission, post-submit correction, freshness, and user-facing
policy.

The scenario result is experimental until credentialed testnet actual-fill and `updateLeverage`
fixtures bind this spec to dated server evidence. Every successful result must include an assumption
with `protocolSupport: "unverified"`; callers must not present the projection as server-submit parity.

## Canonical account snapshot

Input is exactly:

```ts
interface PerpAccountScenarioInput {
  snapshot: PerpAccountScenarioSnapshot;
  actions: readonly ScenarioAction[];
}
```

The snapshot contains:

- `crossAccountValue`: a decimal string for the frozen cross account value. It includes unrealized PnL
  for cross positions under the supplied marks and excludes isolated margin/value, isolated PnL, spot,
  vault, and portfolio-margin assets.
- `positions`: dense array of normalized perp positions. Each position has `asset`, `state`,
  `marginMode`, and user `leverage`.
- `markets`: dense array keyed by canonical asset refs. Each market has the frozen `markPrice`,
  margin tiers/rules, and the max leverage needed to validate user leverage.

A normalized position is the M2 `PerpPositionState` plus margin data:

```ts
type PerpScenarioPosition =
  | {
      kind: "flat";
      asset: CanonicalAssetRef;
      marginMode:
        | { kind: "cross" }
        | { kind: "isolated"; marginRemoval: "allowed" | "strict" };
      leverage: DecimalString;
    }
  | {
      kind: "open";
      asset: CanonicalAssetRef;
      signedSize: DecimalString;
      entryPrice: DecimalString;
      marginMode:
        | { kind: "cross" }
        | {
            kind: "isolated";
            isolatedMarginValue: DecimalString;
            marginRemoval: "allowed" | "strict";
          };
      leverage: DecimalString;
    };
```

`isolatedMarginValue` is the isolated position's current account value at the input mark. It already
contains that position's unrealized PnL and must not be counted again in `crossAccountValue`. Existing
open positions must have margin mode and leverage consistent with the snapshot's leverage setting.

The safe facade validates all plain-data shape, canonical asset refs, duplicate asset identities,
decimal strings, non-zero open sizes, positive marks, tier ordering, leverage bounds, and dense arrays
before any projection starts. Internally, scenario builds maps by derived canonical asset key and calls
only normalized internal primitives. It must not call public wrappers repeatedly for each action.

## Actions

`actions` is a dense array applied in the caller's order. Empty actions are valid and return an
identity projection with current and projected views equal.

```ts
type IsolatedMarginAllocation =
  | { kind: "not-applicable" }
  | { kind: "auto-from-leverage" }
  | { kind: "explicit-margin-delta"; amount: DecimalString }
  | { kind: "not-supported"; reason: MathReason };

type LeverageMarginEffect =
  | { kind: "none" }
  | { kind: "preserve-isolated-margin" }
  | { kind: "auto-from-leverage" }
  | { kind: "explicit-isolated-margin-delta"; amount: DecimalString }
  | { kind: "release-all-isolated-to-cross" }
  | { kind: "not-supported"; reason: MathReason };

type ScenarioAction =
  | {
      kind: "fill";
      asset: CanonicalAssetRef;
      fill: FillInput;
      isolatedMarginAllocation: IsolatedMarginAllocation;
    }
  | { kind: "cross-account-value-delta"; amount: DecimalString }
  | {
      kind: "isolated-margin-delta";
      asset: CanonicalAssetRef;
      amount: DecimalString;
    }
  | {
      kind: "set-leverage";
      asset: CanonicalAssetRef;
      targetMode: "cross" | "isolated";
      leverage: DecimalString;
      marginEffect: LeverageMarginEffect;
    };
```

### `fill`

`fill` is an actual or hypothetical fill fact. It is not an order intent and does not encode
reduce-only, close-only, time-in-force, slippage, signing, nonce, or server acceptance. Position
transition semantics are exactly `HLM.SPEC.POSITIONS.FILL_PROJECT.V1`.

Because frozen `crossAccountValue` already includes the previous position's unrealized PnL, a cross
fill changes it by realized PnL, fee, and the change in frozen-mark unrealized PnL exactly once:

```text
crossAccountValue' = crossAccountValue
  + grossRealizedPnl
  + feeAccountValueDelta
  + projectedUnrealizedPnlAtFrozenMark
  - previousUnrealizedPnlAtFrozenMark
```

Fee is calculated on the full fill once, including a flip's opening remainder. The unrealized-PnL
delta is required to remove the previous mark-to-market amount and install the projected one; adding
only realized PnL would overstate equity whenever the old or projected unrealized PnL is non-zero.

For an isolated position, realized PnL and fee apply to `isolatedMarginValue` exactly once. When a
fill creates or increases isolated exposure, `isolatedMarginAllocation` is required:

- `not-applicable`: valid only when the action does not create, preserve, or increase isolated
  exposure.
- `explicit-margin-delta`: signed cross-to-isolated transfer. A positive amount debits
  `crossAccountValue` and credits `isolatedMarginValue`; a negative amount does the opposite, subject
  to max-removable and non-negative account invariants.
- `auto-from-leverage`: compute target initial margin from the M3 margin contract,
  `abs(projectedSize) * markPrice / leverage`, then transfer
  `max(targetInitialMargin - post-fill-isolatedMarginValue, 0)` from cross to isolated.
- `not-supported`: returns `indeterminate` at the action path.

Static official evidence does not prove how existing isolated positions should automatically
reallocate margin on reduce, close, or flip. M3 therefore returns `indeterminate` for those paths; an
allocation field cannot manufacture protocol evidence for an undocumented close reallocation.

### `cross-account-value-delta`

This is a pure account-value delta, such as a deposit, withdrawal, or counterfactual adjustment already
resolved by Kit. It changes only `crossAccountValue`. It never changes isolated margin, leverage,
position size, entry price, or marks. Negative deltas must pass non-negative cross account and
transfer-margin/max-removable checks.

### `isolated-margin-delta`

This is an explicit signed isolated margin adjustment for one isolated position. Positive values debit
cross and credit isolated; negative values debit isolated and credit cross. It is valid only for an
open isolated position and must satisfy non-negative isolated margin, max-removable, and maintenance
invariants. It does not change position size, entry price, leverage, or marks.
For `marginRemoval: "strict"`, every negative delta is `indeterminate` with a known-unsupported
protocol reason; Math does not treat strict-isolated removal as an arithmetic preference.

### `set-leverage`

`set-leverage` is the Math representation of the official `updateLeverage` shape
(`isCross` plus integer leverage), plus an explicit margin effect. The leverage is validated against
the market max leverage and is not a substitute for the current liquidation formula. For every
projected open position, the result also evaluates
`leverage <= tierFor(abs(size) * frozenMark).maxLeverage` as
`hl.scenario.opening-leverage-within-tier`. This is an objective opening constraint with
`transitionEffect: "preserves-transition"`; it does not claim that an existing position whose mark
moved into a lower-leverage tier is malformed.

Valid effect combinations:

- Existing cross to cross with `marginEffect: { kind: "none" }`: updates user leverage only. It does
  not independently change current or projected liquidation price because cross liquidation depends on
  account value, position notional, and maintenance margin after the position exists.
- Existing isolated to isolated: `preserve-isolated-margin`, `auto-from-leverage`, or
  `explicit-isolated-margin-delta`.
- Cross to isolated: `auto-from-leverage` or `explicit-isolated-margin-delta`.
- Isolated to cross: `release-all-isolated-to-cross`, which credits the entire isolated margin value
  to cross and changes the position's mode to cross.
- Any `not-supported` effect: `indeterminate` at the action path.

Static official docs do not prove server acceptance or automatic margin reallocation for existing
position mode switches. All mode-switch projections remain experimental and protocol-unverified until
the M3 testnet matrix records accepted/rejected cases and post-action server snapshots.

## All-or-nothing reducer

The public facade validates the full action list before exposing any projected value. Then it applies
actions in order to an internal working state. It never sorts, coalesces, or drops actions.

- Malformed input returns `invalid-input`.
- A missing transition fact, `not-supported` allocation/effect, or rule availability needed for state
  transition returns `indeterminate`.
- A violated `ScenarioConstraintCheck` with `transitionEffect: "preserves-transition"` may still return
  a counterfactual projection with the check attached.
- A violated `ScenarioConstraintCheck` with `transitionEffect: "blocks-transition"` returns
  `indeterminate` unless the caller has already supplied the unique lower-level transition as an
  explicit action.

Every `MathIssue.path` and missing path is an RFC 6901 JSON Pointer. Action failures use zero-based
paths such as `/actions/2/fill/size`, `/actions/1/isolatedMarginAllocation`, or
`/actions/3/marginEffect`. Failed scenarios do not expose a public prefix state. Trace may include the
completed prefix count and failed action index, but it must be incomplete and must not place the
intermediate working state in `value`.

## Output

Successful output is:

```ts
interface PerpAccountScenarioResult {
  current: AccountMarginView;
  projected: AccountMarginView;
  delta: AccountMarginDelta;
  actions: readonly ProjectedActionView[];
  fills: readonly ProjectedFillView[];
  positionTransitions: readonly PositionTransitionView[];
  assumptions: readonly Assumption[];
  constraintChecks: readonly ScenarioConstraintCheck[];
}
```

`current` is the margin/liquidation view for the input snapshot. `projected` is the same view after
all actions. `delta` contains exact decimal-string differences between projected and current account
value, isolated margin values, position sizes, margin requirements, and liquidation prices where both
sides are applicable, plus `actionsApplied`, the integer count of actions the projection applied.

`actions` reports each applied action's normalized asset key, action index, account-value transfer,
position effect, margin effect, and formula/source IDs. `fills` and `positionTransitions` expose the
M2 transition facts used by fill actions. `constraintChecks` are objective facts only; they do not
carry UI severity, warnings, blocking policy, or recommendations.

Every result assumption must state the frozen marks, full-fill/explicit-action semantics, explicit fee
model, leverage and isolated allocation semantics, unchanged funding between current and projected
views, unchanged non-target positions unless an action targets them, and
`protocolSupport: "unverified"` while credentialed testnet evidence is absent. Projected liquidation
prices must never be returned without these assumptions.

## Oracle boundary

Official margin, margin-tier, liquidation, exchange, and info docs define formulas and API shapes for
the primitives that scenario composes. Dated live fixtures can replay frozen snapshots and actual fills
when available. The official Python SDK does not provide an independent complete scenario
engine. Until credentialed testnet fixtures cover actual-fill replay and the `updateLeverage` matrix,
scenario oracle coverage is partial and the public function maturity remains `experimental`.
