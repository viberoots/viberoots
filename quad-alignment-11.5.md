## Quad Alignment Plan — Gap Closure & Determinism Tightening (CPP / Node / lang) — Part 11.5

This installment closes the gaps discovered in the `quad-alignment-11.md` review by making the build/test flow more deterministic under `tools/bin/v`, bringing key files back under the ≤250 LOC methodology gate, and aligning plan docs with the repo’s actual scaffolding/template layout. No user-visible behavior changes are intended. Outputs should remain byte-for-byte identical for unchanged inputs.

---

## PR‑1: Stabilize C++ patching tests by eliminating temp workspace collisions

### Description

Make C++ patching session workspaces unconditionally unique to remove a plausible source of intermittent failures when `v` runs zx tests in large batches.

### Scope & Changes

- Update `tools/patch/cpp/extract.ts:ensureOriginAndWorkspace(...)` to use per-call unique directories (e.g., `mkdtemp`) instead of a seconds-resolution timestamp suffix.
- Keep all C++ patch semantics unchanged:
  - diff generation still uses `git diff --no-index` with `core.filemode=false`
  - patch format and naming remain identical
  - session bookkeeping remains unchanged
- Add a focused zx test that asserts uniqueness:
  - two rapid `ensureOriginAndWorkspace("pkgs.zlib", ...)` calls yield distinct `originPath` and `workspacePath`

### Tests (in this PR)

- New unit-style test under `tools/tests/patching/**` asserting unique origin/workspace paths.
- Re-run the existing patching suite:
  - `//:patching_patch_cpp_apply_noop`
  - the existing C++ patch extract/diff tests
- Full suite validation via `tools/bin/v` (see Verification section).

### Docs (in this PR)

- None (behavior-neutral internal change).

### Acceptance Criteria

- `tools/bin/v` passes twice back-to-back on the same machine (no test flake).
- New uniqueness test passes and would fail if workspaces were reused/collided.

### Risks

- Low. Workspace naming changes are internal and should not affect patch contents.

### Consequence of Not Implementing

- Intermittent “fails in batch, passes alone” behavior may persist, blocking “fully tested” claims.

### Downsides for Implementing

- Small churn in internal workspace naming, with no external effect.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Changes are confined to patch tooling under `tools/patch/**` and `tools/tests/**`.

---

## PR‑2: Split `//lang:defs_common.bzl` to satisfy the ≤250 LOC methodology gate

### Description

Bring `lang/defs_common.bzl` (currently >250 lines) into compliance by splitting it into small, single-purpose `.bzl` modules while preserving the existing public surface for call sites.

### Scope & Changes

- Introduce small focused modules under `lang/` (exact filenames can be tuned to current conventions), for example:
  - `lang/lockfile_labels.bzl` (lockfile label validation + importer extraction)
  - `lang/patch_inputs.bzl` (patch src inclusion helpers)
  - `lang/label_stamping.bzl` (`dedupe_preserve`, `stamp_labels`, wasm stamping, global nix input stamping)
  - `lang/nixpkg_labels.bzl` (nixpkgs attr normalization + nixpkg label emission)
  - `lang/provider_edges.bzl` (provider lookup + realize edges)
- Convert `lang/defs_common.bzl` into a thin compatibility wrapper:
  - keeps the original `load("//lang:defs_common.bzl", ...)` call sites stable
  - re-exports the same function names
- Ensure each new file is ≤250 lines.

### Tests (in this PR)

- Existing zx tests that rely on `//lang:defs_common.bzl` behavior (no changes expected).
- Add a small “file size guard” zx test (or extend the existing `tools/dev/file-size-lint.ts` usage) to ensure new split files do not regress above 250 LOC.
- Full suite validation via `tools/bin/v`.

### Docs (in this PR)

- None required (mechanical refactor), unless we need a short “where to find helpers now” note in an internal handbook file.

### Acceptance Criteria

- `lang/defs_common.bzl` ≤250 lines.
- No semantic diffs in macro behavior:
  - label stamping, nixpkg normalization, patch src inclusion, and provider edge realization remain identical.
- `tools/bin/v` passes.

### Risks

- Moderate. This is a high-fanout file and accidental symbol export/import mistakes can break macros.

### Consequence of Not Implementing

- The repo remains out of compliance with the methodology’s file-size constraint.

### Downsides for Implementing

- Mechanical code motion; temporary review noise.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Only Starlark helper files under `//lang` change; no new external dependencies.

---

## PR‑3: Split `//node:defs.bzl` to satisfy the ≤250 LOC methodology gate

### Description

Bring `node/defs.bzl` (currently >250 lines) into compliance by splitting into a small set of modules while keeping `//node:defs.bzl` as the stable public entry point.

### Scope & Changes

- Split `node/defs.bzl` into:
  - one module for generic gen/test wrappers (`nix_node_gen`, `nix_node_test`, `nix_node_lib`, `nix_node_bin`)
  - one module for Nix-invoking macros (`node_webapp`, bundled `nix_node_cli_bin`)
- Keep `node/defs.bzl` as a thin re-export wrapper so existing `load("//node:defs.bzl", ...)` call sites remain unchanged.
- Ensure each new file is ≤250 lines.

### Tests (in this PR)

- Existing node macro zx tests, including:
  - global nix input stamping for `node_webapp` and bundled `nix_node_cli_bin`
  - negative coverage for non-bundled CLI not stamping global inputs
- Full suite validation via `tools/bin/v`.

### Docs (in this PR)

- None required (mechanical refactor), unless we need a short note in a handbook file for future contributors.

### Acceptance Criteria

- `node/defs.bzl` ≤250 lines.
- No diffs in macro output attributes (labels, srcs/deps realization, command assembly) beyond formatting/stable ordering.
- `tools/bin/v` passes.

### Risks

- Moderate. Node macros are sensitive to imports and helper availability.

### Consequence of Not Implementing

- The repo remains out of compliance with the methodology’s file-size constraint.

### Downsides for Implementing

- Mechanical code motion; temporary review noise.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Only the Node macro files change; downstream targets remain unaffected.

---

## PR‑4: Documentation and design drift cleanup (templates path + PR‑1 wording + script-policy clarification)

### Description

Align plan documentation with the repo’s current reality and clarify the one remaining design-policy mismatch we observed (small bash shims in `tools/bin/*`).

### Scope & Changes

- Update `quad-alignment-11.md`:
  - Replace references to the old templates path with `tools/scaffolding/templates/**`.
  - Adjust PR‑1 wording to match implementation: legacy kwargs fail fast with actionable errors (rather than an “alias merge helper”).
- Update `build-system-design.md` (Option A):
  - Clarify that small wrappers in `tools/bin/*` may exist as thin shims, but substantive automation remains in TypeScript zx scripts.
  - Keep the policy that new substantive scripts are TypeScript zx scripts using the repo’s wrapper.
- Optionally update `getting-started-on-a-pr.md` to reference the clarified policy (no behavioral change).

### Tests (in this PR)

- Docs-only; still run `tools/bin/v` before landing to preserve the “full suite green” gate.

### Docs (in this PR)

- The changes above are the core of this PR.

### Acceptance Criteria

- The documentation no longer references non-existent template paths.
- The PR‑1 description matches actual behavior in macros/tests.
- Script policy is unambiguous and consistent with the repo’s actual `tools/bin/*` usage.
- `tools/bin/v` passes.

### Risks

- Very low.

### Consequence of Not Implementing

- New contributors will follow the old templates path and get stuck.
- Reviewers will continue to trip on “policy says no bash, repo has shims” ambiguity.

### Downsides for Implementing

- None.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Docs-only changes.

---

## Rollout & Sequencing

1. PR‑1 (C++ patch workspace uniqueness) — removes the most likely batch-test flake vector.
2. PR‑2 (`lang/defs_common.bzl` split) — restores methodology compliance for shared Starlark helpers.
3. PR‑3 (`node/defs.bzl` split) — restores methodology compliance for Node macros.
4. PR‑4 (Docs & policy clarification) — aligns the plan with repo reality and resolves the remaining policy ambiguity (Option A).

---

## Verification & Backout Strategy

### Verification (each PR)

- Each PR runs `tools/bin/v` once before landing.
- PR‑1 additionally runs `//:patching_patch_cpp_apply_noop` and related patching tests in isolation.
- PR‑2 and PR‑3 additionally verify file-size compliance (≤250 LOC) for touched `.bzl` files.

### Verification (end of series)

- Run `tools/bin/v` **twice back-to-back** on the same machine to validate determinism.

### Backout

- Each PR is self-contained and can be reverted independently:
  - PR‑1 revert returns to timestamp-based temp paths.
  - PR‑2/3 revert returns to monolithic `.bzl` files.
  - PR‑4 revert returns documentation to its prior state.
