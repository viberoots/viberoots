## Cross‑Language Cleanup and Consolidation — PR Sequence (Go ↔ C++)

This plan proposes a short series of small, focused PRs to strengthen the shared abstractions across Go and C++, reduce duplication, and formalize validation and provider naming. Each PR is independently mergeable and ships with tests and documentation updates. The goal is to keep each change low‑risk and verifiable.

---

### PR 1 — Adapter‑neutral validation hook in the exporter

Intent/Impact

- Allow each language adapter to enforce its own validation (e.g., authoritative Go checks) without central exporter bias.

Detailed Design

- `build-tools/tools/buck/exporter/lang/contract.ts`: add optional `validate(nodes: Node[]): Promise<void> | void` on `Adapter`.
- `build-tools/tools/buck/exporter/main.ts`: after computing `active` adapters and before label merges, call `await adapter.validate(nodes)` (best effort; fail fast if throws).
- `build-tools/tools/buck/exporter/lang/go.ts` (or current Go adapter): implement the existing authority check (targets with `.go` sources must have `rule_type` starting with `go_` or a `lang:go` label) inside `validate`.
- Keep deterministic ordering/metrics unchanged.

Tests

- `build-tools/tools/tests/exporter/exporter.adapter-validate.go-missing-labels.test.ts`: simulate nodes with `.go` sources missing `lang:go` and expect validate() to fail with actionable error.
- `build-tools/tools/tests/exporter/exporter.adapter-validate.cpp-noop.test.ts`: ensure cpp adapter validate() is a no‑op (or minimal checks) and exporter succeeds.

Docs

- Update `docs/handbook/new-language-walkthrough.md` to note the adapter `validate()` hook and expectations.

Consequence if not implemented

- Exporter remains Go‑tilted and gains technical debt as other languages add bespoke checks.

Risks

- Minimal; ensure validate() execution order is deterministic (sorted by adapter name, as today).

Acceptance Criteria

- Mixed‑language export passes; Go validation error appears only when applicable; no behavior change for valid repos.

---

### PR 2 — Unify nixpkgs provider naming and attr normalization

Intent/Impact

- Single source of truth for nixpkgs attr normalization and provider target names across generators and auto‑map.

Detailed Design

- `build-tools/tools/lib/providers.ts`:
  - Add `normalizeNixAttr(attr: string): string` (force `pkgs.` prefix; map `pkgs.gtest` → `pkgs.googletest`; lower‑case; trim).
  - Add `providerNameForNixAttr(attr: string): string` → `nix_pkgs_<attr_with_non_alnum_to_underscore>`.
- Refactor usages:
  - `build-tools/tools/buck/gen-auto-map.ts`: replace inline `nixpkg:` normalization and naming with new helpers.
  - `build-tools/tools/buck/providers/cpp.ts`: remove local name/normalize helpers and use shared implementations; keep stamping logic.

Tests

- `build-tools/tools/tests/provider-names/nix-attr-normalization.test.ts`: table‑driven tests for representative attrs (openssl, zlib, gtest/googletest, deep paths like `pkgs.gnome.glib`).
- Adjust existing provider wiring and auto‑map tests to assert normalized names.

Docs

- Update `docs/handbook/provider-sync-cookbook.md` to reference the shared helpers and naming.

Consequence if not implemented

- Divergent naming across scripts risks provider name collisions and inconsistent invalidation.

Risks

- Name changes could break existing references if any were hand‑typed. Mitigate by only changing generation sites; generated provider names remain stable by design.

Acceptance Criteria

- All provider naming originates from `build-tools/tools/lib/providers.ts`. Auto‑map and provider sync generate identical names for the same attrs.

---

### PR 3 — Shared Nix planner helpers (reduce duplication in planners)

Intent/Impact

- Consolidate common Nix helpers used by planners (name/label/deps utilities, config suffix cleaning).

Detailed Design

- Add `build-tools/tools/nix/planner/lib.nix` with small pure helpers:
  - `get = attrs: k: attrs.${k} or null`
  - `cleanLabel = s: strip trailing \" (config//...)\" suffix`
  - `labelsOf`, `nameOf`, `depsOf`, `srcsOf`
- Refactor `build-tools/tools/nix/planner/cpp.nix` to import and use these helpers.
- (If/when Go planner module exists) migrate to same helpers; otherwise leave Go using existing path until planner extraction occurs.

Tests

- Existing C++ scaffold/build tests must continue to pass.
- Add `build-tools/tools/tests/cpp/planner.lib-helpers.integration.test.ts` to verify helper behavior (e.g., `cleanLabel` on configured labels).

Docs

- Update developer notes in `build-tools/docs/build-system-design.md` Appendix to reference `planner/lib.nix`.

Consequence if not implemented

- Continued duplication and higher cognitive load for future planner changes.

Risks

- Low; keep helpers tiny and pure to avoid evaluation side effects.

Acceptance Criteria

- C++ planner reads clearly with shared helpers; no behavior change.

---

### PR 4 — Standardize dev override handling in Nix templates

Intent/Impact

- Single implementation for dev override JSON + CI guard across languages; keep policy identical.

Detailed Design

- Add `build-tools/tools/nix/dev-overrides.nix` exposing:
  - `readJsonOverride = { envName, ciForbidden ? true }: { map, warnEffect, ciGuard }`
  - Normalizes env, emits `builtins.trace` warning locally when set, throws in CI when `ciForbidden`.
- Update `build-tools/tools/nix/templates/cpp.nix` and Go templates (`build-tools/tools/nix/lang-templates.nix` excerpts) to use it.

Tests

- `build-tools/tools/tests/cpp/dev-override.warning.local.test.ts` and `.ci-forbidden.test.ts` continue to pass; add symmetric Go tests if not present.

Docs

- Update `docs/handbook/troubleshooting.md` and `build-tools/docs/build-system-design.md` (dev overrides sections) to point to the shared helper.

Consequence if not implemented

- Drift between languages in override semantics; harder to audit.

Risks

- None significant; keep helper minimal.

Acceptance Criteria

- Both languages’ templates import and use the shared helper; behavior unchanged except code deduplication.

---

### PR 5 — Unify name sanitization with tests (Nix ↔ Starlark)

Intent/Impact

- Ensure Starlark macro sanitization mirrors Nix’s `sanitizeName` exactly, preventing mismatched output artifact names.

Detailed Design

- Confirm canonical `sanitizeName` location (currently used via `build-tools/tools/nix/lang-helpers.nix` as `H.sanitizeName`). Document the algorithm.
- Update `build-tools/cpp/defs.bzl` `_sanitize_to_bin_name` to match the canonical algorithm exactly (cover `//`, `:`, `/`, spaces, case, non‑alnum behavior) or add a tiny test asserting equality with a generated value.
- Add a test that computes a matrix of labels and verifies equality between Nix and Starlark sanitization for expected names.

Tests

- `build-tools/tools/tests/cpp/sanitize-name.parity.test.ts`: build a table of labels and assert equality against the Starlark macro’s expectations.

Docs

- Add a short note under `docs/handbook/macro-stamping-cookbook.md` describing the sanitize policy.

Consequence if not implemented

- Rare but brittle mismatches in expected file names within the graph‑generator outputs vs. Buck macros.

Risks

- Very low; ensure no regressions by locking tests first.

Acceptance Criteria

- Tests prove sanitization parity; no behavior changes in builds.

---

### PR 6 — Shared \"selected build\" helper for external runner flows

Intent/Impact

- Replace duplicated shell in macros with a small zx helper; easier debugging and consistent logs.

Detailed Design

- Add `build-tools/tools/dev/build-selected.ts` (zx) that:
  - Ensures `build-tools/tools/buck/graph.json` exists (export it if missing for the current repo context).
  - Runs `nix build .#graph-generator-selected` with `BUCK_TARGET` and `--accept-flake-config`.
  - Writes concise logs and returns the out path.
- Update `build-tools/cpp/defs.bzl` `_cpp_nix_build_impl` and `_cpp_nix_test_impl` to invoke the zx helper instead of inlined bash (keep behavior identical).
- Optionally add a thin wrapper for Go if external‑runner is used similarly.

Tests

- Existing C++ external runner tests still pass; new tests can assert the helper prints expected diagnostics and returns a valid path.

Docs

- Update `docs/handbook/testing.md` to reference the helper for external‑runner builds.

Consequence if not implemented

- More complex bash embedded in macros; higher maintenance cost.

Risks

- Minimal; keep zx script pure and deterministic.

Acceptance Criteria

- Same outputs; simpler macro implementation.

---

### PR 7 — Shared provider sync IO utilities (stamps + writeIfChanged)

Intent/Impact

- Reduce duplication by centralizing common stamp generation and deterministic write patterns.

Detailed Design

- Extend `build-tools/tools/lib/fs-helpers.ts` with:
  - `writeStamp(file: string, inputs: Array<{ path: string; content?: string }>)`
  - `stableUnique<T>(arr: T[], key: (t: T) => string): T[]`
- Refactor `build-tools/tools/buck/providers/cpp.ts` and Go provider sync to use these helpers.

Tests

- Existing provider sync tests continue to pass; add a micro test for `writeStamp` behavior (content hash stability and ordering).

Docs

- Update `docs/handbook/provider-sync-cookbook.md` to reference the shared utilities.

Consequence if not implemented

- Continued divergence and copy/paste in provider scripts.

Risks

- Low; avoid over‑factoring—keep helpers narrow.

Acceptance Criteria

- Provider scripts import the shared helpers; behavior identical; diffs stable.

---

### PR 8 — Documentation consolidation and examples refresh

Intent/Impact

- Final sweep to align docs with the new shared surfaces and remove outdated snippets.

Detailed Design

- Update:
  - `docs/handbook/new-language-walkthrough.md` (adapter validate hook)
  - `docs/handbook/provider-sync-cookbook.md` (provider naming helpers, stamps IO)
  - `docs/handbook/macro-stamping-cookbook.md` (sanitize policy)
  - `docs/handbook/troubleshooting.md` (dev overrides shared helper)
- Ensure code snippets reference the new utilities.

Tests

- Lint docs snippets where applicable (existing doc tests) and run link checks if present.

Consequence if not implemented

- Documentation lags behind code; onboarding cost increases.

Risks

- None; doc‑only changes plus snippet refresh.

Acceptance Criteria

- Docs reflect the new shared abstractions. A new teammate can follow the updated docs to implement a small language adapter or provider sync with minimal duplication.

---

## Notes on Ordering and Blast Radius

- PRs are intentionally small and separable; merge in order to minimize conflicts.
- The only behavior‑touching changes are PR 2 (nix attr normalization/name) and PR 6 (runner helper), but both are designed to be no‑ops from an output perspective. Tests gate parity.

## Success Criteria (Program‑level)

- Exporter has no language‑bias logic outside adapters.
- Provider names for nixpkgs attrs come from a single helper.
- Planners read clearer with shared util functions.
- Dev override semantics are uniform and enforced centrally in Nix.
- Name sanitization parity across Nix ↔ Starlark is tested and documented.
- External‑runner logic is centralized in a tiny zx helper, not embedded shell.
- Provider sync scripts share IO/stamping helpers; diffs remain stable.
