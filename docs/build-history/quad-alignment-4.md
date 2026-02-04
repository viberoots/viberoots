## Quad Alignment Plan — Cross-Language Parity Tightening (CPP / Go / PNPM / Python) — Part 4

This part focuses on eliminating small duplication, tightening parity across glue and lint flows, and adding light guardrails that prevent cross-language drift. Each PR ships tests and minimal documentation updates within the same change. No behavior changes to artifacts, providers, or labels are intended for unchanged inputs.

---

## PR‑1: Unified glue orchestration (single pipeline, reused by CLI and CI)

### Description

Centralize glue execution (ensureGraph → sync‑providers → gen‑provider‑index → gen‑auto‑map) into a small helper used by both patch flows and CI/install flows. This removes drift between `build-tools/tools/patch/glue.ts` and `build-tools/tools/dev/install/glue.ts` while keeping byte‑stable outputs and the same invocation order/flags.

### Scope & Changes

- build-tools/tools/buck/glue‑pipeline.ts (new):
  - Expose `runGluePipeline({ graphPath, outAutoMap, zxInit, verbose? })` that performs the three steps deterministically in the current repo root.
  - Accept optional verbose/noop toggles but default to the existing behavior.
- build-tools/tools/patch/glue.ts:
  - Replace inline steps with a call to `runGluePipeline(...)` (preserve defaults and output paths).
- build-tools/tools/dev/install/glue.ts:
  - Replace inline steps with `runGluePipeline(...)`; keep capability/enablement gating at the caller level.
- build-tools/tools/ci/run-stage.ts:
  - Continue importing `ensureGraph`/`runGlue` via the existing façade; ensure both routes hit the shared pipeline.
- Tests (in this PR):
  - zx snapshot tests compare byte‑for‑byte equality of `third_party/providers/TARGETS*.auto`, `third_party/providers/provider_index.bzl`, and `auto_map.bzl` before/after refactor on representative Node/Python repos (no lockfiles present and with lockfiles present).
  - Negative path: missing graph forces export first, as today.
- Docs (in this PR):
  - Short note in build‑system‑design to state “glue pipeline is shared”; no change to developer commands.

### Acceptance Criteria

- Patch flows (Node/Python) and CI/install flows produce identical outputs pre‑ vs post‑refactor (byte‑for‑byte).
- Order of steps and stderr/stdout surface area remains unchanged except for the centralized helper callsite.

### Risks

- Low: any flag/order drift could change output bytes. Mitigated by snapshot tests and strict ordering in the helper.

### Consequence of Not Implementing

- Ongoing drift risk and duplicated step sequencing across two places.

### Downsides for Implementing

- Slightly tighter coupling on one shared helper (still a tiny surface, easy to revert).

### Recommendation

Implement.

---

## PR‑2: Python patches lint (importer‑local) parity

### Description

Extend `build-tools/tools/dev/patches-lint.ts` to lint importer‑local Python patches located under `<importer>/patches/python/*.patch`. Enforce filename shape and duplicate detection with the same rules used for Go/Node, and reuse importer utilities to avoid repo‑wide scans.

### Scope & Changes

- build-tools/tools/dev/patches-lint.ts:
  - Add Python mode: discover importers via `findImporterLockfiles(["uv.lock"])`, list patches with `listImporterPatches(importer, "python")`, and validate each filename with shared `decodeNameVersionFromPatch` and duplicate checks.
  - Strict mode behavior matches existing languages: warns locally, fails in CI/`--strict`.
- Tests (in this PR):
  - zx tests create minimal fixtures with importer directories and python patches; verify warnings vs errors across strict modes and duplicate conditions.
- Docs (in this PR):
  - Patching handbook: add a line that Python importer‑local patches are covered by the same lint and how to scope to a language.

### Acceptance Criteria

- Running the lint on a repo with importer‑local Python patches surfaces shape/duplicate issues like Go/Node; CI enforces strict mode failure on violations.

### Risks

- Low: performance impact is bounded by importer discovery; implementation uses targeted scans rather than global globs.

### Consequence of Not Implementing

- Python patching remains the only language without lint parity; silent drift risks in patch shapes.

### Downsides for Implementing

- Slight additional lint runtime when Python importers exist (negligible against CI wall time).

### Recommendation

Implement.

---

## PR‑3: C++ workspace post‑extraction copy/permissions unification

### Description

After extracting nixpkgs sources for C++, unify the “make workspace writable” and fallback copy semantics with the shared cross‑platform helper. Keep specialized archive extraction logic intact; only post‑extraction copy/permissions converge to the same routines used by Go/Python.

### Scope & Changes

- build-tools/tools/patch/cpp/extract.ts:
  - Reuse `chmodRecursive` from `build-tools/tools/patch/cross-platform.ts` to ensure workspaces are writable after rsync/extract.
  - Optional: where appropriate (non‑archive path copies), prefer the same `fsp.cp` fallback path to eliminate duplicated copy code; keep rsync for archive extraction outputs to preserve today’s behavior.
- build-tools/tools/patch/cross-platform.ts:
  - Export `chmodRecursive` for reuse (no behavior change).
- Tests (in this PR):
  - zx tests assert that post‑extraction workspaces are writable and diffs generated by `patch -p1 --dry-run` are unaffected; verify paths and permissions on darwin/linux.
- Docs (in this PR):
  - Brief note in patching handbook that C++ post‑extraction now uses the common permission normalizer; no flow changes.

### Acceptance Criteria

- No change in generated diffs or patch verification results for C++.
- Workspaces are guaranteed writable via the shared code path.

### Risks

- Very low: permission normalization could theoretically expose timestamp/mtime differences if improperly sequenced; guarded by tests and keeping rsync for extraction output.

### Consequence of Not Implementing

- Minor duplication persists and C++ remains subtly divergent on the writable‑workspace step.

### Downsides for Implementing

- Small refactor; ensure ordering doesn’t affect later steps (verified by tests).

### Recommendation

Implement.

---

## PR‑4: Provider discovery consistency and label/provider mapping guard tests

### Description

Unify Node provider lockfile discovery with the shared importer utilities and add small guard tests for label→provider mapping plus TS↔Nix patch key parity to prevent future drift.

### Scope & Changes

- build-tools/tools/buck/providers/node.ts:
  - Replace dedicated PNPM lockfile discovery with `findImporterLockfiles(["pnpm-lock.yaml"])` for symmetry with Python’s uv path (no behavior change intended).
- build-tools/tools/tests (new/extended):
  - providers‑for‑labels: assert `providersForLabels([... "lockfile:<p>#<i>", "nixpkg:pkgs.zlib"])` yields the expected fully‑qualified provider labels.
  - ts_nix_patch_key_parity: for a small local patches dir, assert that TS `decodeNameVersionFromPatch` keys match the Nix evaluation of `patchesMapFromDir(./<dir>)` (via `nix eval` on the helper). This is a fast, hermetic mapping check.
- Docs (in this PR):
  - Adding‑language guide: emphasize reusing `build-tools/tools/lib/importers.ts` for importer discovery and labeling.

### Acceptance Criteria

- Node provider generator behavior is unchanged (verified by snapshotting provider files before/after).
- Label→provider mapping tests pass for importer‑scoped lockfile and nixpkg labels.
- TS↔Nix parity test passes for example patches.

### Risks

- Low: test harness must call `nix eval` consistently; guarded by existing CI environment/setup.

### Consequence of Not Implementing

- Small duplication in discovery remains; potential untested drift between TS and Nix patch key building.

### Downsides for Implementing

- Slight increase in test surface (fast; no external network).

### Recommendation

Implement.

---

## Rollout & Sequencing

1. PR‑1 (Unified glue orchestration): safest foundation; reduces duplication with byte‑stable outputs.
2. PR‑2 (Python patches lint): independent, quick win that raises consistency to Go/Node.
3. PR‑3 (C++ workspace post‑extraction unification): small refactor; easier once glue/linters are steady.
4. PR‑4 (Provider discovery + guard tests): finalize parity and add drift‑proof checks.

---

## Verification & Backout Strategy

- PR‑1
  - Verification: snapshot provider/auto_map outputs before/after on repos with and without Node/Python importers; ensure byte identity. Exercise missing‑graph path to confirm export still runs.
  - Backout: revert `glue-pipeline.ts` imports and restore previous inline orchestration in both callsites.

- PR‑2
  - Verification: run `build-tools/tools/dev/patches-lint.ts --lang python` locally (warn) and with `--strict` (error) against fixtures; confirm duplicates and shape errors surface as expected.
  - Backout: guard Python path behind a flag or revert Python branch in `patches-lint.ts`.

- PR‑3
  - Verification: run C++ patch start/apply on a representative nixpkgs attr across macOS/Linux; confirm dry‑run patch verification succeeds and workspaces remain writable; compare diffs pre/post.
  - Backout: keep `chmodRecursive` export and restore original rsync+chmod sequence.

- PR‑4
  - Verification: providers snapshot unaffected; label→provider tests pass; TS↔Nix parity test green.
  - Backout: revert Node provider’s discovery change; keep tests (harmless) or mark parity test as skipped.

---

## Summary of Expected Impact

- Removes duplication in glue orchestration; reduces drift risk across entrypoints.
- Adds Python importer‑local patch linting with the same strictness semantics as Go/Node.
- Aligns C++ writable‑workspace handling with shared cross‑platform logic.
- Ensures consistent importer discovery and adds guard tests for label mapping and TS↔Nix patch key parity.
- No intended behavior or artifact changes for unchanged inputs; all changes are behavior‑preserving refactors and guardrails.
