# Quad Alignment Plan — Cross-Language Seam Tightening (CPP / Go / PNPM / Python) — Part 35

This installment follows Part 34. Part 34 targets the largest remaining macro-authoring risk:

- Shared Starlark wiring helpers are correct, but they are mutation-heavy, and that mutation leaks into call sites.
- Part 34 proposes functional (non-mutating) wiring helpers and migrates Go, Python, Node, and C++ to them.

In Part 35 I focus on the remaining gaps that still require too much cross-language context during debugging and tooling authoring, even after the functional helper migrations:

- Importer-scoped lockfile discovery has duplicated “walk upwards” logic in TypeScript, which is a drift surface across exporter, provider sync, and diagnostics.
- Nix patch map scanning duplicates the same patch filename decoding logic in multiple helpers, which is a drift surface across “path patch maps” and “store-materialized patch maps”.
- “What invalidates what?” is mostly correct but still easy to misunderstand when looking only at providers. The system needs a single, queryable report for invalidation sources per target, backed by tests.
- Enforcement coverage exists, but there are still bypass paths where new macros or tooling can re-introduce ad-hoc parsing/wiring (especially for Nix-calling macros and importer-scoped shapes).

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Unify TypeScript nearest-lockfile discovery (pnpm-lock.yaml and uv.lock) and migrate callers

### Description

Today, TypeScript contains multiple “walk upwards to repo root” helpers for importer-scoped ecosystems. They are intentionally shared between exporter and provider tooling, but they still exist as separate functions (one for PNPM, one for uv) and are easy to copy-paste into new tooling.

This PR introduces one generic nearest-lockfile walker, refactors the existing helpers to delegate to it, and migrates all call sites that do nearest-lockfile discovery to use the shared helper surface.

### Scope & Changes

- Introduce a shared helper in `build-tools/tools/lib/importers.ts` (final naming up to implementation details):
  - `findNearestLockfileForPackage({ pkgDir, lockfileBasename }) -> Promise<string | null>`
  - Requirements:
    - input and output remain repo-relative POSIX paths
    - behavior remains unchanged for repo-root lockfiles (returns `pnpm-lock.yaml` or `uv.lock`)
    - retains the “inside repo” guard (no traversal outside repo root)
- Refactor existing helpers to delegate to the generic walker:
  - `findNearestPnpmLockForPackage(...)`
  - `findNearestUvLockForPackage(...)`
- Migrate exporter and provider tooling call sites to depend on the shared helper surface only.
- Cleanup and consistent conventions across TS call sites:
  - ensure lockfile paths are normalized once (strip repeated leading `./` and use POSIX paths consistently)
  - remove ad-hoc “dirname” computations in call sites when `computeImporterLabel(...)` is the intended contract

Non-goals in this PR:

- No change to the lockfile label format (`lockfile:<path>#<importer>`).
- No change to supported importer roots (`.`, `apps/*`, `libs/*`).
- No change to provider sync output formats.

### Tests (in this PR)

- Add a focused unit test for the generic nearest-lockfile walker that covers:
  - repo root lockfile resolution
  - nested package resolution (walk upwards to the closest lockfile)
  - “inside repo” boundary behavior
- Keep existing exporter/provider tests passing unchanged, updating only imports/call sites.

### Docs (in this PR)

- Update `abstractions.md` to point TS tooling authors at the single nearest-lockfile helper and to call out the policy: do not hand-roll upward directory walks in new tooling.
- Update relevant handbook pages under `docs/handbook/` that describe importer-scoped labeling to reference the canonical helper location.

### Acceptance Criteria

- All nearest-lockfile discovery in TS tooling is driven through `build-tools/tools/lib/importers.ts` shared helpers.
- Behavior remains stable, validated by tests and unchanged downstream outputs.

### Risks

Low. This is a refactor with targeted tests. The main risk is changing path normalization behavior in a subtle way.

### Consequence of Not Implementing

Nearest-lockfile behavior remains a drift surface. New tools will likely re-introduce copy-paste walkers that disagree on edge cases.

### Downsides for Implementing

Minor churn across TypeScript call sites.

### Recommendation

Implement.

---

## PR‑2: Remove Nix patch filename decode duplication in `build-tools/tools/nix/lib/lang-helpers.nix` and lock it with parity tests

### Description

Patch filename decoding is a cross-language contract. Nix currently decodes patch filenames in multiple helpers (for example “path patch maps” vs “store-materialized patch maps”), and the decoding logic is duplicated.

This PR factors patch filename decoding into a single internal helper in `build-tools/tools/nix/lib/lang-helpers.nix` and uses it from all patch map builders. It also adds parity tests to ensure the decoding contract cannot drift across Nix and TypeScript tooling.

### Scope & Changes

- In `build-tools/tools/nix/lib/lang-helpers.nix`:
  - Introduce a shared decode helper (final naming up to implementation details), for example:
    - `decodePatchFilename(name) -> { key, importPath, version } | null`
  - Refactor:
    - `patchesMapFromDir`
    - `patchesMapFromDirToStore`
    - `patchesMapFromImporterDirToStore`
      to use the shared decode helper, so the contract stays centralized.
- Ensure sorting and stable ordering behavior remains unchanged:
  - deterministic key normalization (lowercasing importPath and version segments)
  - per-key patch list order remains stable and deterministic
- Cleanup and consistent conventions (Nix):
  - keep “normalize version” policies explicit at call sites (Python version normalization remains a caller-provided function)
  - avoid repeating “splitString @” decode patterns in multiple scopes

Non-goals in this PR:

- No change to patch naming conventions.
- No change to patch selection policy (Node global patches remain effective-set-only; Python importer-local remains effective-set-only).

### Tests (in this PR)

- Add a focused parity test that:
  - provides a small fixture set of patch filenames
  - validates that TS decoding (used by provider tooling) and Nix decoding (used by planner templates) produce the same normalized keys
- Keep existing provider golden tests unchanged.

### Docs (in this PR)

- Update `abstractions.md`:
  - call out patch filename decoding as a shared contract
  - point to the single canonical decoding logic on the Nix side and TS side
- Update `build-tools/docs/build-system-design.md` where it references patch maps, to point at `abstractions.md` for the canonical contract definition.

### Acceptance Criteria

- Nix patch decoding logic has a single implementation that all patch-map builders use.
- Parity tests fail if Nix decoding drifts from TS decoding.

### Risks

Low to moderate. A subtle behavior change in normalization could change which patches apply. Tests must lock down key normalization and ordering.

### Consequence of Not Implementing

Decoding drift remains possible as new patch-map helpers are added for new languages or new patch models.

### Downsides for Implementing

Some refactor churn in Nix helper code and one new parity test surface.

### Recommendation

Implement.

---

## PR‑3: Add a single “invalidation sources” report for targets and wire it into prebuild diagnostics

### Description

Today, invalidation behavior is correct but still easy to misinterpret:

- importer-scoped providers contain `patch_paths`, but importer-local patch invalidation is actually driven by macro-attached action inputs
- package-local patch invalidation is driven by patch files in `srcs`
- Nix-calling macros must carry global Nix inputs as real action inputs

Part 33 added patch model metadata to the provider index and prebuild guard emits one-liners, but we still lack a single, queryable report that answers “what invalidates this target?” using the same vocabulary across languages.

This PR introduces a deterministic report generator that:

- reads the exported graph and `auto_map`
- classifies each target by patch scope and provider model
- produces a stable output that can be used during debugging and CI diagnostics

### Scope & Changes

- Add a new tool under `build-tools/tools/buck/` (final naming up to implementation details), for example:
  - `build-tools/tools/buck/invalidation-report.ts`
- Report responsibilities:
  - for each non-provider target:
    - report `patch_scope` (`package-local` vs `importer-local`)
    - report whether importer-local patch inputs are expected to be present as action inputs (and which attribute shape is expected, when determinable)
    - report whether global Nix inputs are expected as real action inputs (for Nix-calling macro shapes)
    - report realized provider edges (from `MODULE_PROVIDERS`) as a debugging aid, not as the source of truth for invalidation
  - output format:
    - deterministic line-oriented text (easy to diff) plus optional JSON mode for tooling
- Wire report generation into existing prebuild diagnostics:
  - when prebuild guard detects missing or stale glue, print where to look (report file path) and how to regenerate
  - keep default output minimal; verbose mode can print the top-N entries relevant to the failure
- Cleanup and consistent conventions across TS diagnostics:
  - use the existing contract registries (`build-tools/tools/lib/lang-contracts.ts`) as the source of patch model classification
  - avoid re-deriving importer support rules in the report generator (delegate to `build-tools/tools/lib/importers.ts`)

Non-goals in this PR:

- No change to build behavior.
- No change to provider sync or auto_map generation.
- No attempt to infer rule-shape-specific action attribute names beyond what is already encoded by macro conventions and contract data.

### Tests (in this PR)

- Add a focused test that runs the report generator against a small fixture graph and asserts:
  - stable ordering
  - presence of patch scope classification for representative Go/C++/Node/Python targets
  - presence of “global nix inputs expected” for at least one Nix-calling Node macro shape
- Ensure existing diagnostic tests remain stable, updating only expected output paths/messages when necessary.

### Docs (in this PR)

- Update `docs/handbook/troubleshooting.md`:
  - add a short “Invalidation report” section describing when to use it and how to interpret the output
- Update `abstractions.md`:
  - reference the report as the canonical “what invalidates what?” debugging entrypoint

### Acceptance Criteria

- There is one deterministic report that answers “what invalidates this target?” using the contract vocabulary.
- The report is referenced by prebuild diagnostics and is covered by tests.

### Risks

Low. The report is diagnostic and should not affect build behavior. The main risk is confusion if the report becomes stale or inconsistent with the contract registry, so tests must cover representative cases.

### Consequence of Not Implementing

Misinterpretation risk remains. Debugging still requires reading multiple files across Starlark and TS to answer basic invalidation questions.

### Downsides for Implementing

One new tool surface and some documentation updates.

### Recommendation

Implement.

---

## PR‑4: Strengthen enforcement: prevent bypassing shared helper surfaces for Nix-calling macros and importer wiring

### Description

After Part 34 migrations, the most likely way new drift reappears is through new macro shapes that bypass shared helper surfaces:

- importer-scoped macros hand-roll lockfile parsing or patch input attachment
- Nix-calling macros forget to attach global Nix inputs as real action inputs (or attach only labels)
- dict-shaped input wiring re-implements synthetic key prefixes

This PR adds enforcement tests and small cleanups to make these bypasses fail quickly and deterministically.

### Scope & Changes

- Add or extend enforcement tests that fail when:
  - importer-scoped macros directly load `//lang:lockfile_labels.bzl` instead of delegating through the shared wiring helpers
  - importer-scoped Nix-calling genrule macros bypass `prepare_importer_nix_calling_genrule_wiring(...)`
  - Nix-calling macros do not attach `global_nix_inputs()` as real action inputs where required by the macro contract
  - dict-safe wiring uses ad-hoc key prefixes rather than the canonical constants
- Add targeted cleanup where enforcement reveals redundant local helpers:
  - remove local list-pop / shape-repair helpers when they are redundant with shared wiring results
  - standardize “single labels merge point” per macro where remaining call sites still merge labels in multiple places

Non-goals in this PR:

- No change to the contract vocabulary or label formats.
- No change to provider model policies (Node and Python remain importer-scoped; Go has no provider sync; C++ provider sync remains curated/no-op).

### Tests (in this PR)

- Add at least one enforcement test per bypass category above.
- Add a cquery-based probe test for at least one Nix-calling Node macro shape that asserts:
  - global Nix inputs are present as action inputs
  - importer-local patches are present as action inputs
  - labels include patch scope and language/kind stamps

### Docs (in this PR)

- Update `docs/handbook/adding-language.md`:
  - explicitly list the enforcement expectations for new macro shapes
  - point authors at the functional wiring helpers from Part 34 and the enforcement tests from this PR
- Update `abstractions.md`:
  - add a short “Enforcement” section summarizing which tests guard which contracts

### Acceptance Criteria

- New macro shapes cannot bypass the shared helper surfaces without tripping enforcement tests.
- At least one representative Nix-calling macro shape is covered by a cquery-based action-input assertion.

### Risks

Moderate. Enforcement tests can be brittle if they over-specify implementation details. They should assert “uses shared surface” and contract outcomes, not exact code shapes.

### Consequence of Not Implementing

Drift risk remains. The repo stays correct, but new work can silently re-introduce bespoke wiring and cause future regressions.

### Downsides for Implementing

Some test churn and small call-site cleanup across Starlark macro files.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and to keep each PR revertible:

1. PR‑1 first. It removes a small TS drift surface and is independent of macro migrations.
2. PR‑2 next. It reduces Nix decoding drift and adds parity coverage.
3. PR‑3 next. It adds a diagnostic report and wires it into debugging workflows.
4. PR‑4 last. It locks in the intended helper usage and prevents new bypass drift.

---

## Verification & Backout Strategy

Each PR includes:

- At least one focused test that asserts the relevant contract behavior.
- A documentation update that points authors at the canonical helper surface and uses the same contract vocabulary.

Backout strategy:

- PR‑1 can be reverted independently. Revert the refactor and keep the old helper functions temporarily if needed.
- PR‑2 can be reverted independently. Restore prior Nix helper duplication if necessary; parity tests should be reverted with it.
- PR‑3 can be reverted independently. The report is diagnostic; revert without affecting build behavior.
- PR‑4 can be reverted independently. If enforcement proves too strict, revert and re-land with narrower, outcome-based assertions.
