# Implicit Lockfile Labels for Node Macros

This document proposes a small, deterministic change to the Node macro surface so callers do not need to manually compute lockfile labels. It follows the design principles in `build-system-design.md` and the PNPM design in `lang-design-docs/pnpm-design.md`.

I keep the behavior explicit and deterministic. I do not add filesystem scans or nearest-lockfile deduction. The default is derived from the Buck package path and fails fast if the lockfile is missing.

---

## Goals

- Reduce boilerplate for Node macro call sites.
- Keep importer identity deterministic and unambiguous.
- Preserve current provider wiring and invalidation behavior.
- Avoid filesystem heuristics or ambiguous deduction.

## Non-Goals

- Do not infer importer from nearest lockfile or `package.json`.
- Do not change provider naming or auto-map semantics.
- Do not change Node macro caller package placement requirements.

---

## Design

### Summary

For Node macros that require `lockfile_label`, derive a default when the caller does not supply one:

- importer = `native.package_name()`
- lockfile path = `<importer>/pnpm-lock.yaml`
- label = `lockfile:<importer>/pnpm-lock.yaml#<importer>`

The macro continues to allow an explicit `lockfile_label` override.

### Rationale

- Determinism: `native.package_name()` is stable and unambiguous.
- Consistency: matches the per‑importer lockfile model in `lang-design-docs/pnpm-design.md`.
- Predictability: no filesystem scanning and no label guessing.
- Failure mode: missing lockfile fails fast with a targeted error.

### Behavior Changes

1. If `lockfile_label` is provided, behavior is unchanged.
2. If `lockfile_label` is omitted:
   - compute the default label from the package name
   - validate that the computed lockfile exists
   - wire labels and providers as normal

### API Surface

No new macro parameters. This preserves current call sites and allows the convention-based default without adding a new parameter.

### Validation Rules

- Exactly one importer-scoped lockfile label must be in effect after applying the default or override.
- The default lockfile path must exist or the macro fails.
- If both `lockfile_label` and a `labels` entry with `lockfile:` are provided, fail as today.

### Files and Responsibilities

- `//lang:defs_common.bzl`
  - Add a helper to compute default lockfile label from `native.package_name()`.
  - Add a helper to validate lockfile existence when the default is used.
- `//node:defs_core.bzl`
  - Use the helper when `lockfile_label` is omitted.
  - Keep `nix_node_gen`, `nix_node_lib`, `nix_node_bin`, `nix_node_test` wiring unchanged.
- `//node:defs_nix.bzl`
  - Apply the same defaulting behavior for `node_webapp` and bundled `nix_node_cli_bin`.

### Error Message Shape

Keep errors concrete and actionable:

- Missing lockfile:
  - `nix_node_gen: missing lockfile at <path>. Provide lockfile_label or create <path>.`
- Multiple lockfile labels:
  - Keep existing error behavior.

### Interaction with Existing Policies

- Buck package boundary rule stays the same. Node targets must live in the importer package.
- Provider sync stays the same. The auto-map already maps `lockfile:<path>#<importer>` labels.
- No change to `tools/buck/sync-providers.ts` or `tools/buck/gen-auto-map.ts`.

---

## User-Level Examples

These examples show the expected callsites after the change. The default case relies on the package path convention. The non-default cases show when an explicit `lockfile_label` remains necessary.

### Default Cases (convention-based)

App under `apps/web` with its own importer and lockfile. No explicit `lockfile_label` is needed.

`apps/web/TARGETS`:

```python
load("//node:defs_nix.bzl", "node_webapp")

node_webapp(
    name = "web",
    deps = ["//libs/ui:ui"],
)
```

This expands to `lockfile:apps/web/pnpm-lock.yaml#apps/web` and fails fast if the lockfile is missing.

Library under `libs/ui` using the default convention:

`libs/ui/TARGETS`:

```python
load("//node:defs_core.bzl", "nix_node_lib")

nix_node_lib(
    name = "ui",
)
```

### Non-Default Cases (explicit override)

Root tooling importer with `importer="."` and `pnpm-lock.yaml` at the repo root. A tool target under `tools/dev` needs an explicit label because the package name is `tools/dev`, not `.`.

`tools/dev/TARGETS`:

```python
load("//node:defs_core.bzl", "nix_node_gen")

nix_node_gen(
    name = "sync-providers",
    srcs = ["sync-providers.ts"],
    cmd = "node $SRCS > $OUT",
    lockfile_label = "lockfile:pnpm-lock.yaml#.",
)
```

Migration case where the importer id does not match the package path. For example, an app under `apps/admin` uses a lockfile importer id of `apps/web` during a staged move.

`apps/admin/TARGETS`:

```python
load("//node:defs_core.bzl", "nix_node_gen")

nix_node_gen(
    name = "admin-bundle",
    srcs = ["bundle.ts"],
    cmd = "node $SRCS > $OUT",
    lockfile_label = "lockfile:apps/web/pnpm-lock.yaml#apps/web",
)
```

This keeps the override explicit and avoids implicit cross-importer deduction.

---

## Development Plan

I follow the structure used in `linking-plan-11.md`. Each PR includes functionality, tests, and documentation updates in the same change.

### PR-1: Default lockfile label for node/defs_core.bzl

#### Description

Introduce a convention-based default lockfile label for `nix_node_gen`, `nix_node_lib`, `nix_node_bin`, and `nix_node_test` when `lockfile_label` is omitted.

#### Scope & Changes

- Add helper in `//lang:defs_common.bzl`:
  - `default_lockfile_label_from_package()` returns `lockfile:<pkg>/pnpm-lock.yaml#<pkg>`.
  - `ensure_default_lockfile_exists(path)` validates the file exists.
- Update `//node:defs_core.bzl` to:
  - derive a default when `lockfile_label` is omitted
  - validate the default lockfile exists
  - preserve the existing enforcement of exactly one lockfile label
- Update `lang-design-docs/pnpm-design.md`:
  - document the default label convention
  - note the fast-fail on missing lockfile

#### Tests (in this PR)

- `tools/tests/node/node.lockfile-label.default-from-package.uses-default.test.ts`
  - define a node target without `lockfile_label` in `apps/foo/TARGETS`
  - ensure the macro expands successfully when `apps/foo/pnpm-lock.yaml` exists
- `tools/tests/node/node.lockfile-label.default-from-package.missing-lockfile.fails-fast.test.ts`
  - define a node target without `lockfile_label` in `apps/bar/TARGETS`
  - assert the macro fails with the missing lockfile error

#### Acceptance Criteria

- Node macros in `defs_core.bzl` work without `lockfile_label` when the convention path exists.
- Missing lockfile fails fast with a targeted error.
- Existing behavior with explicit `lockfile_label` is unchanged.
- Tests pass and are one-test-per-file.

#### Risks

Low. The default is deterministic and does not change provider wiring or label shape.

#### Consequence of Not Implementing

Node macro call sites remain verbose and error-prone when specifying lockfile labels.

#### Downsides for Implementing

Slightly more macro logic and two new tests.

#### Recommendation

Implement to reduce boilerplate while keeping deterministic importer identity.

---

### PR-2: Default lockfile label for node/defs_nix.bzl

#### Description

Apply the same defaulting behavior to Nix-calling Node macros (`node_webapp` and bundled `nix_node_cli_bin`).

#### Scope & Changes

- Reuse the shared defaulting helper from `//lang:defs_common.bzl`.
- Update `//node:defs_nix.bzl`:
  - derive a default lockfile label when omitted
  - validate the default lockfile exists
  - preserve the existing optional `importer` arg mismatch checks
- Update `docs/handbook/node-macros.md`:
  - document the convention-based default and failure mode

#### Tests (in this PR)

- `tools/tests/node/node.defs-nix.lockfile-label.default-from-package.webapp.test.ts`
  - define a `node_webapp` without `lockfile_label` under `apps/web`
  - assert the macro expands and the derived lockfile label is used
- `tools/tests/node/node.defs-nix.lockfile-label.default-from-package.missing-lockfile.fails-fast.test.ts`
  - define a `node_webapp` without `lockfile_label` under `apps/missing`
  - assert fast-fail with missing lockfile error

#### Acceptance Criteria

- `node_webapp` and bundled `nix_node_cli_bin` accept omitted `lockfile_label` when the convention path exists.
- Missing lockfile fails fast with a targeted error.
- Documentation explains the new default and how to override it.
- Tests pass and are one-test-per-file.

#### Risks

Low. The change is limited to lockfile label defaulting and validation.

#### Consequence of Not Implementing

Nix-calling Node macros keep requiring manual labels while core Node macros do not.

#### Downsides for Implementing

Small macro changes and two new tests.

#### Recommendation

Implement to keep the Node macro surface consistent.

---

### PR-3: Enforce Node deps parity between package.json and TARGETS

#### Description

Add a deterministic enforcement mechanism that keeps Node workspace dependencies in sync between `package.json` and Buck `deps`. This prevents drift where users update one and forget the other.

#### Scope & Changes

- Add `tools/buck/enforce-node-deps.ts` (zx):
  - Reads each importer `package.json` under `apps/*` and `libs/*`.
  - Resolves workspace dependencies to Buck target labels via a deterministic mapping file:
    - `tools/node/workspace-map.json` (package name → Buck label).
  - For each Node target in the importer package, compare declared Buck `deps` with the expected set.
  - Supports two modes:
    - `--check` (default): fail on drift with a minimal diff.
    - `--fix`: rewrite the Node target `deps` to match the expected set.
- Update the `i` script to run `node tools/buck/enforce-node-deps.ts --check` and print a user-facing warning on drift.
  - The warning must include the exact fix command:
    - `node tools/buck/enforce-node-deps.ts --fix`
- Update `tools/buck/prebuild-guard.ts` to call `node tools/buck/enforce-node-deps.ts --check` in CI.
- Update `docs/handbook/node-macros.md` to describe the enforcement and the `--fix` workflow.
- Update `lang-design-docs/pnpm-design.md` with the high-level rule: `package.json` is the source of truth, Buck `deps` must match.

#### Tests (in this PR)

- `tools/tests/node/node.deps-enforcement.matches-package-json.passes.test.ts`
  - Create a temp importer with a workspace dep and matching Buck `deps`.
  - Assert `--check` succeeds.
- `tools/tests/node/node.deps-enforcement.drift.fails-fast.test.ts`
  - Create a temp importer where `package.json` and Buck `deps` diverge.
  - Assert `--check` fails with a targeted error.
- `tools/tests/node/node.deps-enforcement.fix.rewrites-deps.test.ts`
  - Start with drift, run `--fix`, and assert the `deps` list matches the expected mapping.

#### Acceptance Criteria

- Drift between `package.json` and Buck `deps` is detected in CI.
- The `--fix` mode rewrites Buck `deps` deterministically.
- Documentation for the enforcement and fix workflow is updated in the same PR.
- Tests cover success, failure, and fix flows.

#### Risks

Low to medium. The mapping file requires maintenance when adding or renaming packages.

#### Consequence of Not Implementing

Users can forget to update Buck `deps`, leading to incorrect invalidation and missing graph edges.

#### Downsides for Implementing

Adds a small maintenance surface (`workspace-map.json`) and a new check in CI.

#### Recommendation

Implement to keep dependency edges correct and prevent drift without adding runtime heuristics.

---

### PR-4: Auto-generate workspace-map.json from provider metadata

#### Description

Eliminate manual maintenance of `tools/buck/workspace-map.json` by generating it deterministically from existing provider metadata in the glue pipeline. This keeps enforcement strict while removing hidden, user-maintained state.

#### Scope & Changes

- Add a generator script (e.g. `tools/node/gen-workspace-map.ts`):
  - Read the existing provider/auto-map metadata that already encodes package name → Buck label.
  - Emit a stable, sorted `tools/buck/workspace-map.json`.
- Wire the generator into the glue pipeline:
  - Run after provider sync and auto-map generation so the metadata is available.
  - Fail if the generator cannot build a complete mapping for workspace deps.
- Update `tools/buck/enforce-node-deps.ts` to rely on the generated mapping without fallbacks.
- Update documentation to state the mapping is generated and should not be edited by hand.

#### Tests (in this PR)

- `tools/tests/node/node.workspace-map.generation.matches-providers.test.ts`
  - Generate the map from a temp provider dataset and assert the output mapping is stable and complete.
- `tools/tests/node/node.deps-enforcement.generated-map.required.test.ts`
  - Ensure enforcement fails fast when the generated map is missing or incomplete.

#### Acceptance Criteria

- `tools/buck/workspace-map.json` is generated deterministically from provider metadata.
- Enforcement uses the generated mapping and does not rely on manual edits.
- Missing or incomplete mapping fails fast with a targeted error.
- Tests validate generation and enforcement expectations.

#### Risks

Low to medium. Adds a dependency on the glue pipeline order and provider metadata stability.

#### Consequence of Not Implementing

Users must manually maintain `workspace-map.json`, which is easy to forget or drift.

#### Downsides for Implementing

Additional generator step and tests; tighter coupling to provider metadata.

#### Recommendation

Implement to remove hidden manual upkeep while keeping deterministic enforcement.

---

### PR-5: Speed up devshell entry by caching node_modules link freshness

#### Description

Reduce `direnv`/devshell entry time by avoiding repeated `nix eval` for `node_modules` when the existing symlink is already valid. This keeps correctness by validating freshness against a lockfile hash marker and skips linking in non-root contexts (e.g. temp repos).

#### Scope & Changes

- Add a lightweight marker file under `buck-out/tmp/`:
  - Store importer, lockfile path, lockfile hash, and resolved store path.
- Update `tools/nix/devshell.nix` shellHook:
  - If `node_modules` is a symlink and the marker matches the current lockfile hash, skip `nix eval`.
  - If missing or stale, fall back to the current behavior and refresh the marker.
  - Only apply the fast-path at repo root and avoid writes in temp repos.
  - Preserve existing `NO_NODE_MODULES_LINK` behavior.
- Update docs to describe the marker behavior and the stale-link mitigation.

#### Tests (in this PR)

- Add a small devshell timing probe (or a focused test) that:
  - Ensures the marker is written on first link.
  - Ensures a matching marker skips re-linking.
  - Ensures lockfile changes force a relink and marker refresh.

#### Acceptance Criteria

- `direnv exec . true` drops to low single-digit seconds when `node_modules` is already linked and unchanged.
- Lockfile changes trigger relinking deterministically.
- No per-test temp repo writes for the marker.

#### Risks

Low to medium. A stale marker could hide a needed relink, but the lockfile hash check prevents this under normal workflows.

#### Consequence of Not Implementing

Dev shell entry remains slow, and frequent `direnv` reloads add unnecessary overhead to tests and local workflow.

#### Downsides for Implementing

Adds a small marker file and extra shellHook logic to maintain.

#### Recommendation

Implement to improve DX while retaining deterministic correctness.

---

## Completion Criteria

- All Node macros accept omitted `lockfile_label` when the package follows the importer convention.
- Missing lockfile yields deterministic, actionable errors.
- Documentation updated in the same PRs as the behavior changes.
- Tests cover both success and failure paths for `defs_core.bzl` and `defs_nix.bzl`.
