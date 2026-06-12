# Node Library Patching Plan

This plan adds importer-safe patch requirement enforcement for Node local-library dependencies.

The design keeps importer-local patch ownership and prevents silent misses with automatic checks.

This plan is split into two PRs:

- PR-1 establishes the Node patch requirement model, CLI remediation, install-time checks, tests,
  and docs.
- PR-2 closes remaining build-entrypoint enforcement gaps so normal Node build paths enforce the
  same transitive requirement policy.

Scope: infer patch requirements from library patch files, allow per-patch option overrides, enforce
transitive requirements on importer builds, and provide explicit remediation tooling.

Non-goals: automatic transitive patch adoption, automatic patch-file mutation during `i`, and
cross-language rollout.

Completion criteria: missing required patch requirements fail deterministically with clear remediation,
while existing importer-local patch semantics remain unchanged.

---

## Terms and Inputs

- **Library importer**: importer that owns a local library target, for example `projects/libs/foo`.
- **App importer**: importer building/running an app target, for example `projects/apps/web`.
- **Canonical patch id**: lowercase `name@version`, matching existing filename decoding.
- **Library patch directory**: `<library_importer>/patches/node/*.patch`.
- **Importer patch directory**: `<importer>/patches/node/*.patch`.

Patch filename expectation remains:

- `<name>@<version>.patch` (with existing encoding/decoding rules preserved).

---

## Proposed Contract (Starlark)

I will use one explicit Starlark field:

- `patch_options`: per-patch behavior overrides.

Required requirements are inferred from patch files under the library importer:

- `<library_importer>/patches/node/*.patch`

I only add entries in `patch_options` when behavior should differ from defaults.

Supported option in this PR:

- `optional` (boolean), default `false`.

Example:

- patch files:
  - `projects/libs/foo/patches/node/lodash@4.17.21.patch`
  - `projects/libs/foo/patches/node/debug@4.3.4.patch`
- Starlark:
  - `patch_options = {"debug@4.3.4": {"optional": true}}`

Behavior:

- `lodash@4.17.21` is required (default).
- `debug@4.3.4` is optional (override).

Validation rules:

- Unknown patch ids in `patch_options` fail validation.
- Unknown option keys fail validation.
- Stale optional configuration (optional set for ids no longer inferred from library patch files)
  warns.

---

## End-to-End Validation Flow

1. Infer library requirement ids from `<library_importer>/patches/node/*.patch`.
2. Normalize all ids to canonical lowercase `name@version`.
3. Apply `patch_options` overrides (`optional` only in this PR).
4. Export requirement metadata for dependency consumers.
5. At importer build/analysis, resolve transitive requirement closure from local-library deps.
6. Collect importer patch ids from `<importer>/patches/node/*.patch`.
7. Compare closure requirements against importer patch ids:
   - missing non-optional => fail,
   - missing optional => warn.
8. Always print the exact remediation command:
   - `patch-pkg sync-required node --importer <importer>`

Install-time behavior:

- `i` runs read-only checks.
- `i` does not mutate patch files by default.
- `i` prints the same exact remediation command on warnings/errors.

---

## PR-1: Add importer-safe Node patch requirement enforcement and remediation flow

### Description

I will implement infer-from-files patch requirements, `patch_options` overrides, importer-side
transitive enforcement, and explicit remediation tooling in one PR.

### Scope & Changes

- Update Node macro/wiring to accept and validate:
  - `patch_options = {"name@version": {"optional": bool}, ...}`.
- Infer required requirements from local library patch files:
  - `<library_importer>/patches/node/*.patch`.
- Add deterministic normalization helpers for canonical lowercase patch ids.
- Enforce option defaults and validation:
  - missing option => `optional = false`,
  - unknown option keys => fail,
  - unknown patch ids in `patch_options` => fail,
  - stale optional configuration => warn.
- Export normalized requirement metadata through existing provider/wiring surfaces.
- Add importer-side closure enforcement:
  - resolve transitive requirements from local-library deps,
  - compare against importer patch ids,
  - fail/warn per rules above,
  - print exact remediation command in diagnostics.
- Add remediation command:
  - `patch-pkg sync-required node --importer <importer>`,
  - checklist output and optional placeholder generation only when explicitly requested.
- Wire read-only checks into `i` without default mutation.

### Implementation Map (new engineer guide)

- **Node macro surface**: `build-tools/node/`
- **Shared language wiring/helpers**: `build-tools/lang/`
- **Patch decode/canonical key behavior**: `build-tools/tools/lib/providers.ts`
- **Patch CLI flow**: `build-tools/tools/patch/`
- **Install (`i`) flow integration**: `build-tools/tools/dev/install/`

This PR should reuse existing canonical patch decoding and importer-label plumbing. Do not add new
filename rules.

### Tests (in this PR)

- Add/extend Node macro tests to verify:
  - accepted `patch_options` shape,
  - requirement inference from patch filenames,
  - canonical lowercase normalization,
  - required-by-default behavior (`optional = false`),
  - unknown option keys fail,
  - unknown patch ids fail,
  - stale optional configuration warns,
  - stable ordering and duplicate handling.
- Add/extend importer enforcement tests to verify:
  - missing required fails with deterministic diagnostics,
  - optional behavior follows policy when `optional = true`,
  - unrelated importers remain unaffected.
- Add CLI/install tests to verify:
  - `patch-pkg sync-required` checklist output and optional placeholder flow,
  - `i` runs check-only behavior and prints exact command.

### Docs (in this PR)

- Update `docs/handbook/patching.md` with:
  - infer-from-files requirement model,
  - `patch_options` contract,
  - importer enforcement behavior,
  - remediation command flow.
- Update `docs/handbook/node-macros.md` with the Node requirement contract.

### Acceptance Criteria

- Node libraries infer required requirements from patch files.
- Node libraries can override behavior via `patch_options`.
- Internal representation is canonical lowercase `name@version`.
- Existing importer-local patch behavior does not change.
- Unknown option keys in `patch_options` fail deterministically.
- Unknown patch ids in `patch_options` fail deterministically.
- Stale optional configuration warns with affected ids.
- Importers fail deterministically for missing required transitive requirements.
- `i` surfaces requirement gaps without mutating patch files by default.
- Failure/warning diagnostics include exact importer-specific remediation command:
  - `patch-pkg sync-required node --importer <importer>`.
- `patch-pkg sync-required node --importer <importer>` provides deterministic remediation output.

### Risks

Option-shape errors, unknown patch ids, and stricter importer checks can cause initial adoption
friction.

### Mitigation

Fail fast with strict `patch_options` validation, deterministic diagnostics, and direct remediation
commands. Keep stale-option handling as warn-only for cleanup visibility.

### Consequence of Not Implementing

Patch requirements remain implicit and apps can miss critical dependency patches silently.

### Downsides for Implementing

Additional validation logic, CLI surface area, and test coverage to maintain.

### Recommendation

Implement.

---

## PR-2: Enforce Node transitive patch requirements on all Node build entrypoints

### Description

I will close the remaining enforcement gap by wiring Node transitive patch requirement checks into
the primary Node build entrypoints, not only install-time warnings and selected-build preflight.

### Scope & Changes

- [ ] Define one Node build-time preflight contract:
  - [ ] run read-only requirement checks before Node Nix build execution.
  - [ ] preserve current remediation command output.
- [ ] Wire enforcement into normal Node build entrypoints:
  - [ ] `build-tools/node/defs_core.bzl` (`nix_node_gen` and wrappers such as `nix_node_lib`).
  - [ ] `build-tools/node/defs_nix.bzl` (`node_webapp`, `nix_node_cli_bin` bundle and non-bundle routes).
  - [ ] `build-tools/node/defs_stage.bzl` (`node_asset_stage`, `node_wasm_inline_module`).
- [ ] Apply one shared policy across all listed entrypoints:
  - [ ] missing required transitive patch requirements => fail.
  - [ ] missing optional transitive patch requirements => warn (non-fatal).
  - [ ] print exact importer-specific remediation command.
- [ ] Reuse a shared command or wiring helper so entrypoints do not re-implement enforcement shell logic.
- [ ] Keep install-time behavior unchanged (`i` remains warning-first and non-mutating by default).
- [ ] Keep CLI behavior unchanged (`patch-pkg sync-required node --importer <importer>` remains explicit remediation).

### Implementation Map (new engineer guide)

- **Node macro build entrypoints**: `build-tools/node/defs_core.bzl`, `build-tools/node/defs_nix.bzl`, `build-tools/node/defs_stage.bzl`, `build-tools/node/defs.bzl`
- **Shared shell/wiring helper (preferred location)**: `build-tools/lang/nix_shell.bzl` (or existing shared Node wiring helper)
- **Enforcement script**: `build-tools/tools/buck/enforce-node-patch-requirements.ts`
- **Requirement closure helpers**: `build-tools/tools/lib/node-patch-requirements.ts`
- **Install warning path (reference only)**: `build-tools/tools/dev/install/deps-main.ts`

### Tests (in this PR)

- [ ] Add static wiring tests that verify enforcement is present in:
  - [ ] `build-tools/node/defs_core.bzl`.
  - [ ] `build-tools/node/defs_nix.bzl`.
  - [ ] `build-tools/node/defs_stage.bzl`.
- [ ] Add execution-path tests that verify:
  - [ ] missing required transitive patch requirements fail in normal Node build paths.
  - [ ] missing optional transitive patch requirements warn and remain non-fatal.
  - [ ] unaffected importers remain unaffected.
- [ ] Add deterministic diagnostics tests that verify failure or warning output includes:
  - [ ] `patch-pkg sync-required node --importer <importer>`.
- [ ] Use these concrete test file targets:
  - [ ] extend `build-tools/tools/tests/patching/patch-node.sync-required.test.ts`.
  - [ ] extend `build-tools/tools/tests/dev/build-selected.node-patch-requirements.preflight.test.ts`.
  - [ ] add Node macro-entrypoint wiring coverage under `build-tools/tools/tests/node/` for `defs_nix.bzl` and `defs_stage.bzl` paths.

### Docs (in this PR)

- [ ] Update `docs/handbook/patching.md` with an explicit statement that required transitive Node patch checks run in normal Node build entry paths, in addition to install-time checks.
- [ ] Update `docs/handbook/node-macros.md` with Node macro preflight enforcement behavior and failure or warn policy.

### Acceptance Criteria

- [ ] All normal Node build entrypoints listed in this PR run transitive patch requirement preflight.
- [ ] Missing required transitive Node patch requirements fail with importer-specific diagnostics.
- [ ] Missing optional transitive Node patch requirements warn and do not fail.
- [ ] `i` remains read-only warning flow and does not mutate patch files by default.
- [ ] Diagnostics include exact remediation command: `patch-pkg sync-required node --importer <importer>`.
- [ ] Existing importer-local patch ownership and semantics remain unchanged.
- [ ] Test coverage in the listed files verifies both required-fail and optional-warn policy for normal Node build paths.

### Risks

Enforcement expansion can surface previously hidden missing patch requirements in existing Node
importers.

### Mitigation

Keep diagnostics deterministic and actionable, preserve optional-as-warn policy, and provide direct
remediation with `patch-pkg sync-required`.

### Consequence of Not Implementing

Some normal Node build paths can still bypass required transitive patch enforcement and allow
silent misses.

### Downsides for Implementing

Additional wiring and test maintenance for build-entrypoint preflight behavior.

### Recommendation

Implement.
