# Public Contract

Source ID: `HLM.SPEC.CONTRACTS.V1`

## Plain data

Public inputs and outputs contain only JSON-compatible plain data. Financial values are strings.
JSON numbers may be used only for finite safe integers such as versions and action indexes. Decimal,
Date, Map, Set, bigint, functions, class instances, `undefined`, `NaN`, and infinities are forbidden.
Safe facades validate observable prototypes, own keys, and own data descriptors without invoking
accessors. ECMAScript exposes no portable way to distinguish a fully transparent `Proxy` from its
plain-data target, so callers must pass JSON-decoded values rather than proxies; observable proxy
effects that violate the required structure, or throw during inspection, become `invalid-input`
without escaping the facade.

## Results

Every public runtime function returns `{ value, trace }`. `value.status` is exactly one of `ok`,
`invalid-input`, `not-applicable`, or `indeterminate`; these are mathematical outcomes, not UI policy
or execution errors.

## Trace completion

`complete` means the declared formula ran to a deterministic result for the normalized input.
`incomplete` means input or transition validation prevented completion. An incomplete multi-action
scenario identifies its zero-based action index and returns no prefix projection.

Every `MathIssue.path` and reason path is an RFC 6901 JSON Pointer. The root path is the empty string.

## Constraints

Generic `ConstraintCheck` reports only satisfied, violated, not-applicable, or not-evaluated.
`transitionEffect` exists only on violated `ScenarioConstraintCheck` values because only a scenario can
decide whether a constraint preserves or blocks its declared transition.

## Boundary

No public result contains severity, warning copy, blocking policy, freshness policy, transport state,
SDK wire state, or user recommendation. Kit and App derive those decisions from Math facts.

## Public formula proof obligation

Every public runtime function appears exactly once in `spec/public-functions.json`. Its entry names the
export, subpath, formula ID and integer version, normative spec path, non-empty test kinds, and explicit
coverage state for the official Python SDK and live fixtures. A missing oracle is
`not-supported`; it is never omitted or represented as a passing comparison.
