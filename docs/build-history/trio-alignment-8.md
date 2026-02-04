## Trio Alignment Plan — Abstraction Tightening (CPP / Go / PNPM) — Part 8

This plan focuses on high value-per-effort cleanups that reduce drift and duplication across languages without changing behavior. The PRs are independent, low-risk, and keep outputs, invalidation, and UX identical to today.

## PR‑1: Shared sanitizer (Starlark) for names/attrs

### Description

Unify the common sanitize algorithm (replace `//` → ``, `:`→`-`, `/`→`-`, space → `-`) into a single Starlark helper so C++ and Node call the same implementation. This prevents silent drift across files.

### Scope & Changes

- Add `//build-tools/lang:sanitize.bzl` with `sanitize_name(s: string): string`.
- Update `build-tools/cpp/private/sanitize.bzl` to import and delegate to `sanitize_name`.
- Update `build-tools/node/defs.bzl` and `node/private/nix_test.bzl` to use the shared helper for importer/attr sanitization.
- Docstring references in C++/Node updated to point to `build-tools/lang/sanitize.bzl` as canonical.

### Acceptance Criteria

- No change to artifact names or output paths on representative C++ and Node targets.
- Sanitizer unit-style probes (C++’s `cpp_sanitize_probe` and a small Node probe) produce identical outputs pre/post change.

### Risks

Low; pure import redirection.

### Consequence of Not Implementing

Sanitizer logic can drift subtly between files and languages.

### Downsides for Implementing

Minor churn to imports.

### Recommendation

Implement.

## PR‑2: Centralize provider lookup key logic

### Description

Deduplicate the `//pkg:name` key computation and MODULE_PROVIDERS lookup used by Node and Go macros.

### Scope & Changes

- Add in `build-tools/lang/defs_common.bzl`:
  - `def target_key_for_current_package(name): string`
  - `def providers_for(MODULE_PROVIDERS, name): list`
- Replace custom `_providers_for` in `build-tools/go/defs.bzl` and `build-tools/node/defs.bzl` with `providers_for` from `build-tools/lang/defs_common.bzl`.

### Acceptance Criteria

- Generated deps from provider mapping remain identical (no edge changes in `cquery deps()` on representative targets).
- `third_party/providers/auto_map.bzl` usage remains unchanged.

### Risks

Low; small refactor.

### Consequence of Not Implementing

Two copies of equivalent logic can diverge.

### Downsides for Implementing

Minimal file edits.

### Recommendation

Implement.

## PR‑3: Factor Node importer patch-dir handling

### Description

Extract a tiny helper to include importer-local Node patches in `srcs`, used by both `nix_node_gen` and `nix_node_test`.

### Scope & Changes

- Add `def append_node_patches_for_importer(kwargs, importer)` to `build-tools/lang/defs_common.bzl`.
- Replace duplicated importer/patch-dir logic in:
  - `build-tools/node/defs.bzl` (`nix_node_gen`)
  - `build-tools/node/defs.bzl` (`nix_node_test`)

### Acceptance Criteria

- No changes to inputs or invalidation behavior: touching `<importer>/patches/node/*.patch` still precisely invalidates only the importer’s targets/tests.

### Risks

Low; mechanical extraction.

### Consequence of Not Implementing

Patch-dir calculation duplicated and prone to drift.

### Downsides for Implementing

Minor code motion.

### Recommendation

Implement.

## PR‑4: Remove unused Go macro helper

### Description

Drop `_nixpkg_provider_for` from `build-tools/go/defs.bzl` (provider names are sourced from generators; Go macros rely on labels + `auto_map.bzl`). This reduces confusion around multiple provider strategies.

### Scope & Changes

- Delete `_nixpkg_provider_for` from `build-tools/go/defs.bzl`.
- Confirm no call sites remain (search + build).

### Acceptance Criteria

- No build output changes for Go targets (bin/lib/test).
- CI and local builds pass with zero diffs in deps graphs.

### Risks

Low; function is unused in the current flow.

### Consequence of Not Implementing

Dead code persists; mixed signals for provider wiring.

### Downsides for Implementing

None material.

### Recommendation

Implement.

## PR‑5: DRY Nix shell fragments (Node/C++)

### Description

Consolidate the repeated shell bootstrap used by Node external tests and C++ Nix build rule (WORKSPACE_ROOT/flake root discovery, timeout selection) into a shared Starlark string helper.

### Scope & Changes

- Add `//build-tools/lang:nix_shell.bzl` with tiny constructors:
  - `def nix_bootstrap_env(): string` (WORKSPACE_ROOT, FLK_ROOT detection)
  - `def nix_timeout_wrapper_var(var_name="TIMEOUT", default_sec=600): string`
- Update:
  - `node/private/nix_test.bzl` to compose `run_cmd` via the helpers.
  - `build-tools/cpp/private/nix_build.bzl` to prepend the bootstrap portion via the helper.

### Acceptance Criteria

- Identical behavior under `buck2 test` (Node) and `buck2 build` (C++) on sample targets.
- No changes to printed diagnostics besides potential reordering of bootstrap lines.

### Risks

Low; string concatenation refactor.

### Consequence of Not Implementing

Copy/paste shell fragments can drift or be fixed inconsistently.

### Downsides for Implementing

Slight complexity in an extra `load()`.

### Recommendation

Implement.

## PR‑6: Normalization parity tests (TS ↔ Starlark)

### Description

Add a small test that asserts TS and Starlark agree on nix attribute normalization and the `pkgs.gtest → pkgs.googletest` alias.

### Scope & Changes

- Starlark probe in `build-tools/lang/defs_common.bzl`: `normalize_nix_attr_probe(name, attr)` rule that writes normalized value to an output (mirrors `cpp_sanitize_probe` style).
- zx test `build-tools/tools/tests/normalization-parity.ts`:
  - Builds the probe for a small set of inputs and reads its outputs.
  - Compares each result with TS `normalizeNixAttr()` from `build-tools/tools/lib/provider-names.ts`.

### Acceptance Criteria

- Test passes locally and in CI.
- Inputs include representative cases: `gtest`, `pkgs.gtest`, `pkgs.openssl`, `pkgs.gnome.glib`.

### Risks

Low; test-only.

### Consequence of Not Implementing

Potential future drift between TS and Starlark normalization.

### Downsides for Implementing

Adds a tiny utility probe and a test file.

### Recommendation

Implement.

## Rollout & Sequencing

1. PR‑1 (Shared sanitizer) — removes the largest drift vector first.
2. PR‑2 (Provider lookup helper) — centralize macro logic early.
3. PR‑3 (Node importer patch-dir helper) — dedupe patch handling in Node.
4. PR‑4 (Remove unused Go helper) — housekeeping once helpers are centralized.
5. PR‑5 (DRY Nix shell fragments) — unify bootstrap logic across Node/C++.
6. PR‑6 (Normalization parity tests) — lock in equivalence going forward.

## Verification & Backout Strategy

- Verification (per PR):
  - Snapshot `buck2 cquery deps(<rep targets>)` before/after; require no diffs unless noted.
  - Run representative `buck2 build //...` and `buck2 test //...`; no behavioral diffs.
  - For PR‑1/PR‑5, compare sanitizer/shell probe outputs on a fixed sample; identical.
  - For PR‑6, ensure the zx parity test passes in CI.
- Backout:
  - Each PR is isolated and can be reverted independently; no cross‑PR coupling.

## Summary of Expected Impact

- Fewer sources of drift (shared sanitizer and shell fragments).
- Thinner language macros via centralized provider and patch-dir helpers.
- Reduced dead code (Go) and stronger invariants (TS↔Starlark parity test).
