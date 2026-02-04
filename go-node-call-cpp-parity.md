## Go ↔ Node Call C++ Parity — Cleanup Plan

This document proposes a small, behavior-preserving cleanup series to tighten parity and reduce drift between the Go and Node paths for calling C/C++. Each PR is independently reversible and designed to be low-risk.

## PR‑1: Unify C++ addon build through the planner

### Description

Route Node‑API addon builds through the same Nix planner path used for C++ bins/libs, removing the direct inline `nix build` branch in the C++ builder. This centralizes build selection and keeps addon outputs discoverable alongside other C++ targets.

### Scope & Changes

- `cpp/private/nix_build.bzl`:
  - Remove the special‑case “addon” inline Nix expression; invoke the planner-selected attribute (same path as bin/lib).
  - Keep output shape stable (`lib/<sanitized>.node`).
- `flake.nix` + planner:
  - Expose addon targets in the planner outputs (e.g., `graph-generator-cppTargets`), mirroring existing bin/lib exposure.
- Tests/build scripts:
  - Ensure `build-tools/tools/dev/build-selected.ts` and existing tests work for addon labels without special handling.

### Acceptance Criteria

- `buck2 build //libs/<name>-native:napi_addon` succeeds with the planner path.
- `build-tools/tools/tests/cpp/cpp.node-addon.builds.node-artifact.test.ts` passes without modification.
- `build-tools/tools/ci/cpp-addon-smoke.ts` continues to pass across supported architectures.

### Risks

- Low. Planner exposure for addon must match expected artifact naming; otherwise zero behavior change.

### Consequence of Not Implementing

- Two code paths for C++ builds (planner vs inline expr) increase drift and maintenance burden.

### Downsides for Implementing

- Small refactor; brief churn in `cpp/private/nix_build.bzl` and planner outputs.

### Recommendation

Implement.

## PR‑2: Centralize Node toolchain/header pin for addons

### Description

Ensure the Node headers/toolchain used by the addon template are sourced from a single, shared pin to avoid version drift (e.g., consolidate around the flake/devshell Node pin).

### Scope & Changes

- `build-tools/tools/nix/templates/cpp-node-addon.nix`:
  - Replace direct references to a specific Node derivation with a single canonical reference (e.g., `pkgs.nodejs` or a shared alias).
- (Optional) Introduce/export a tiny `nodeToolchain` alias in a shared Nix module for clarity.

### Acceptance Criteria

- Addon builds succeed on macOS and Linux.
- `otool -L`/`ldd` sanity checks continue to pass in smoke test.
- No behavior change for consumers; only the derivation pin source is unified.

### Risks

- Low. Misalignment with devshell Node version would surface quickly in smoke tests.

### Consequence of Not Implementing

- Higher risk of Node version drift between devshell and template, causing subtle headers/ABI mismatches.

### Downsides for Implementing

- Minor template edits and a small shared alias.

### Recommendation

Implement.

## PR‑3: Document `addon_name` label hint and macro contract

### Description

Clarify the role of `addon_name` in `nix_cpp_node_addon` (macro label hint and output naming), tighten comments in the macro, and add a short note to the Node↔C++ design doc.

### Scope & Changes

- `cpp/defs.bzl`: brief docstring/comments for `nix_cpp_node_addon` clarifying `addon_name` usage and output path.
- `node-call-cpp.md`: add a short “Naming and load path” note referencing the macro contract and stable `native/<addon_name>.node` runtime path.

### Acceptance Criteria

- Docs render; macro comments are concise and accurate.
- No code behavior changes; lints/tests unaffected.

### Risks

- None (documentation only).

### Consequence of Not Implementing

- Minor ambiguity for maintainers extending the planner or scaffold.

### Downsides for Implementing

- None.

### Recommendation

Implement.

## PR‑4: Go Nix template micro‑refactor for patch map composition

### Description

Deduplicate patch‑map composition logic shared by `goApp` and `goLib` in `build-tools/tools/nix/templates/go.nix` using an internal helper or the shared lang helpers module. No functional changes.

### Scope & Changes

- `build-tools/tools/nix/templates/go.nix`:
  - Extract patch‑map merge into a tiny local helper (or reuse `lang-helpers.nix` where appropriate).
  - Keep override semantics and CGO handling identical.

### Acceptance Criteria

- All existing Go zx tests pass (including CGO and c-archive scenarios).
- No diffs in outputs or provider wiring for the same inputs.

### Risks

- Very low. Refactor only; semantics unchanged.

### Consequence of Not Implementing

- Duplication remains and increases the risk of future drift in patch logic.

### Downsides for Implementing

- Minimal churn in a single file.

### Recommendation

Implement.

## PR‑5: Improve C++ builder comments and error messages (addon kind)

### Description

Tighten comments and error messages to explicitly list `"addon"` as a supported `kind` and include expected artifact names in failures for faster diagnosis.

### Scope & Changes

- `cpp/private/nix_build.bzl`:
  - Update docstrings and `fail(...)` messages to include the “addon” kind and show the expected artifact path.

### Acceptance Criteria

- File loads; no linter warnings; no behavior changes.

### Risks

- None (comments/messages only).

### Consequence of Not Implementing

- Slightly slower diagnostics when failures occur.

### Downsides for Implementing

- None.

### Recommendation

Implement.

## Rollout & Sequencing

1. PR‑5 (builder comments) — zero risk, informative; land first.
2. PR‑3 (docs) — clarifies macro contract; independent.
3. PR‑2 (Node toolchain/header pin) — small change, easy validation via smoke test.
4. PR‑4 (Go template refactor) — pure refactor; validate via existing tests.
5. PR‑1 (planner unification for addon) — slightly larger change; land once earlier low-risk items are in to simplify review and validation.

All PRs are independently reversible.

## Verification & Backout Strategy

- PR‑5:
  - Verify loads/lints locally; no runtime effect. Backout: revert comment/message edits.
- PR‑3:
  - Render docs; ensure no code references break. Backout: revert doc/comment changes.
- PR‑2:
  - Run `build-tools/tools/ci/cpp-addon-smoke.ts` locally (or CI) on macOS/Linux; confirm `otool -L`/`ldd` succeed. Backout: restore prior Node pin reference.
- PR‑4:
  - Run existing zx tests: Go CGO (`go-cgo.repo-lib.build-and-run`), C→Go c-archive (`cpp.carchive.caller`). Expect no diffs. Backout: restore prior functions.
- PR‑1:
  - Ensure `buck2 build //libs/demo-native:napi_addon` uses the planner path; re-run `cpp.node-addon.builds.node-artifact` zx test and CI smoke. Backout: restore the inline addon branch in `cpp/private/nix_build.bzl` (no planner changes needed).

## Summary of Expected Impact

- Single, unified planner path for all C++ target kinds (bin/lib/addon).
- Reduced drift risk by centralizing the Node header/toolchain pin for addons.
- Clearer macro contract and naming expectations for Node addons.
- Slightly simpler Go template maintenance via deduplicated patch‑map logic.
- Faster diagnostics from improved builder messages.
