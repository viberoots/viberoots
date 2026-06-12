# Reorg Plan (Phases 0-5)

This document is a development plan to implement Phases 0-5 of `docs/history/designs/legacy/reorg.md`. I keep the plan as a list of PRs. Each PR includes its own tests and documentation updates. I do not plan any tests-only or docs-only PRs. No functionality should land without tests in the same PR.

## Prerequisites (must already be true)

- The Phase 0-5 scope is approved in `docs/history/designs/legacy/reorg.md`.
- The change must remain non-functional, with only path and import updates.
- Phase 0 baseline run list exists and is recorded.

---

## PR-1: Phase 0 baseline inventory

### Description

This PR records the Phase 0 baseline inventory so later PRs can prove the migration is non-functional. It is documentation plus test execution evidence in one place.

### Scope & Changes

This PR makes the following changes:

- Record the baseline run list in a short markdown note.
- Capture a list of path-sensitive areas and current root-level items to move.

### Tests (in this PR)

I run the Phase 0 baseline run list and record the commands and outcomes in the note.

### Docs (in this PR)

I add a small baseline note that includes:

- The baseline run list and outcomes.
- The root-level inventory snapshot.

### Acceptance Criteria

The following must be true:

- The baseline note exists and is readable.
- The baseline run list is explicit and minimal.
- No behavior changes are introduced.

### Risks

Low. This is a documentation and verification step.

### Consequence of Not Implementing

There is no reliable baseline to compare later changes against.

### Downsides for Implementing

It adds a small one-time documentation artifact.

### Recommendation

Implement.

---

## PR-9: Default lockfile inference for Python

### Description

This PR aligns Python with Node by defaulting the importer-scoped lockfile label when a Python macro call omits it. This reduces boilerplate in scaffolds while preserving strict validation.

### Scope & Changes

This PR makes the following changes:

- Add default lockfile inference for Python macros (e.g., `nix_python_library`, `nix_python_binary`, `nix_python_test`, WASM variants) when no lockfile label is provided.
- Keep the existing validation rules for importer-scoped lockfile labels and supported importer roots.
- Ensure error text remains deterministic when the default lockfile is missing.

### Tests (in this PR)

I update or add tests to prove:

- Python macros succeed with omitted `lockfile_label` when the default lockfile exists at `<package>/uv.lock`.
- Python macros fail with the same deterministic error if the default lockfile is missing.
- Existing explicit-label behavior remains unchanged.

### Docs (in this PR)

I update docs that describe Python lockfile labeling to note that the default label is inferred when omitted.

### Acceptance Criteria

The following must be true:

- Python importer-scoped macros infer the default lockfile label when omitted.
- Failure behavior and supported importer rules remain unchanged.
- Tests cover default inference and missing-lockfile error cases.

### Risks

Low. This is a small wiring change and should only reduce boilerplate in Python targets.

### Consequence of Not Implementing

Python scaffolds and targets must continue to specify lockfile labels manually, even when the default is obvious.

### Downsides for Implementing

Minor behavior change that requires updating a small set of tests and documentation.

### Recommendation

Implement.

---

## PR-2: Add new top-level anchors

### Description

This PR creates the new anchor directories for the reorg and documents the layout. It runs existing tests to ensure behavior is unchanged and updates them only if path changes require it.

### Scope & Changes

This PR makes the following changes:

- Create empty directories:
  - `build-tools/`
  - `projects/apps/`
  - `projects/libs/`
  - `docs/history/build-system/logs/`
  - `build-tools/docs/`
  - `build-tools/docs/lang/`
- Add a short note in `docs/handbook/tooling.md` describing the new top-level layout and intent.

### Tests (in this PR)

I run the Phase 0 baseline run list and update tests only if paths in the test inputs change.

### Docs (in this PR)

I document the new anchors:

- Update `docs/handbook/tooling.md` with the new top-level layout and the reason for the anchor directories.

### Acceptance Criteria

The following must be true:

- The anchor directories exist and are empty placeholders.
- Documentation reflects the new top-level layout.
- No behavior changes are introduced.

### Risks

Low. This is a structural change with no behavior changes expected.

### Consequence of Not Implementing

The repo has no stable anchor points, and later moves will be harder to review safely.

### Downsides for Implementing

It introduces new empty directories that may be unused until later phases.

### Recommendation

Implement.

---

## PR-3: Move documentation into the new structure

### Description

This PR moves root-level build docs into `build-tools/docs` and historical notes into `docs/build-history`, and updates any references.

### Scope & Changes

This PR makes the following changes:

- Move root-level build docs into `build-tools/docs`.
- Move historical plan docs into `docs/build-history`.
- Update references in `docs/` and any other markdown that points to moved files.

### Tests (in this PR)

I run the Phase 0 baseline run list and update tests only if paths in test fixtures or references change.

### Docs (in this PR)

I update documentation references for the moved files:

- Update any doc links that point to old paths.

### Acceptance Criteria

The following must be true:

- Root-level build docs are moved to `build-tools/docs`.
- Historical plan docs are moved to `docs/build-history`.
- All doc references resolve to the new paths.
- No behavior changes are introduced.

### Risks

Low. Path changes and link updates only.

### Consequence of Not Implementing

The root stays cluttered and later moves become harder to review.

### Downsides for Implementing

It changes doc paths that may be referenced externally.

### Recommendation

Implement.

---

## PR-4: Move `build-tools/tools/` under `build-tools`

### Description

This PR moves the `build-tools/tools/` tree under `build-tools` and updates all references. It keeps `third_party`, `toolchains`, `target_platforms`, and `patches` at root.

### Scope & Changes

This PR makes the following changes:

- Move `build-tools/tools/` to `build-tools/tools/`.
- Update path references in:
  - `package.json`
  - `build-tools/tools/bin/*` (moved to `build-tools/tools/bin/*`)
  - `Jenkinsfile`
  - any scripts that hardcode `build-tools/tools/` paths
- Update Nix paths for `build-tools/tools/nix` now under `build-tools/tools/nix`.

### Tests (in this PR)

I run the Phase 0 baseline run list and update tests only if path changes require it. I also validate:

- `buck2 targets //...`
- `node build-tools/tools/dev/install-deps.ts` (if it existed before)
- `nix flake check` (if used in this repo)

### Docs (in this PR)

I update any docs that mention moved paths.

### Acceptance Criteria

The following must be true:

- `build-tools/tools/` now lives under `build-tools/tools/`.
- `third_party/`, `toolchains`, `target_platforms`, and `patches/` remain at root.
- All path references resolve.
- Baseline runs pass.
- No behavior changes are introduced.

### Risks

Medium. Many scripts reference `build-tools/tools/` paths.

### Consequence of Not Implementing

The tooling remains split from the new build-system root.

### Downsides for Implementing

This is a path-heavy change with a higher review burden.

### Recommendation

Implement.

---

## PR-5: Move language rule folders under `build-tools`

### Description

This PR moves the language rule folders under `build-tools` and updates Buck `load()` paths and references.

### Scope & Changes

This PR makes the following changes:

- Move `go/`, `cpp/`, `node/`, `python/`, `rust/` to `build-tools/`.
- Update Buck `load()` paths and any path-sensitive references.
- Update any docs or scripts that reference these paths.

### Tests (in this PR)

I run the Phase 0 baseline run list and update tests only if path changes require it.

### Docs (in this PR)

I update any docs that reference moved language rule paths.

### Acceptance Criteria

The following must be true:

- Language rule folders live under `build-tools/`.
- All Buck loads and references resolve.
- Baseline runs pass.
- No behavior changes are introduced.

### Risks

Medium. Buck `load()` paths are numerous and brittle.

### Consequence of Not Implementing

The build-system root still has major language folders at root.

### Downsides for Implementing

It requires careful path updates and review.

### Recommendation

Implement.

---

## PR-6: Move `lang/` under `build-tools`

### Description

This PR moves `lang/` under `build-tools` and updates Buck references. This is isolated because it can affect label conventions.

### Scope & Changes

This PR makes the following changes:

- Move `lang/` to `build-tools/lang/`.
- Update Buck `load()` paths and any `//lang/...` references.
- Update any docs that reference `lang/` paths.

### Tests (in this PR)

I run the Phase 0 baseline run list and update tests only if path changes require it.

### Docs (in this PR)

I update docs that mention `lang/` paths.

### Acceptance Criteria

The following must be true:

- `lang/` lives under `build-tools/lang/`.
- All Buck references resolve.
- Baseline runs pass.
- No behavior changes are introduced.

### Risks

Medium. `//lang/...` labels are used across the repo.

### Consequence of Not Implementing

The core shared Starlark helpers remain outside the build-system root.

### Downsides for Implementing

Requires careful updates to avoid breakage.

### Recommendation

Implement if we accept the label changes or add a compatibility shim.

---

## PR-7: Sliceability cleanups inside `build-tools/tools`

### Description

This PR regroups build tools into clear subdomains under `build-tools/tools` without changing logic.

### Scope & Changes

This PR makes the following changes:

- Group tooling into:
  - `build-tools/tools/buck`
  - `build-tools/tools/nix`
  - `build-tools/tools/patch`
  - `build-tools/tools/scaffolding`
  - `build-tools/tools/tests`
  - `build-tools/tools/lib`
- Update import paths across tooling to match the new layout.

### Tests (in this PR)

I run the Phase 0 baseline run list and update tests only if path changes require it.

### Docs (in this PR)

I update any docs that reference moved tooling paths.

### Acceptance Criteria

The following must be true:

- Tooling is grouped by responsibility under `build-tools/tools`.
- All imports resolve.
- Baseline runs pass.
- No behavior changes are introduced.

### Risks

Medium. Internal tool imports can be numerous and brittle.

### Consequence of Not Implementing

The new top-level structure will not improve sliceability inside tooling.

### Downsides for Implementing

It requires careful path updates and review.

### Recommendation

Implement.

---

## PR-8: Stabilize and document the new layout

### Description

This PR updates remaining docs and references to reflect the finalized layout and verifies the baseline runs still match.

### Scope & Changes

This PR makes the following changes:

- Update `docs/handbook/conventions.md` with the final layout.
- Update `README` if it references old paths.
- Update any remaining docs with old path references.

### Tests (in this PR)

I run the Phase 0 baseline run list and update tests only if path changes require it.

### Docs (in this PR)

I update the docs listed above as part of the scope.

### Acceptance Criteria

The following must be true:

- Documentation reflects the final layout.
- Baseline runs pass.
- No behavior changes are introduced.

### Risks

Low. This is a cleanup pass.

### Consequence of Not Implementing

Docs will drift and confuse the new layout.

### Downsides for Implementing

Minimal.

### Recommendation

Implement.
