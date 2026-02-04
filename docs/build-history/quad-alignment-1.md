## Quad Alignment Plan — Cross-Language Parity Tightening (CPP / Go / PNPM / Python) — Part 1

This plan captures small, behavior-preserving refactors to reduce duplication, improve cross-language parity (now including Python), and clarify intent. Each PR is independently reversible and aims for zero diffs in build artifacts, provider mappings, and labels for unchanged inputs.

## PR‑1: Shared Nix patch‑map helper with optional store materialization

### Description

Unify patch filename scanning and key generation across languages by introducing a shared helper in Nix that supports two modes:

- pass-through file paths (current Go/C++ approach), and
- store-materialized content paths (current Python approach).

### Scope & Changes

- build-tools/tools/nix/lib/lang-helpers.nix:
  - Add a generic `patchesMapFromDirToStore` (and `patchesMapFromImporterDirToStore`) that:
    - scans flat `*.patch` directories,
    - decodes canonical keys (case-insensitive, `__` → `/`, `<name>@<version>`),
    - materializes content into the store (`writeText`) for stable inputs where needed.
  - Keep existing `patchesMapFromDir` and `patchesMapFromDirs` for pass-through behavior.
- build-tools/tools/nix/templates/python.nix:
  - Replace inline scan/materialization logic with the new helper (no behavior change).
- No change to Go/C++ templates’ behavior; optionally wire them through the common helper to remove local duplication without altering outputs.

### Acceptance Criteria

- No diffs in Python builds for identical inputs (patches, lockfiles, code).
- Existing Go/C++ outputs unchanged.
- Keys normalized identically to today’s logic (case-insensitive, path decoding).

### Risks

Low. A pure refactor consolidating already-implemented patterns.

### Consequence of Not Implementing

Continued drift risk and duplicated scan logic in language templates.

### Downsides for Implementing

Small migration in Python template; trivial imports for Go/C++ if opted in.

### Recommendation

Implement.

## PR‑2: Planner-level dev‑override diagnostics parity (add Python)

### Description

Make dev‑override detection/logging uniform across Go, C++, and Python in the planner and developer utilities. Preserve CI enforcement within language templates.

### Scope & Changes

- build-tools/tools/nix/graph-generator.nix:
  - Detect `NIX_PY_DEV_OVERRIDE_JSON` alongside existing Go/CPP envs.
  - When `CI!=true`, emit the same neutral one‑liner notice used for other languages (honor `PLANNER_NO_DEV_OVERRIDE_LOG=1`).
- build-tools/tools/dev/clear-overrides.ts:
  - Add Python override clearing (keep behavior identical for Go/CPP).
- build-tools/tools/buck/prebuild/\* (notice path):
  - Extend any local “friendly notices” to include Python for completeness (no CI change).

### Acceptance Criteria

- Local runs show a single-line notice when any of GO/CPP/PY overrides are set.
- CI remains strict via existing template guards; planner notices suppressed or cause failure as today, depending on environment and template logic.

### Risks

Very low. Logging parity only.

### Consequence of Not Implementing

Inconsistent override diagnostics; easier to miss Python overrides.

### Downsides for Implementing

None.

### Recommendation

Implement.

## PR‑3: Consolidate importer‑provider sync utilities (Node + Python)

### Description

Factor shared importer logic out of Node and Python provider generators into a small library. Keep ecosystem-specific lock parsing in their respective modules.

### Scope & Changes

- build-tools/tools/lib/importers.ts (new):
  - `findImporterLockfiles(globs: string[]): Promise<string[]>`
  - `computeImporterLabel(lockfilePath: string): string` (POSIX relative from repo root)
  - `defaultImporterPatchDir(importer: string, lang: "node"|"python"): string`
  - `listImporterPatches(importer: string, lang: "node"|"python"): Promise<string[]>`
  - Stable sorting and path normalization helpers reused by generators.
- build-tools/tools/buck/providers/node.ts and build-tools/tools/buck/providers/python.ts:
  - Replace bespoke importer/patch listing with shared helpers.
  - Keep lockfile parsing specific to each ecosystem (PNPM vs uv2nix).

### Acceptance Criteria

- No diffs in generated `TARGETS.*.auto` and provider stamps for identical inputs.
- Existing zx tests covering Node/Python providers remain green.

### Risks

Low. Shared scaffolding only; parsers remain language-specific.

### Consequence of Not Implementing

Importer logic drift and subtle path inconsistencies.

### Downsides for Implementing

Small refactor across two generators.

### Recommendation

Implement.

## PR‑4: Unify patch filename parsing usage across TS tools

### Description

Ensure all patch-consuming scripts (Node/Python providers, patch CLIs) use the shared patch filename decoder(s) for canonical keys to eliminate ad‑hoc parsing.

### Scope & Changes

- Audit TS call sites and replace local parsing with shared utilities:
  - Prefer `decodeNameVersionFromPatch` in a central module.
  - Confirm case-insensitive and `__` ↔ `/` behavior matches Nix helpers.
- No change in outputs; just replace parsing implementations.

### Acceptance Criteria

- No diffs in provider outputs, auto_map, or lints for identical inputs.
- Existing zx tests remain green.

### Risks

Low. Straightforward adoption.

### Consequence of Not Implementing

Parsing drift across tools; harder to debug edge cases.

### Downsides for Implementing

Small edits.

### Recommendation

Implement.

## PR‑5: Macro helper consolidation for importer‑local patches

### Description

Reduce duplication in Starlark helpers by introducing a single importer‑patch helper with a `lang` parameter, replacing near-identical Node/Python variants.

### Scope & Changes

- lang/defs_common.bzl:
  - Add `append_importer_patches(kwargs, importer, lang)` which routes to the correct `<importer>/patches/<lang>` directory and appends `*.patch` to `srcs` deterministically.
  - Deprecate `append_node_patches_for_importer` and `append_python_patches_for_importer` (keep temporary shims calling the unified helper).
- node/defs.bzl and python/defs.bzl:
  - Switch to the unified helper.

### Acceptance Criteria

- No diffs in target `srcs` lists or invalidation behavior.
- Macros continue to enforce importer-scoped lockfile labels consistently.

### Risks

Low. Helper factoring; behavior preserved.

### Consequence of Not Implementing

Ongoing duplication and minor maintenance overhead.

### Downsides for Implementing

Small edit footprint across two macro files.

### Recommendation

Implement.

## PR‑6: Documentation updates for unified helpers and parity

### Description

Clarify the unified patch-map usage, importer utilities, and override diagnostics parity in developer docs.

### Scope & Changes

- build-tools/docs/build-system-design.md:
  - Reference the shared Nix helper(s) and the two modes (path vs store).
  - Note planner-level override notices now include Python.
- docs/handbook/adding-language.md:
  - Document importer-local patch conventions and the shared importer utilities.
- (Optional) add short header comments to templates clarifying roles where confusion is likely.

### Acceptance Criteria

- Docs accurately reflect the refactors and are discoverable from existing sections.
- No code or output changes required to validate.

### Risks

None.

### Consequence of Not Implementing

Higher onboarding friction and potential misinterpretation of patterns.

### Downsides for Implementing

None.

### Recommendation

Implement.

## PR‑7: Python WASM template consistency — use shared store‑materialized patch map

### Description

Align the Python WASM template with the standard Python template by using the shared `patchesMapFromDirToStore`/`patchesMapFromImporterDirToStore` helper from `build-tools/tools/nix/lib/lang-helpers.nix`. This replaces the local `toStoreMap` transformation inside `build-tools/tools/nix/templates/python/wasm.nix`, ensuring one canonical implementation for scanning, key normalization, and store materialization.

### Scope & Changes

- build-tools/tools/nix/templates/python/wasm.nix:
  - Replace the manual `toStoreMap (H.patchesMapFromDir ...)` mapping with:
    - `H.patchesMapFromImporterDirToStore { srcRoot; subdir; lang = "python"; normalizeVersion = (v: lib.head (lib.splitString "-" v)); namePrefix = "py-patch"; }`
    - or, equivalently, `H.patchesMapFromDirToStore { dir = patchDirAbs; normalizeVersion = (v: lib.head (lib.splitString "-" v)); namePrefix = "py-patch"; }`
  - Remove the local `toStoreMap` helper in this file.
  - Preserve existing dev‑override and WASM build logic unmodified.

### Acceptance Criteria

- No diffs in Python WASM build outputs for identical inputs (patches, lockfiles, code).
- Deterministic patch application order and key normalization match the main Python template.
- Existing Python WASM tests (Pyodide/WASI) remain green without changes.

### Risks

Very low. This is a consistency refactor; behavior and inputs are unchanged. Store file naming remains stable via `namePrefix = "py-patch"` and canonical keying.

### Consequence of Not Implementing

Minor divergence persists in how patches are materialized for Python WASM vs. standard Python, increasing maintenance surface.

### Downsides for Implementing

None material. Small, localized edit.

### Recommendation

Implement.

## Rollout & Sequencing

1. PR‑1 (Shared Nix patch‑map helper) — lowest risk, unblocks others.
2. PR‑4 (Patch filename parsing unification) — simple adoption across TS.
3. PR‑2 (Planner/dev override parity incl. Python) — logging-only alignment.
4. PR‑3 (Importer-provider utilities) — refactor Node/Python providers.
5. PR‑5 (Macro helper consolidation) — small Starlark cleanup.
6. PR‑6 (Docs) — final pass after code is merged.
7. PR‑7 (Python WASM template consistency) — small refactor, no behavior change.

All PRs are independently reversible.

## Verification & Backout Strategy

- PR‑1:
  - Re-run representative Python builds; expect no diffs. If diffs appear, compare key decoding and store-materialization order; backout by restoring prior inline logic.
- PR‑2:
  - Local planner run prints notices for all three envs; CI behavior unchanged. Backout by removing new env handling.
- PR‑3:
  - Re-run Node/Python provider sync; confirm `TARGETS.*.auto` identical. Backout by restoring pre-refactor code paths per language.
- PR‑4:
  - Re-run providers and patch CLIs; expect identical outputs and zx tests green. Backout specific call site adoptions.
- PR‑5:
  - Build/sample targets; confirm identical `srcs` and invalidation behavior. Backout by re-exposing per-language helpers.
- PR‑6:
  - Docs build/render; no code impact. Backout by reverting doc sections.
- PR‑7:
  - Build Python WASM (Pyodide/WASI) samples before/after; expect no diffs in outputs. If differences appear, restore the local mapping or adjust `namePrefix`/normalization to match prior store naming while retaining the shared helper.

## Summary of Expected Impact

- Reduced duplication in Nix and TS glue; fewer bespoke parsers and scanners.
- Parity in dev-override diagnostics across Go/CPP/Python; clearer local signals.
- Shared importer utilities decrease drift between Node/Python providers.
- No functional changes to build artifacts or mappings; safer maintenance long-term.
- Python WASM template matches standard Python template for patch map handling; lower drift risk.
