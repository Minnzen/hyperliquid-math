# CLAUDE.md — hyperliquid-math

Deterministic Hyperliquid math on plain data. MIT. Zero network I/O; the only runtime dependency is
`decimal.js`. Read `spec/README.md` for the formula manual and `spec/KIT-MAPPING.md` for the
official-API field mapping before changing anything.

## Non-negotiable discipline

1. **Money never touches floats.** All decimal arithmetic goes through the shared Decimal40
   configuration. Rounding direction is always conservative for the user.
2. **Every public function is a hostile facade.** It validates plain data itself (exact key sets,
   decimal-string grammar, prototype checks) and returns `{ value, trace }`. Public functions never
   throw. Internal normalized functions are not exported.
3. **Spec and implementation move together.** Every public runtime function has an entry in
   `spec/public-functions.json`, a normative section in its domain spec, and oracle coverage
   recorded in `fixtures/oracles/`. CI reconciles all of it (`pnpm check`); a claim without
   executable evidence is a build failure.
4. **Official vocabulary only.** Input fields mirror official protocol concepts (`dex`, `szDecimals`,
   `lowerBound`). Do not invent package-private terms for things the protocol already names; when a
   package-side convention is unavoidable, document the mapping in `spec/KIT-MAPPING.md`.
5. **Facts, not policy.** Math returns values, issues, constraint checks, assumptions, and trace.
   Severity, warnings, blocking, freshness, signing, and submission belong to the caller.
6. **Honest evidence.** Oracle coverage states `full`/`partial`/`not-supported` per function; absence
   is declared, never faked. Server-authoritative behavior is comparison evidence, not a formula
   source.

## Working here

- `pnpm check` must be green before any commit: lint, build, typecheck, 100% coverage
  (lines/branches/functions), manifest reconciliation, import boundaries, API report, publint,
  benchmarks.
- Write the failing test first; expected values in tests are hand-derived from the spec formulas,
  precise to 40 significant digits.
- New public API requires: spec section, manifest entry, oracle-coverage entry, unit + property +
  contract tests, and an API-report update (`pnpm api:report`).
- Before `1.0.0`, a minor release may include an explicitly reviewed breaking public-contract change;
  its changeset and release notes must name the break and migration. Patch releases must remain
  backward compatible. At and after `1.0.0`, breaking public-contract changes require a major release.
