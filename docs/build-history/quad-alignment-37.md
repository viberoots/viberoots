# Quad Alignment Plan — Close Remaining Abstraction Gaps (CPP / Go / PNPM / Python) — Part 37

This installment follows Part 36.

Part 36 proposed two macro-authoring risk fixes. After checking the current repo state, those two items are already implemented:

- Importer-scoped, non-genrule Nix-calling macros now have a single composed helper. Node `nix_node_test` is migrated to `prepare_importer_non_genrule_nix_calling_wiring_v2(...)`.
- The remaining Go package-local planner-visible stub call site is already migrated. `build-tools/go/defs.bzl:nix_go_carchive` uses `wire_package_local_planner_visible_stub_v2(...)`.

After reviewing the current repo state, I still see a small set of remaining gaps that are easy to trip during macro authoring and review:

- Package-local WASM planner-visible stubs still use a mutating helper path (`build-tools/lang/wasm_package_local_wiring.bzl` delegates to `wire_package_local_planner_visible_stub(...)`). This keeps the “mutation ordering” risk alive in the WASM surface area.
- We still have multiple helper entrypoints that are all “valid”, but not equally safe. v1 helpers remain easy to copy-paste, which makes drift likely as new macros are added.
- Starlark call-site conventions are mostly consistent, but there are still small differences in where labels and deps are assembled across languages. This is not a correctness issue, but it increases review/debug burden.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Add a v2 helper for package-local WASM planner-visible stubs and migrate C++ `nix_cpp_wasm_emscripten_lib`

### Description

We already have a v2 (non-mutating) helper for package-local planner-visible stubs (`wire_package_local_planner_visible_stub_v2(...)`), and most call sites use it.

The package-local WASM planner-visible stub wrapper still routes through the mutating v1 helper (`build-tools/lang/wasm_package_local_wiring.bzl:wire_package_local_wasm_planner_visible_stub(...)`).
This is correct today, but it keeps the “mutation ordering” risk alive and makes it easier for new WASM macro shapes to copy the mutating pattern.

This PR introduces a v2 wrapper for WASM planner-visible stubs and migrates the C++ Emscripten stub macro to use it.

### Scope & Changes

- Add a non-mutating v2 wrapper in `//build-tools/lang` for package-local WASM planner-visible stubs, for example:
  - `build-tools/lang/wasm_package_local_wiring.bzl:wire_package_local_wasm_planner_visible_stub_v2(...)`
- Helper requirements:
  - must perform wasm stamping before delegating to the package-local stub helper
  - must be non-mutating at the public boundary (like other v2 helpers)
  - must delegate to `wire_package_local_planner_visible_stub_v2(...)` internally
  - must preserve existing behavior knobs:
    - `provider_realization_mode`
    - `strip_providers_from_deps`
- Migrate `build-tools/cpp/defs.bzl:nix_cpp_wasm_emscripten_lib`:
  - use the new v2 WASM stub helper
  - preserve behavior (labels and provider handling), including the existing choice:
    - provider targets remain in deps (`strip_providers_from_deps = False`)
    - provider realization mode remains `deps`
- Cleanup:
  - keep a single “labels merge point” for the macro (avoid assembling labels twice through kwargs + extra label appends)

Non-goals in this PR:

- No changes to patch invalidation model or patch scope vocabulary.
- No changes to how provider edges are computed or mapped.

### Tests (in this PR)

- Add a probe/cquery-based test that exercises `nix_cpp_wasm_emscripten_lib` and asserts:
  - wasm labels are present (`kind:wasm`, `wasm:emscripten`, plus `lang:cpp`)
  - `patch_scope:package-local` is present
  - package-local patch files are present as real action inputs for the stub
  - provider edge realization behavior remains unchanged for this stub (provider targets present in deps when configured)
- Add an enforcement test that fails if `build-tools/lang/wasm_package_local_wiring.bzl` contains `wire_package_local_planner_visible_stub(`.
  - This prevents introducing new mutating call sites via the WASM wrapper.

### Docs (in this PR)

- Update `docs/handbook/adding-language.md`:
  - explicitly state: package-local WASM planner-visible stubs must use the v2 WASM wrapper
  - point to `nix_cpp_wasm_emscripten_lib` as the canonical example
- Update `abstractions.md`:
  - note that `wire_package_local_wasm_planner_visible_stub(...)` is legacy-only and should not appear in new macro code

### Acceptance Criteria

- `build-tools/lang/wasm_package_local_wiring.bzl` provides a v2 helper and does not call the mutating package-local stub helper.
- `build-tools/cpp/defs.bzl:nix_cpp_wasm_emscripten_lib` uses the v2 WASM stub helper.
- Tests prove the stub still carries the correct action inputs and labels.

### Risks

Low. This is a mechanical re-plumbing of helper composition. The main risk is reordering stamping vs patch input inclusion in a way that affects the exported graph or invalidation.

Mitigation:

- cquery-based tests asserting action inputs and labels.

### Consequence of Not Implementing

WASM macro authoring remains the main path where the mutating helper is still “copy-pasteable”.

### Downsides for Implementing

Minor churn in one shared helper file and one macro call site.

### Recommendation

Implement.

---

## PR‑2: Make v2 wiring the macro-authoring default and reduce v1 helper “surface area”

### Description

The repo has both v1 (mutating) and v2 (non-mutating) helper surfaces. v2 is safer for macro authoring because call-site ordering mistakes cannot “work by accident” due to helper-side mutation.

Today, v1 helpers still exist and remain easy to copy into new macros. That is a long-term drift risk.

This PR tightens conventions so new macros use v2 helpers by default, while keeping v1 available only as compatibility for legacy call sites that have not migrated yet.

### Scope & Changes

- Standardize “v2-first” guidance at the shared re-export boundary:
  - adjust `build-tools/lang/defs_common.bzl` docstrings and exported symbols so v2 helpers are the ones referenced in examples
  - keep v1 helpers exported for compatibility, but treat them as legacy-only in the macro authoring guidance
- Add enforcement that prevents new v1 usage in macro files:
  - package-local macros must use `prepare_package_local_wiring_v2(...)`
  - importer-scoped macros must use v2 helpers (`prepare_importer_*_v2(...)`)
  - planner-visible stubs must use v2 helpers (`wire_*_planner_visible_stub_v2(...)`), including the WASM wrapper after PR‑1
- Where enforcement flags remaining call sites, migrate them in this PR, scoped to:
  - `build-tools/go/defs.bzl`
  - `build-tools/cpp/defs.bzl`
  - `build-tools/node/defs_core.bzl`
  - `build-tools/node/defs_nix.bzl`
  - `build-tools/python/defs.bzl`

Non-goals in this PR:

- No deletion of v1 helpers (keep them as migration escape hatches).
- No behavior changes in provider sync, exporter, or Nix templates.

### Tests (in this PR)

- Add or extend enforcement tests that fail when:
  - macro files call v1 wiring helpers directly (limited to a curated “macro file allowlist” so the test stays focused)
  - new call sites use `pop_*` macro-kwargs helpers directly instead of the shared v2 wiring helpers (same allowlist)
- Keep at least one representative cquery-based probe per patch model:
  - package-local: one Go macro and one C++ macro still show package-local patch inputs as action inputs
  - importer-local: one Node macro and one Python macro still show importer-local patches and provider edges as action inputs

### Docs (in this PR)

- Update `docs/handbook/adding-language.md`:
  - clarify that v2 helpers are the default for new macros
  - list the v1 helpers as “legacy” with a short “when it is acceptable” note (rare, rule-shape constraints)
- Update `abstractions.md`:
  - add a short “v1 vs v2” note in the wiring contracts section

### Acceptance Criteria

- New macro shapes cannot introduce v1 wiring call sites without failing tests.
- All core macro entrypoints (Go/C++, Node/Python) continue to pass their existing probe tests for action inputs and labels.

### Risks

Moderate. Enforcement can be brittle if it asserts exact code shapes.

Mitigation:

- Keep enforcement scoped to a small allowlist of known macro files.
- Prefer cquery-based outcome tests for the invariants that matter.

### Consequence of Not Implementing

The repo stays correct today, but drift risk reappears when new macros are added and v1 patterns are copied.

### Downsides for Implementing

Some test churn and small macro cleanups to satisfy enforcement.

### Recommendation

Implement.

---

## PR‑3: Rename “v2” helpers to remove versioning (treat current v2 as the only surface)

### Description

We have no external users of these helper APIs yet, so we can treat “v2” as the only supported surface.

Keeping `_v2` in symbol names is now a form of internal debt:

- it encourages new code to cargo-cult “versioned helpers” instead of treating the shared helper surface as stable
- it makes documentation and call sites noisier
- it preserves the idea that “v1 is still a normal option”, even when enforcement is trying to make it legacy-only

This PR renames the current non-mutating “v2” helpers to become the canonical, versionless names. The prior mutating helpers become explicitly legacy-named (or are removed when they are no longer used internally).

### Scope & Changes

- Starlark:
  - rename `prepare_package_local_wiring_v2` → `prepare_package_local_wiring`
  - rename `wire_package_local_planner_visible_stub_v2` → `wire_package_local_planner_visible_stub`
  - rename importer wiring helpers:
    - `prepare_importer_genrule_kwargs_v2` → `prepare_importer_genrule_kwargs`
    - `prepare_importer_non_genrule_wiring_v2` → `prepare_importer_non_genrule_wiring`
    - `prepare_importer_srcsless_rule_wiring_v2` → `prepare_importer_srcsless_rule_wiring`
    - `prepare_importer_nix_calling_genrule_wiring_v2` → `prepare_importer_nix_calling_genrule_wiring`
    - `prepare_importer_non_genrule_nix_calling_wiring_v2` → `prepare_importer_non_genrule_nix_calling_wiring`
  - rename any v2-only probe helpers similarly (where they exist) so test names mirror the new surface
  - move the old mutating helpers under explicit legacy names:
    - for example `prepare_package_local_wiring_legacy_mutating`, `wire_package_local_planner_visible_stub_legacy_mutating`
    - do the same for importer wiring v1 helpers
  - update `build-tools/lang/defs_common.bzl` re-exports so:
    - versionless names refer to the non-mutating implementations
    - legacy names are still available for internal migration work only
- Update macro call sites across:
  - `build-tools/go/defs.bzl`
  - `build-tools/cpp/defs.bzl`
  - `build-tools/node/defs_core.bzl`
  - `build-tools/node/defs_nix.bzl`
  - `build-tools/python/defs.bzl`
  - and any other Starlark call site using the renamed helpers
- Update enforcement tests and docs to reference the new versionless names.

Non-goals in this PR:

- No behavior change. This is a naming and call-site migration only.
- No change to patch models, labels, provider mapping, or Nix invocation semantics.

### Tests (in this PR)

- Update existing enforcement tests to:
  - fail if macro files reference any `_v2` helper symbol names (since versioning is removed)
  - fail if macro files call legacy-mutating helpers
- Keep the existing cquery/probe tests unchanged in intent:
  - they should keep validating action inputs and stamping outcomes, not exact helper names

### Docs (in this PR)

- Update `abstractions.md` and `docs/handbook/adding-language.md` to:
  - treat the versionless helpers as canonical
  - list legacy helper names only as migration escape hatches (expected to trend to zero)

### Acceptance Criteria

- No Starlark call sites (including shared `//build-tools/lang` helpers) reference `_v2` helper names.
- Versionless helper names refer to the non-mutating implementations everywhere.
- Tests continue to assert the same action-input and label invariants.

### Risks

Moderate. This is a broad rename across Starlark and tests. The main risk is missing a call site and producing confusing load errors.

Mitigation:

- Make the rename mechanical and keep the PR focused to naming changes.
- Keep outcome-based cquery/probe tests in place to ensure behavior did not drift.

### Consequence of Not Implementing

Versioned names continue to add noise and encourage drift as new helpers are introduced.

### Downsides for Implementing

A large but mechanical rename across Starlark call sites, tests, and docs.

### Recommendation

Implement.

---

## PR‑4: Centralize supported importer roots as a single contract artifact (reduce TS↔Starlark drift risk)

### Description

Importer support rules currently exist in both TypeScript (`build-tools/tools/lib/importers.ts`) and Starlark (`build-tools/lang/lockfile_labels.bzl`). Parity tests reduce risk, but the update workflow is still “touch two implementations”.

This PR creates a single source of truth for supported importer roots and generates (or consumes) it in both layers so adding a new importer root is a single change.

### Scope & Changes

- Introduce a single contract artifact that defines supported importer labels, for example:
  - `build-tools/tools/lib/importer-roots.json` (data-only)
- Update TypeScript importer support logic to consume the artifact (instead of hardcoding the regex).
- Generate a small Starlark file from the artifact (for example `build-tools/lang/importer_roots.bzl`) and make `build-tools/lang/lockfile_labels.bzl` validate against that generated list.
  - Generation should be deterministic and invoked through the existing dev tooling flow (glue / install), not a new bespoke pipeline.
- Keep parity tests, but shift their goal:
  - from “two hardcoded implementations match”
  - to “the generated Starlark view and TS view match the same artifact”

Non-goals in this PR:

- No change to label format (`lockfile:<path>#<importer>`).
- No change to current supported importers (`.`, `projects/apps/*`, `projects/libs/*`) unless explicitly decided.

### Tests (in this PR)

- Extend the existing importer-support parity test to assert both layers read the same values.
- Add an enforcement test that fails if:
  - `build-tools/tools/lib/importers.ts` contains a hardcoded importer regex (must use the artifact)
  - `build-tools/lang/lockfile_labels.bzl` contains a hardcoded list/regex for importer roots (must use the generated file)

### Docs (in this PR)

- Update `docs/handbook/patching.md` and `docs/handbook/adding-language.md`:
  - when adding a new importer root, update the artifact (single place) and run glue generation
  - call out that Starlark importers are generated from the same source

### Acceptance Criteria

- Importer roots are defined in exactly one place.
- Both TS and Starlark enforce the same importer support policy without duplicated hardcoding.
- Existing importer-scoped behavior remains unchanged.

### Risks

Moderate. This introduces a generated Starlark source file, which must be kept deterministic and wired into the existing generation flow.

Mitigation:

- Keep the generated file small and stable.
- Ensure `prebuild-guard` (or equivalent) catches missing/stale generation early.

### Consequence of Not Implementing

Adding importer roots remains “touch two implementations”, which is a recurring drift risk.

### Downsides for Implementing

Some plumbing to generate the Starlark view from the shared artifact.

### Recommendation

Implement.

---

## PR‑5: Standardize Starlark macro call-site conventions across languages (labels/deps merge points)

### Description

The macros across Go/C++, Node, and Python are mostly consistent. However, small differences in where labels and deps are assembled still increase review/debug burden.

This PR standardizes call-site conventions across the macro entrypoints so authors do not need per-language context to answer:

- “Where do labels get merged?”
- “Where do provider edges get realized?”
- “Where do patches/global inputs get attached as action inputs?”

The intent is to standardize the _shape_ of macro code, not to introduce new contracts.

### Scope & Changes

- Define and apply two conventions to each macro file:
  - **Single labels merge point**: one place where labels are assembled (user labels + macro labels + optional extra labels) before calling shared helpers.
  - **Single deps merge point**: one place where base deps are assembled before passing to wiring helpers, and provider realization happens only through shared helpers.
- Apply minimal cleanups to align with these conventions:
  - remove redundant local variables that are no longer needed after helper composition
  - avoid re-merging labels after wiring unless explicitly justified (example: truly post-wiring derived metadata labels)
- Apply across:
  - `build-tools/go/defs.bzl`
  - `build-tools/cpp/defs.bzl`
  - `build-tools/node/defs_core.bzl`
  - `build-tools/node/defs_nix.bzl`
  - `build-tools/python/defs.bzl`

Non-goals in this PR:

- No semantic changes to stamping vocabulary or provider mapping.
- No changes to build behavior beyond formatting and where code is assembled.

### Tests (in this PR)

- Add one enforcement test that checks, per macro file, a small set of “must-use shared helpers” rules stays true.
  - Keep this outcome-based where possible, and code-shape-based only for high-signal patterns that are easy to misuse.
- Add a small matrix of cquery-based checks that confirm no macro lost:
  - patch_scope stamping
  - provider edges (where applicable)
  - patch inputs as real action inputs
  - global inputs as real action inputs for Nix-calling macros

### Docs (in this PR)

- Update `docs/handbook/conventions.md`:
  - document the two conventions (labels merge point, deps merge point)
  - include one short before/after example for a macro
- Update `docs/handbook/adding-language.md`:
  - reference the conventions as part of the macro author checklist

### Acceptance Criteria

- Macro files follow consistent conventions for label and dep assembly.
- Tests prevent regressions in the action-input level invariants.

### Risks

Moderate. Refactors can unintentionally change ordering or dedupe behavior.

Mitigation:

- Keep diffs small and mechanical.
- Use cquery-based tests to assert the invariants.

### Consequence of Not Implementing

Macro authoring remains correct but continues to require extra per-language context during review and debugging.

### Downsides for Implementing

Some churn across macro files, even though behavior should not change.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and to keep each PR revertible:

1. PR‑1 first. It removes the remaining mutating helper use from the WASM planner-visible stub surface and migrates one concrete call site.
2. PR‑2 next. It standardizes v2 as the macro-authoring default and adds enforcement to prevent regressions.
3. PR‑3 next. It removes versioning from helper names by renaming the current v2 surfaces to be the only surfaces.
4. PR‑4 next. It reduces the TS↔Starlark drift surface for importer roots by moving to a single contract artifact.
5. PR‑5 last. It standardizes macro call-site conventions across languages, after the helper surfaces and naming are stable.

---

## Verification & Backout Strategy

Each PR includes:

- at least one focused probe or cquery-based test that asserts action-input level invariants
- a documentation update that points authors at the canonical helper surface and uses the same vocabulary (`patch_scope:*`, `lockfile:*`, `nixpkg:*`, `lang:*`, `kind:*`)

Backout strategy:

- PR‑1 can be reverted independently by restoring the prior WASM stub wiring path.
- PR‑2 can be reverted independently by relaxing the enforcement tests (while keeping the v2 migrations that already landed).
- PR‑3 can be reverted independently by restoring the prior helper naming (not recommended long-term).
- PR‑4 can be reverted independently by keeping the artifact but falling back to the current dual-implementation approach.
- PR‑5 can be reverted independently by reverting the macro call-site refactors without impacting shared helper behavior.
