# Node Library Patching Plan

This plan adds importer-safe patch requirement enforcement for Node local-library dependencies.

The design keeps importer-local patch ownership and prevents silent misses with automatic checks.

This is a single PR that includes code, tests, and docs.

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
