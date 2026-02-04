# Quad Alignment Plan — Cross-Language Seam Tightening (CPP / Go / PNPM / Python) — Part 34

This installment follows Part 33. Part 33 tightened several important seams:

- Provider index output now includes patch model metadata (`patch_scope` and where patch inputs are expected).
- Prebuild guard and patch tooling now print patch invalidation one-liners using the contract vocabulary.
- Importer-scoped exporter behavior is configured via a shared registry (`build-tools/tools/buck/exporter/lang/importer-scoped-registry.ts`).

In Part 34 I focus on the remaining gap that still requires too much cross-language context during macro authoring and debugging:

- Shared Starlark wiring helpers are correct, but they are still mutation-heavy. They pop and mutate `kwargs`.
- That mutation leaks into call sites. Call sites sometimes need to pre-capture arguments before wiring runs.
- This increases the chance of drift and makes new macro shapes harder to implement safely.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Introduce functional (non-mutating) wiring helpers for package-local macros and migrate Go

### Description

Today, most shared Starlark wiring helpers mutate `kwargs` and pop keys. This is a correct implementation strategy, but it leaks into macro call sites. A macro must know which keys will be consumed or rewritten, and in which order, to correctly synthesize helper targets or to preserve macro inputs for later steps.

This PR adds a parallel “functional” helper surface that returns a prepared kwargs dict and derived values without mutating the caller’s dict. It then migrates Go macros first to validate the approach on a package-local language that exercises:

- package-local patch inputs
- provider-edge wiring
- nixpkgs label stamping (CGO)
- auto-wired helper targets

### Scope & Changes

- Add new shared helpers under `//lang:` for package-local wiring that do not mutate call-site dicts.
  - Example shape (final naming up to implementation details):
    - `prepare_package_local_wiring_v2(...) -> struct(kwargs, deps, local_patch_dirs, nixpkg_deps)`
  - The helper should:
    - compute `local_patch_dirs` and `nixpkg_deps` from inputs
    - stamp labels (including `patch_scope`) into the returned kwargs
    - attach package-local patch inputs into returned kwargs
    - return provider edges as a separate list or as a merged `deps` list (explicit)
- Migrate `build-tools/go/defs.bzl` to the new helper surface.
  - Remove call-site pre-capture patterns that exist only because helpers mutate kwargs.
  - Ensure auto-wired Go helper targets continue to receive the intended macro inputs.
- Cleanup and consistent conventions across Starlark call sites (Go):
  - Avoid reading and then later mutating `kwargs["labels"]` in multiple places.
  - Avoid `kwargs.get(...)` reads that depend on earlier helper mutation.

Non-goals in this PR:

- No change to patch directory layout (`<pkg>/patches/go`).
- No change to Go tuple label semantics or exporter batching behavior.

### Tests (in this PR)

- Add a focused regression test that proves Go auto-wired helper targets preserve the intended inputs after migration.
  - Verify at least:
    - patch inputs are present as action inputs
    - `patch_scope:package-local` label is present
    - provider edges remain deterministic
- Add a probe-style test that asserts the new helper does not mutate a passed-in dict (via a small Starlark probe rule that prints pre/post keys).

### Docs (in this PR)

- Update `abstractions.md`:
  - document the new “functional wiring helper” surface as preferred for new macros
  - call out the policy: macros should not depend on helper-side mutation ordering
- Update `build-tools/docs/build-system-design.md`:
  - update the “scope” framing to reflect current cross-language parity and the two patch models
  - point to `abstractions.md` as the canonical contract index

### Acceptance Criteria

- Go macros no longer rely on helper-side mutation ordering.
- The new helper surface exists, is documented, and is covered by a targeted test.
- Go behavior remains stable, validated by the tests in this PR.

### Risks

Moderate. Changing macro wiring can change action input sets, label sets, and dependency order. Tests must lock down the intended invariants.

### Consequence of Not Implementing

Mutation leaks remain. New macro shapes will keep re-learning ordering constraints and will continue to add “pre-capture” patterns that are easy to drift.

### Downsides for Implementing

Some churn in `build-tools/go/defs.bzl` and the shared wiring helpers, plus one new test surface.

### Recommendation

Implement.

---

## PR‑2: Introduce functional (non-mutating) wiring helpers for importer-scoped macros and migrate Python

### Description

Importer-scoped wiring has additional complexity compared to package-local wiring:

- lockfile label enforcement and importer derivation
- list-shaped vs dict-shaped action inputs (`srcs` maps)
- srcs-less rule shapes (Python binary) that require synthetic deps

This PR adds a parallel “functional” importer-scoped wiring surface that returns prepared kwargs and derived values without mutating caller dicts. It then migrates Python first because it exercises both non-genrule and srcs-less shapes, and it is sensitive to patch input attachment locations (`resources` vs `srcs`).

### Scope & Changes

- Add new importer-scoped functional helpers under `//lang:` that return prepared values without mutating input dicts.
  - Cover at least:
    - non-genrule wiring (returns `{ importer, kwargs, deps }`)
    - srcs-less wiring (returns `{ importer, kwargs, patch_dep, merge_deps }`)
  - Preserve dict-safe attachment behavior and key prefix contracts.
- Migrate `build-tools/python/defs.bzl` to the new helper surface.
- Cleanup and consistent conventions across Starlark call sites (Python):
  - Standardize how `labels` are merged at the start of macro execution (single merge point).
  - Ensure srcs-less path does not accidentally accept or create `srcs`.

Non-goals in this PR:

- No change to importer lockfile label format.
- No change to patch inclusion policy (Python remains “effective set only” for importer-local patch selection).

### Tests (in this PR)

- Extend or add a cquery-based test that asserts:
  - Python importer-local patches are present as real action inputs for both `python_library` and `python_binary` macro shapes
  - `patch_scope:importer-local` is present
- Add a probe-style test that asserts the new helper does not mutate a passed-in dict.

### Docs (in this PR)

- Update `abstractions.md`:
  - document the importer-scoped functional wiring helpers
  - include explicit guidance for srcs-less rule shapes
- Update the relevant handbook pages under `docs/handbook/` that describe Python macros to reference the new helper surface.

### Acceptance Criteria

- Python macros no longer rely on helper-side mutation ordering.
- Importer derivation, patch input attachment, and provider wiring remain correct and are covered by tests.

### Risks

Moderate. Importer-scoped wiring is easy to regress for dict-shaped inputs and srcs-less shapes. Tests must cover both.

### Consequence of Not Implementing

Importer-scoped macro authoring remains higher-risk than necessary. New importer-scoped languages will likely copy mutation-heavy patterns and drift.

### Downsides for Implementing

Some churn in shared wiring and `build-tools/python/defs.bzl`, plus additional probe coverage.

### Recommendation

Implement.

---

## PR‑3: Migrate Node macros to functional importer-scoped wiring and remove remaining call-site special-casing

### Description

Node macros include several shapes:

- importer-scoped genrules (`nix_node_gen`)
- Nix-calling genrules (`node_webapp`, bundled `nix_node_cli_bin`)
- external runner test (`nix_node_test`)

They already use shared helpers, but they still have call-site special-casing and small helper wrappers that exist mainly to compensate for mutating wiring and dict-shaped inputs.

This PR migrates Node macros to the functional importer-scoped wiring helpers introduced in PR‑2 and removes call-site mutation workarounds.

### Scope & Changes

- Update `build-tools/node/defs_core.bzl` to use the functional importer-scoped wiring helper for:
  - `nix_node_gen`
  - `nix_node_test`
- Update `build-tools/node/defs_nix.bzl` to use the functional Nix-calling importer wiring helper.
  - Preserve existing defaults (workspace-root env injection, global Nix inputs in `srcs`, stamping choice).
- Cleanup and consistent conventions across Starlark call sites (Node):
  - Avoid any call-site branching that depends on whether `srcs` is a dict vs list. Prefer centralizing that inside the helper surface.
  - Remove local `_pop_list` and other “shape repair” logic when it is redundant with shared helpers.

Non-goals in this PR:

- No change to flake attribute naming or command assembly behavior.
- No change to lockfile auto-attach behavior in the exporter.

### Tests (in this PR)

- Extend existing Node macro tests to assert:
  - importer-local patches remain real action inputs for dict-shaped and list-shaped macro shapes
  - global Nix inputs remain real action inputs for Nix-calling macros
- Add a focused enforcement test that fails if Node macros bypass the functional helper surface after this migration.

### Docs (in this PR)

- Update `abstractions.md` and the Node macro cookbook pages under `docs/handbook/`:
  - document the functional helper usage for Node macros
  - document the intended default behavior for dict-shaped inputs

### Acceptance Criteria

- Node macros consistently use the functional wiring surface.
- Dict-shaped and list-shaped input cases remain correct and covered by tests.

### Risks

Moderate. Node macros are sensitive to genrule `srcs` shapes and sandbox root derivation. Tests must cover representative macro shapes.

### Consequence of Not Implementing

Node remains a drift surface for macro wiring. New Node macro shapes will likely reintroduce inlined dict-safe wiring.

### Downsides for Implementing

Some churn in Node macro files and enforcement tests.

### Recommendation

Implement.

---

## PR‑4: Migrate C++ macros to functional package-local wiring and standardize planner-visible wiring call sites

### Description

C++ macros are package-local, but they include planner-visible stub shapes (tests and WASM). Those shapes are ordering-sensitive and rely on shared wiring helpers. Migration to the functional helper surface reduces the chance of accidental ordering drift and removes call-site dependency on mutation.

### Scope & Changes

- Migrate `build-tools/cpp/defs.bzl` to the package-local functional helper surface introduced in PR‑1.
- Standardize planner-visible call sites:
  - avoid manual `kwargs` cloning to compensate for mutation (for example `dict(kwargs)` patterns used only to avoid side effects)
  - ensure patch scope stamping stays consistent via shared helpers
- Cleanup and consistent conventions across Starlark call sites (C++):
  - keep a single “labels merge point” per macro
  - avoid passing raw `kwargs.get("labels")` through multiple layers when the helper returns the prepared label list

Non-goals in this PR:

- No change to artifact naming or Nix template routing.
- No change to provider sync semantics (C++ remains a no-op for sync).

### Tests (in this PR)

- Add or extend a cquery-based test for a representative C++ target that asserts:
  - package-local patch inputs are present as action inputs
  - planner-visible stub targets preserve the intended dependency shape and labels
- Keep existing C++ macro enforcement tests passing, updating them only for the new helper surface.

### Docs (in this PR)

- Update `abstractions.md`:
  - record C++ macro usage of the functional package-local wiring helpers
  - include guidance for planner-visible and WASM macro shapes

### Acceptance Criteria

- C++ macros use the functional package-local wiring helpers.
- Planner-visible call sites no longer copy dicts only to avoid helper mutation.
- Behavior remains stable and is covered by tests.

### Risks

Moderate. Planner-visible wiring is sensitive to graph shape. Tests must cover at least one planner-visible C++ target.

### Consequence of Not Implementing

C++ macro changes remain higher-risk than necessary. Ordering-sensitive call sites remain easier to drift.

### Downsides for Implementing

Some churn across `build-tools/cpp/defs.bzl` and shared helper usage.

### Recommendation

Implement.

---

## PR‑5: Remove remaining TypeScript duplication in provider index enumeration and lockfile discovery helpers

### Description

Provider sync is mostly unified, but there is still small duplication in TypeScript around:

- provider index enumeration wrappers (Node and Python each define one)
- lockfile discovery and required-module behavior for enumerating index entries

This PR removes that duplication by introducing one shared helper for “read importer provider index entries for a language,” and migrating Node and Python call sites to it.

### Scope & Changes

- Add a shared helper under `build-tools/tools/lib/provider-index.ts` that:
  - reads provider index entries for a set of lockfiles
  - applies supported importer filtering
  - optionally requires a Node module for parsing (Node case with YAML)
  - preserves deterministic ordering
- Refactor:
  - `build-tools/tools/buck/providers/node.ts:readNodeProviderIndexEntries`
  - `build-tools/tools/buck/providers/python.ts:readPythonProviderIndexEntries`
    to call the shared helper.
- Refactor `build-tools/tools/buck/gen-provider-index.ts` to depend on the shared helper surface (not language-specific wrappers) where feasible.

Non-goals in this PR:

- No change to provider naming or provider file output formats.
- No change to importer roots or lockfile label formats.

### Tests (in this PR)

- Add a unit test that:
  - runs the shared helper against fixtures containing both `pnpm-lock.yaml` and `uv.lock`
  - asserts stable ordering and stable key format of index entries
- Ensure existing provider golden tests remain unchanged.

### Docs (in this PR)

- Update `docs/handbook/adding-language.md` and `docs/handbook/new-language-walkthrough.md`:
  - importer-scoped languages should use the shared provider-index helper and shared lockfile discovery helper

### Acceptance Criteria

- Node and Python no longer duplicate provider-index enumeration logic.
- Provider index output remains stable.

### Risks

Low. This is a small refactor with tests and stable consumers.

### Consequence of Not Implementing

Small duplication remains a drift surface. New importer-scoped languages will likely add another copy of the same logic.

### Downsides for Implementing

Minor refactor churn across a small set of TypeScript files.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and to keep each PR revertible:

1. PR‑1 first. It establishes the functional helper surface and validates it on Go.
2. PR‑2 next. It extends the approach to importer-scoped wiring and migrates Python.
3. PR‑3 next. Node migration benefits from the importer-scoped functional helpers.
4. PR‑4 next. C++ migration completes the macro-side transition to functional wiring.
5. PR‑5 last. It is small TypeScript dedupe and should be safe once macro-side behavior is stable.

---

## Verification & Backout Strategy

Each PR includes:

- At least one focused test that asserts the relevant contract behavior.
- A documentation update that points authors at the canonical helper surface and uses the same contract vocabulary.

Backout strategy:

- PR‑1 can be reverted independently. Keep the new helper surface if it is useful, but re-migrate Go if needed.
- PR‑2 can be reverted independently. Revert Python migration while leaving functional helpers available.
- PR‑3 can be reverted independently. Revert Node migration while keeping importer-scoped functional helpers.
- PR‑4 can be reverted independently. Revert C++ migration while keeping package-local functional helpers.
- PR‑5 can be reverted independently. It should not affect build behavior, only enumeration helpers.
