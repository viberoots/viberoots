# Directory Reorganization Plan

I am writing this as the project owner. This is a planning document, not an implementation.

## Goals

- Reduce clutter in the repo root.
- Create a top-level home for build system source files, separated from future app and lib code.
- Move as much as possible under a single build-system root folder.
- Improve developer experience and sliceability.

## Scope

In scope:

- Move build-system source files into a new top-level folder.
- Group root-level docs into clear subfolders.
- Define a stable, sliceable top-level directory layout.
- Provide a migration map for each root-level item.
- Define checkpoints and verification steps.
- Ensure only path and import changes, no behavior changes.

Out of scope:

- Functional changes to build or runtime behavior.
- Renaming internal modules unless required by moves.
- Rewriting docs beyond path updates.
- Refactoring logic or changing tool behavior.
- Changing build flags, configs, or outputs.

## Completion Criteria

- Root directory contains only top-level anchors that describe the repo at a glance.
- Build system sources live under one top-level folder.
- App and lib code have reserved top-level homes, even if empty today.
- A move map exists for every current root-level item.
- A migration checklist exists with verification steps.
- Build outputs and behavior match baseline runs.

## Current Root-Level Snapshot (Observed)

This plan is based on the current root layout. I observed a large number of root-level design docs, build system sources, and language rule definitions mixed together.

## Proposed Top-Level Layout

I will use these anchors. Names are stable and minimal.

```
/build-tools/    Build system source code, configs, and tooling
/projects/apps/  App entrypoints (future)
/projects/libs/  Shared libraries (future)
/docs/           Documentation
/patches/        Patch files by language
/third_party/    External and generated providers, vendored inputs
/toolchains/     Buck toolchains and configs
target_platforms Buck target platform definitions
```

Notes:

- I will consolidate build system code under `/build-tools` and keep a small set of root anchors.
- I will move as much as possible that is not apps, libs, or docs into `/build-tools`.
- I will keep `docs` at root and move design docs into subfolders.
- I will keep `patches` at root.
- I will keep `third_party`, `toolchains`, and `target_platforms` at root for now.

## Non-Functional Change Guarantees

This migration must not change behavior. I will enforce these guarantees:

- No logic edits in scripts or Starlark, only path updates.
- No config value changes in Buck, Nix, or CI.
- No renames that change identifiers exposed to users.
- Any unexpected diff beyond path updates is treated as a blocker.

## Build System Top-Level Folder

I will add `/build-tools` as the single top-level folder for build system sources. This separates it from future app and lib code.

Target contents of `/build-tools`:

- `/build-tools/tools` (from current `/tools`)
- `/build-tools/lang` (from current `/lang`)
- `/build-tools/go`, `/build-tools/cpp`, `/build-tools/node`, `/build-tools/python`, `/build-tools/rust` (from current language rule dirs)
- `/build-tools/nix` (from current `/build-tools/tools/nix` and possibly root `flake.nix` related inputs)
- `/build-tools/docs` for build-system design docs that are currently in root
- `/patches` remains at root (not moved)
- `/third_party`, `/toolchains`, and `target_platforms` remain at root (not moved)

Path-sensitive areas I must validate:

- Buck `load()` paths in `*.bzl` files.
- Buck target labels for `//build-tools/lang` if moved.
- Script paths in `package.json`, `build-tools/tools/bin/*`, `Jenkinsfile`, and `toolchains`.
- Nix paths in `flake.nix` and `build-tools/tools/nix/*`.
- Repo-relative paths embedded in zx scripts.

## Move Map (Root-Level Items)

I will list a destination for each current root item. This is required before any refactor.

### Keep in Root

- `README` and other top-level entry docs if present
- `.git*`, `.buck*`, `.husky`, `.prettierrc`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`
- `docs/`
- `patches/`
- `third_party/`
- `toolchains/`
- `target_platforms`

### Move to `/build-tools`

- `build-tools/tools/` -> `build-tools/tools/`
- `go/` -> `build-tools/go/`
- `cpp/` -> `build-tools/cpp/`
- `node/` -> `build-tools/node/`
- `python/` -> `build-tools/python/`
- `rust/` -> `build-tools/rust/`
- `lang/` -> `build-tools/lang/`
- `docs/lang/` -> `build-tools/docs/lang/`
- Root-level build design docs -> `build-tools/docs/` (see list below)

### Move to `/docs/build-history`

Root-level planning history and design notes that are not active reference docs:

- `quad-alignment-*.md`
- `trio-alignment-*.md`
- `linking-plan-*.md`
- `cpp-go-cleanup-*.md`
- `cpp-gaps-plan.md`
- `remaining-go-build-dev-plan.md`

### Move to `/build-tools/docs`

Active build-system reference docs that I expect engineers to read:

- `build-tools/docs/build-system-design.md`
- `docs/history/designs/legacy/build-system-final-steps.md`
- `build-tools/docs/mapping-design.md`
- `docs/history/designs/legacy/nix-node-test.md`
- `docs/history/build-system/nix-rename.md`
- `docs/history/build-system/pnpm-label.md`
- `docs/history/designs/legacy/pnpm-exporter-adapter-prs.md`
- `docs/history/designs/legacy/go-cpp-local-patching.md`
- `build-tools/docs/node-cpp-addon-plan.md`
- `docs/history/designs/legacy/python-extension-design.md`
- `build-tools/docs/lang/python-wasm-design.md`
- `build-tools/docs/lang/uv2nix-design.md`
- `docs/history/designs/legacy/patch-in-uv2nix.md`
- `build-tools/docs/wasm-linking.md`
- `docs/history/build-system/ts-cpp-go-wasm-plan.md`
- `docs/history/designs/legacy/scaf-go-test-design.md`
- `build-tools/docs/scaffolding.md`
- `build-tools/docs/remote-build-setup.md`

If any of these are obsolete, I will move them to `docs/build-history` instead.

### Move or Split

- `lang-refactor-2.md`, `lang-refactor-3.md`:
  - If still active, move to `build-tools/docs/lang/`
  - If historical, move to `docs/history/build-system/logs/`

## Phase Plan

I will follow dependency order. Each phase has inputs, outputs, and checks.

### Phase 0. Baseline Inventory

Purpose: freeze scope and define the move map.

Tasks:

- Record a list of root-level items and their destination path.
- Identify all path-sensitive files: Buck `load` sites, Nix imports, scripts, CI configs.
- Decide whether `lang/` can move under `/build-tools` without breaking Buck label conventions.
- Capture a short baseline run list for later comparison.

Outputs:

- Move map table completed.
- Path-sensitive file list completed.
- Baseline run list recorded.

Checks:

- Every root item has a destination.
- No move proposed without a reason.
- Baseline list is explicit and minimal.

### Phase 1. Create New Anchors

Purpose: create target folders and update documentation structure.

Tasks:

- Create `/build-tools`, `/apps`, `/libs`, `/docs/build-history`, `/build-tools/docs`, `/build-tools/docs/lang`.
- Add a short `docs/handbook/tooling.md` note describing the new layout.

Outputs:

- New directories exist.
- Documentation mentions new anchors.

Checks:

- Folder names match the plan.
- No code moved yet.

### Phase 2. Move Documentation

Purpose: reduce root clutter without code risk.

Tasks:

- Move root-level build docs to `/build-tools/docs` and `/docs/build-history`.
- Update references in `docs/` to the new paths.

Outputs:

- Root now holds fewer standalone `.md` files.

Checks:

- `rg` for old filenames shows only correct references.
- No changes to code or config files.

### Phase 3. Move Build System Sources

Purpose: centralize build system code under `/builder`.

Tasks:

- Move `build-tools/tools/` to `build-tools/tools/`.
- Move language rule folders (`go`, `cpp`, `node`, `python`, `rust`) to `build-tools/`.
- Move `build-tools/lang/` to `build-tools/lang/`.
- Keep `third_party/`, `toolchains`, and `target_platforms` at root.
- Update all Buck `load()` paths and any `filegroup` or `glob` references.
- Update Buck labels only if `build-tools/lang/` moves.
- Update all Node and zx script paths (`package.json`, `build-tools/tools/bin/*`).
- Update Nix paths in `flake.nix` and `build-tools/tools/nix/*`.
- Update CI paths in `Jenkinsfile`.
- Validate only path and import changes in moved files.

Outputs:

- Build system source files live under `/build-tools`.
- All references compile and resolve.

Checks:

- `buck2 targets //...` succeeds.
- `node build-tools/tools/dev/install-deps.ts` runs if it existed before.
- `nix flake check` runs if used in this repo.
- Diff review shows only path and import updates.

### Phase 4. Sliceability Cleanups

Purpose: improve module slicing and ownership boundaries.

Tasks:

- Group build subdomains under `build-tools/tools/*` by function:
  - `build-tools/tools/buck`
  - `build-tools/tools/nix`
  - `build-tools/tools/patch`
  - `build-tools/tools/scaffolding`
  - `build-tools/tools/tests`
  - `build-tools/tools/lib`
- Ensure each directory has a single responsibility.
- Avoid new cross-domain imports. Prefer shared helpers under `build-tools/tools/lib`.

Outputs:

- Build tool layout expresses responsibilities.

Checks:

- No circular or cross-cutting imports introduced.
- No logic changes introduced during folder regrouping.

### Phase 5. Stabilize and Document

Purpose: update docs and stabilize the new layout.

Tasks:

- Update any references in docs and tooling guides.
- Add a short `docs/handbook/conventions.md` note with the new top-level layout.
- Confirm `README` uses the new paths if it mentions old locations.

Outputs:

- Docs match reality.

Checks:

- `rg` shows no old `build-tools/tools/` or `build-tools/lang/` references unless intentional.
- Baseline runs still match.

## Dependencies and Risks

- Buck `load` paths are the highest risk.
- Buck target labels will change if `build-tools/lang/` moves.
- Nix paths and flake inputs are the next highest risk.
- Tooling scripts often assume repo-root-relative paths.
- CI scripts may hardcode old paths.

Mitigations:

- Move docs first to reduce scope.
- Update build system paths in a single focused phase.
- Use a dedicated checklist for each path-sensitive file.
- Require a diff-only review focused on path/import edits.

## Progress Tracking

Status indicators:

- READY
- BLOCKED
- COMPLETED
- UNCERTAIN

I will mark each phase and task with one of these statuses during execution.

## Open Decisions

- Do we add a compatibility shim for `build-tools/lang/` after moving under `/build-tools`
- Should `docs` remain a mix of general and build docs, or should build docs live only under `/build-tools/docs`
- Should we keep a compatibility shim for `build-tools/tools/` and `build-tools/lang/` paths or hard-cut to `/build-tools`

## Patches Policy

Package-local patches are the primary workflow. We still support global patches as an optional fallback, but I want that path to be explicit.

Planned behavior:

- Keep package-local patches as the default (`<pkg>/patches/<lang>`).
- Retain a global patches directory for rare shared cases.
- The global location stays at root: `patches/<lang>`.

If these are unresolved, I will mark the affected tasks as UNCERTAIN and proceed with the safe items first.
