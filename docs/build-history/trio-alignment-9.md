## Trio Alignment Plan — Abstraction Tightening (CPP / Go / PNPM) — Part 9

This plan implements small, high‑value refinements to our cross‑language abstractions, focused on normalizing nixpkgs label stamping in Starlark and optionally aligning C++ provider edge visibility with Go/Node. Changes are low‑risk, keep behavior and UX the same, and reduce drift.

## PR‑1: Shared Starlark helper for nixpkgs label stamping

### Description

Introduce a single Starlark helper to stamp `nixpkg:` labels with consistent normalization (trim, lowercase, ensure `pkgs.` prefix, map `pkgs.gtest → pkgs.googletest`). This becomes the canonical way to add nixpkgs labels from any language macro.

### Scope & Changes

- Add to `lang/defs_common.bzl`:
  - `def append_nixpkg_labels(kwargs, attrs):` applies `normalize_nix_attr()` and appends `nixpkg:<normalized>` into `kwargs["labels"]`, deduping and preserving order.
- No language macro is switched yet in this PR (helper addition only).
- Docs: introduce the helper in handbook/provider-mapping notes as the canonical place where nixpkgs label normalization is defined (no behavior guidance changes).

### Acceptance Criteria

- Helper compiles and is importable from `go/defs.bzl` and `cpp/defs.bzl` without usage.
- No output or graph changes anywhere (no callers yet).
- Docs snippet added and passes lint/CI.

### Risks

Low. Pure addition; no behavior change.

### Consequence of Not Implementing

Each language continues to hand‑roll `nixpkg:` stamping; risk of drift.

### Downsides for Implementing

Small new helper and docstring.

### Recommendation

Implement.

## PR‑2: Go uses shared nixpkgs label stamping (behavior unchanged)

### Description

Switch Go macros to call the shared helper so `nixpkg:` labels are normalized at stamp time (previously raw). Behavior remains identical because downstream mapping already normalizes; this change makes the exported Buck graph more uniform.

### Scope & Changes

- In `go/defs.bzl`:
  - Replace raw `"nixpkg:%s" % a` with `append_nixpkg_labels(kwargs, nix_cgo_deps)` inside `_apply_cgo_labels` (or equivalent call site).
  - Ensure `stamp_labels` and CGO auto‑enablement remain untouched.
- Docs: clarify in handbook/provider-mapping that Go macros normalize nixpkgs labels at stamp‑time.
- Tests (zx):
  - Snapshot `third_party/providers/auto_map.bzl` remains identical after change.
  - `buck2 cquery deps(<rep go targets>)` snapshots show no provider edge diffs.

### Acceptance Criteria

- `third_party/providers/auto_map.bzl` is bit‑for‑bit identical pre/post.
- `buck2 cquery deps(<representative go targets>)` shows no provider edge diffs.
- No changes to build/test outputs.
- Docs merged; snapshot tests pass locally and in CI.

### Risks

Low. Only label normalization at stamp‑time, mapper already normalizes.

### Consequence of Not Implementing

Minor asymmetry (Go raw vs C++ normalized) persists in the exported graph.

### Downsides for Implementing

Small macro edit and imports.

### Recommendation

Implement.

## PR‑3: C++ switches to shared nixpkgs label stamping (no functional change)

### Description

Refactor `cpp/defs.bzl` to use the same helper for appending `nixpkg:` labels. This removes duplicated loops and guarantees identical normalization logic across languages.

### Scope & Changes

- In `cpp/defs.bzl`:
  - Replace local normalization loop with `append_nixpkg_labels(kwargs, nix_cxx_attrs)` for `nix_cpp_library` and `nix_cpp_binary`.
- Keep planner stubs, external Nix build, and sanitizer behavior unchanged.
- Docs: note C++ macros now use the shared nixpkgs label helper; no behavior change expected.
- Tests (zx):
  - Snapshot `third_party/providers/auto_map.bzl` remains identical.
  - `buck2 cquery deps(<rep cpp targets>)` snapshots remain identical.

### Acceptance Criteria

- No changes to C++ build outputs or test behavior.
- `buck2 cquery deps(<cpp targets>)` remains unchanged.
- Docs merged; snapshot tests pass locally and in CI.

### Risks

Low. Refactor to shared helper; outputs unaffected.

### Consequence of Not Implementing

Ongoing duplication and potential drift from Go.

### Downsides for Implementing

Minor file edits; consistent dependency on `lang/defs_common.bzl`.

### Recommendation

Implement.

## PR‑4: Optional — Uniform provider edges for C++ macros

### Description

Align C++ graph visibility with Go/Node by realizing provider edges (from `MODULE_PROVIDERS`) on `nix_cpp_library` and `nix_cpp_binary`. This is a graph‑shape improvement (diagnostics/cquery); artifacts and invalidation semantics remain unchanged.

### Scope & Changes

- In `cpp/defs.bzl`:
  - Load `//third_party/providers:auto_map.bzl` `MODULE_PROVIDERS`.
  - Merge `providers_for(MODULE_PROVIDERS, name)` into `deps` (or into `srcs` if preferred for genrule‑like parity) for `nix_cpp_library` and `nix_cpp_binary`.
- Keep planner/test wiring untouched; no change to external Nix build rule behavior.
- Docs: update handbook/provider-mapping to document expected provider edges for C++ macros when this option is enabled, and how to interpret cquery output.
- Tests (zx):
  - `buck2 cquery deps(<rep cpp targets>)` snapshot asserts the presence of provider nodes and absence of unintended edges.

### Acceptance Criteria

- C++ builds/tests remain identical; timings and outputs unchanged.
- `buck2 cquery deps(<cpp targets>)` shows added provider nodes (expected), but no target’s rule keys change unless provider files change.
- Docs merged; cquery snapshot tests pass locally and in CI.

### Risks

Low. Graph‑only edges, guarded by existing prebuild checks for glue freshness.

### Consequence of Not Implementing

Less uniform introspection; slightly more work to trace C++’s provider influences.

### Downsides for Implementing

Small, intentional cquery diffs (provider nodes appear).

### Recommendation

Implement (optional). If churn is undesirable now, defer without impacting other PRs.

## Rollout & Sequencing

1. PR‑1 (Shared nixpkgs stamping helper) — adds the primitive without behavior change.
2. PR‑2 (Go uses helper) — behavior identical; graph normalization becomes uniform.
3. PR‑3 (C++ uses helper) — removes duplication with no functional change.
4. PR‑4 (Optional C++ provider edges) — graph‑shape enhancement; can be deferred.

Each PR is small and independently reversible; land with green CI.

## Verification & Backout Strategy

- Verification (per PR):
  - PR‑1: Build language macros; no output/graph changes expected; docs updated.
  - PR‑2: `auto_map.bzl` identical; `buck2 cquery deps(...)` shows no provider edge diffs; docs updated; snapshot tests green.
  - PR‑3: `auto_map.bzl` identical; `buck2 cquery deps(...)` unchanged; docs updated; snapshot tests green.
  - PR‑4: Only expected cquery diffs (provider nodes present); builds/tests green; docs updated.
- Backout:
  - Each PR is isolated; revert individually with minimal conflicts.
  - If PR‑4 causes churn in downstream tooling, revert PR‑4 only; PR‑1–3 remain.

## Summary of Expected Impact

- Shared, canonical nixpkgs label stamping eliminates subtle cross‑language drift.
- Cleaner macros (less duplication), easier reviews, and more uniform exported graphs.
- Optional C++ provider edge realization improves diagnostics without changing builds.
