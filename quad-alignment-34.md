# Quad Alignment Plan — Cross-Language Seam Tightening (CPP / Go / PNPM / Python) — Part 34

This installment follows Part 33. Part 33 tightened several important seams:

- Provider index output now includes patch model metadata (`patch_scope` and where patch inputs are expected).
- Prebuild guard and patch tooling now print patch invalidation one-liners using the contract vocabulary.
- Importer-scoped exporter behavior is configured via a shared registry (`tools/buck/exporter/lang/importer-scoped-registry.ts`).

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
- Migrate `go/defs.bzl` to the new helper surface.
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
- Update `build-system-design.md`:
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

Some churn in `go/defs.bzl` and the shared wiring helpers, plus one new test surface.

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

- Add a shared helper under `tools/lib/provider-index.ts` that:
  - reads provider index entries for a set of lockfiles
  - applies supported importer filtering
  - optionally requires a Node module for parsing (Node case with YAML)
  - preserves deterministic ordering
- Refactor:
  - `tools/buck/providers/node.ts:readNodeProviderIndexEntries`
  - `tools/buck/providers/python.ts:readPythonProviderIndexEntries`
    to call the shared helper.
- Refactor `tools/buck/gen-provider-index.ts` to depend on the shared helper surface (not language-specific wrappers) where feasible.

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
2. PR‑5 last. It is small TypeScript dedupe and should be safe once macro-side behavior is stable.

---

## Verification & Backout Strategy

Each PR includes:

- At least one focused test that asserts the relevant contract behavior.
- A documentation update that points authors at the canonical helper surface and uses the same contract vocabulary.

Backout strategy:

- PR‑1 can be reverted independently. Keep the new helper surface if it is useful, but re-migrate Go if needed.
- PR‑5 can be reverted independently. It should not affect build behavior, only enumeration helpers.
