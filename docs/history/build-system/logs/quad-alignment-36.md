# Quad Alignment Plan — Close Remaining Abstraction Gaps (CPP / Go / PNPM / Python) — Part 36

This installment follows Part 35.

Part 35 tightened the shared contract surface and reduced drift in TS, Nix, and Starlark.
After reviewing the current repo state, I still see two remaining “macro authoring risk” gaps that require too much context during debugging and review:

- Importer-scoped macros that also call Nix still have a common “two step” pattern in Starlark. One helper wires importer-scoped behavior, then the call site wires global Nix inputs. This is correct, but it is easy to forget or to do inconsistently.
- Package-local planner-visible stubs are mostly migrated to non-mutating v2 wiring helpers, but there is still at least one mutating call site in Go.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Add a shared v2 helper for importer-scoped, non-genrule Nix-calling macros and migrate Node `nix_node_test`

### Description

Today, importer-scoped non-genrule macros use `prepare_importer_non_genrule_wiring_v2(...)` and then separately call `wire_global_nix_inputs(...)` at the call site when the macro shells out to Nix at runtime.

This is correct, but it is a drift surface. New macros can forget to attach `global_nix_inputs()` as real action inputs, or can attach them to the wrong attribute.

This PR introduces one shared helper that composes:

- importer-scoped lockfile enforcement and importer derivation
- language and kind stamping
- importer-local patch action inputs
- provider edge realization
- global Nix inputs as real action inputs (and optional label stamping)

Then it migrates Node `nix_node_test` to use the single composed helper, so the pattern is fully table-driven and harder to misuse.

### Scope & Changes

- Add a new helper in `//build-tools/lang` (final naming is an implementation detail), for example:
  - `build-tools/lang/importer_wiring_v2.bzl:prepare_importer_non_genrule_nix_calling_wiring_v2(...)`
- Helper requirements:
  - must be non-mutating at the public boundary, like other v2 helpers
  - must accept:
    - `global_inputs_into` (default `srcs`)
    - `global_inputs_stamp` (default `False`, call sites opt into stamping)
    - `patch_into` and `patch_base` (forwarded to importer wiring)
    - `provider_into` and `provider_base` (forwarded to importer wiring)
  - must return a struct that contains:
    - `importer`
    - `kwargs` (prepared kwargs for the rule call, including patch inputs and global inputs)
    - `deps` (when provider edges are realized into deps)
- Migrate `build-tools/node/defs_core.bzl:nix_node_test`:
  - remove the call site `wire_global_nix_inputs(...)` call
  - rely on the new composed helper so global inputs are attached exactly once
  - preserve the existing “do not stamp global inputs” behavior for `nix_node_test` unless the contract explicitly changes
- Cleanup and standardization:
  - remove redundant local variables in `nix_node_test` that become unnecessary after migration (for example `merged_srcs`)
  - ensure “labels merge point” remains single-source (avoid merging labels in multiple places in the macro)

Non-goals in this PR:

- No change to lockfile label format.
- No change to importer support (`.`, `projects/apps/*`, `projects/libs/*`).
- No change to patch inclusion policies (Node importer-local is still invalidated by macro-attached patch inputs).

### Tests (in this PR)

- Add a cquery-based probe test for `nix_node_test` that asserts:
  - importer-local patches are present as real action inputs
  - global Nix inputs are present as real action inputs
  - patch scope stamping and `lang:*` and `kind:*` stamping remain present and stable
- Add an enforcement test that fails if `build-tools/node/defs_core.bzl` contains `wire_global_nix_inputs(` inside `nix_node_test`.
  - This asserts the intended abstraction boundary, not the exact helper name.

### Docs (in this PR)

- Update `build-tools/docs/abstractions.md`:
  - add a short note that importer-scoped non-genrule macros that call Nix must use the composed helper
  - call out `nix_node_test` as the canonical example
- Update `docs/handbook/node-tests.md` (or the nearest applicable handbook page):
  - document the rule: global Nix inputs must be attached as action inputs, not only as labels

### Acceptance Criteria

- Node `nix_node_test` uses a single composed helper and no longer has a call-site `wire_global_nix_inputs(...)`.
- A cquery-based test proves `global_nix_inputs()` are present as action inputs for `nix_node_test`.
- A new macro author cannot implement “importer-scoped + calls Nix” without tripping tests if they forget global inputs.

### Risks

Moderate. This touches shared helper surfaces used by macros. The primary risk is:

- attaching global inputs to the wrong attribute for some rule shapes

Mitigation:

- keep scope narrow to non-genrule wiring
- migrate only `nix_node_test` in this PR
- cover with cquery-based action input tests

### Consequence of Not Implementing

“Importer-scoped + calls Nix” remains a recurring source of missing invalidation inputs and inconsistent stamping behavior.

### Downsides for Implementing

Some churn in shared Starlark helper code and one macro migration.

### Recommendation

Implement.

---

## PR‑2: Finish v2 migration for package-local planner-visible stubs in Go and remove the remaining mutating call site

### Description

Package-local wiring helpers have v2 (non-mutating) variants. Planner-visible stubs also have a v2 helper.

In Go, `nix_go_carchive` still uses the mutating helper `wire_package_local_planner_visible_stub(...)`.
This is correct but keeps the “mutation ordering” risk alive and makes it easier for new call sites to copy the mutating pattern.

This PR migrates the remaining Go call site to the v2 helper and standardizes call-site conventions.

### Scope & Changes

- Migrate `build-tools/go/defs.bzl:nix_go_carchive` to use `wire_package_local_planner_visible_stub_v2(...)`.
  - preserve behavior:
    - provider edge realization mode remains `inputs`
    - patch inputs remain attached as real action inputs for the planner-visible stub
    - labels remain stamped with the same `lang:*`, `kind:*`, and `patch_scope:*` vocabulary
- Cleanup and standardization in Go macros:
  - remove unused locals that are popped but not used (only when safe and proven by tests)
  - keep one consistent place where labels are assembled (avoid merging labels in multiple places)
  - keep one consistent place where deps are assembled (base deps + provider edges) using shared helpers

Non-goals in this PR:

- No change to the C archive planner template behavior.
- No change to “provider edges realized into inputs” policy for this macro.

### Tests (in this PR)

- Add an enforcement test that fails if `build-tools/go/defs.bzl` contains `wire_package_local_planner_visible_stub(`.
  - This is narrow and intended to prevent new mutating call sites from being introduced in Go.
- Add a probe test that exercises `nix_go_carchive` and asserts:
  - patch_scope is `package-local`
  - provider edges are realized into the intended attribute
  - the stub remains planner-visible and carries package-local patch inputs as action inputs

### Docs (in this PR)

- Update `docs/handbook/adding-language.md`:
  - explicitly state: new package-local planner-visible stubs must use the v2 helper
  - point to `nix_go_carchive` as the canonical example for “provider edges realized into inputs”
- Update `build-tools/docs/abstractions.md`:
  - note that package-local planner-visible stubs should be v2-only at call sites

### Acceptance Criteria

- No Starlark macro in Go uses `wire_package_local_planner_visible_stub(...)`.
- `nix_go_carchive` remains planner-visible and its invalidation behavior remains correct.
- Enforcement and probe tests prevent regressions.

### Risks

Low. This is a mechanical migration to a v2 wrapper. The primary risk is changing label or input ordering in a way that affects invalidation.

Mitigation:

- probe test that asserts action inputs and labels

### Consequence of Not Implementing

The mutating helper stays “copy-pasteable”, and we keep a long tail risk that new macro shapes depend on mutation ordering.

### Downsides for Implementing

Minor churn in one macro and one enforcement test.

### Recommendation

Implement.

---

## PR‑3: Tighten enforcement and conventions for cross-language macro authoring (focused, outcome-based)

### Description

After Part 35 and the migrations above, the remaining drift risk is that new macro shapes bypass the shared helper surfaces:

- importer-scoped macros re-introduce ad-hoc lockfile parsing, patch wiring, or provider edge realization
- Nix-calling macros forget global Nix action inputs
- call sites merge labels and deps in inconsistent places and create small differences across languages

This PR strengthens enforcement and standardizes conventions across Starlark macro files, but keeps assertions outcome-based to avoid brittle tests.

### Scope & Changes

- Add or extend enforcement tests to fail when:
  - importer-scoped macros directly load `//build-tools/lang:lockfile_labels.bzl` (instead of using importer wiring helpers)
  - importer-scoped Nix-calling genrule macros bypass `prepare_importer_nix_calling_genrule_wiring_v2(...)`
  - importer-scoped non-genrule Nix-calling macros bypass the new composed helper introduced in PR‑1
  - dict-safe synthetic key prefixes are hardcoded instead of using the canonical constants
- Add targeted call-site cleanups where enforcement reveals redundancy:
  - remove local helper wrappers that simply re-export a shared helper without adding value
  - standardize “single labels merge point” in each macro (one place to assemble labels, one place to pass them)
  - standardize “single deps merge point” in each macro (base deps, then provider realization)

Non-goals in this PR:

- No new contract vocabulary.
- No behavior changes in provider sync or exporter.

### Tests (in this PR)

- One enforcement test per bypass category above.
- At least one cquery-based assertion for a representative macro in each patch scope:
  - importer-local: one Node macro and one Python macro
  - package-local: one Go macro and one C++ macro

### Docs (in this PR)

- Update `docs/handbook/adding-language.md`:
  - add a short checklist for macro authors:
    - which helper surface to use for each macro shape
    - which enforcement tests will fail if you bypass them
- Update `docs/handbook/conventions.md` (or the most relevant handbook page):
  - standardize the “labels merge point” and “deps merge point” conventions across macros

### Acceptance Criteria

- New macro shapes cannot bypass the shared helper surfaces without tripping enforcement tests.
- Representative cquery tests confirm action-input level invariants for invalidation across languages.
- Macro call-site conventions are consistent across `build-tools/go/defs.bzl`, `build-tools/cpp/defs.bzl`, `build-tools/node/defs_*.bzl`, and `build-tools/python/defs.bzl`.

### Risks

Moderate. Enforcement tests can become brittle if they assert exact code shapes.

Mitigation:

- prefer outcome-based cquery tests for action input invariants
- keep code-shape enforcement narrow and targeted to obvious bypass patterns

### Consequence of Not Implementing

The repo stays correct today, but drift risk reappears as new languages and macro shapes are added.

### Downsides for Implementing

Some test churn and minor macro call-site cleanup.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and to keep each PR revertible:

1. PR‑1 first. It introduces a new shared helper and migrates one Node call site.
2. PR‑2 next. It removes the remaining mutating package-local planner-visible stub call site in Go.
3. PR‑3 last. It strengthens enforcement after the migrations are complete.

---

## Verification & Backout Strategy

Each PR includes:

- at least one focused probe or cquery-based test that asserts the contract outcome
- a documentation update that points authors at the canonical helper surface and uses the same vocabulary (`patch_scope:*`, `lockfile:*`, `nixpkg:*`, `lang:*`, `kind:*`)

Backout strategy:

- PR‑1 can be reverted independently by restoring the prior `nix_node_test` wiring and removing the composed helper.
- PR‑2 can be reverted independently by switching `nix_go_carchive` back to the mutating helper (not recommended long term).
- PR‑3 can be reverted independently if enforcement proves too strict, then re-land with narrower, outcome-based assertions.
