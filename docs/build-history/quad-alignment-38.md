# Quad Alignment Plan — Close Remaining Abstraction Gaps (CPP / Go / PNPM / Python) — Part 38

This installment follows Part 37.

After reviewing the current repo state, I still see one concrete abstraction gap and one “convention drift” gap:

- Package-local WASM wiring still has a **mutating call-site boundary**. `lang/wasm_package_local_wiring.bzl:prepare_package_local_wasm_wiring(...)` pops/updates the caller kwargs dict. This is correct today, but it keeps the mutation-ordering risk alive in the WASM surface area and makes it easier to write new WASM macros that “work by accident”.
- Starlark macro call-site conventions are mostly consistent across languages, but we still have small differences in where labels and deps are assembled. This is not a correctness issue, but it increases review/debug burden and creates room for new macros to drift.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Make package-local WASM wiring non-mutating and migrate the existing WASM macro call sites

### Description

For package-local languages we treat “non-mutating helper boundaries” as the default. The current repo state follows that pattern for:

- `prepare_package_local_wiring(...)` (package-local, normal rule wrappers)
- `wire_package_local_planner_visible_stub(...)` (package-local, planner-visible stubs)
- `wire_package_local_wasm_planner_visible_stub(...)` (package-local, WASM planner-visible stubs wrapper)

However, the package-local WASM wiring helper that is used by “normal” WASM build shims is still mutating:

- `lang/wasm_package_local_wiring.bzl:prepare_package_local_wasm_wiring(...)` uses `pop_package_local_patch_dirs_and_nixpkg_deps(...)` and mutates the caller kwargs dict.

This PR makes that helper non-mutating at the public boundary and updates the existing WASM macro call sites to follow one consistent pattern.

### Scope & Changes

- Refactor `lang/wasm_package_local_wiring.bzl:prepare_package_local_wasm_wiring(...)`:
  - stop using `pop_package_local_patch_dirs_and_nixpkg_deps(...)`
  - use the non-mutating extraction path (`extract_*`) so the helper does not mutate the caller’s kwargs dict
  - keep the existing behavior and ordering guarantees:
    - wasm stamping happens before patch scope stamping and patch inclusion
    - patch_scope stamping remains `patch_scope:package-local`
    - package-local patch files remain attached as real action inputs
    - provider edges are still realized only through the planner-visible wiring helper surface
  - return a struct that includes a prepared `kwargs` dict (like other v2-style helpers), while keeping back-compat fields (`deps`, `srcs`, `labels`) when possible so call sites can stay simple.
- Migrate the current macro call sites that use `prepare_package_local_wasm_wiring(...)`:
  - `build-tools/cpp/defs.bzl:nix_cpp_wasm_static_lib`
  - `build-tools/go/defs.bzl:nix_go_tiny_wasm_lib`
  - Ensure each call site has:
    - one “labels merge point” (assemble labels once, then pass into the helper)
    - one “deps merge point” (assemble base deps once; provider realization stays in shared helpers)

Non-goals in this PR:

- No changes to the patch invalidation model or vocabulary.
- No changes to provider mapping (`auto_map.bzl`) or provider sync.
- No changes to Nix templates.

### Tests (in this PR)

- Add a non-mutation probe test for `prepare_package_local_wasm_wiring(...)` that fails if the helper mutates the caller dict at the boundary.
- Add cquery- or probe-based tests that exercise both call sites and assert the outcome-level invariants:
  - `lang:*` and `kind:wasm` stamps are present (including the `wasm:<variant>` stamp)
  - `patch_scope:package-local` is present
  - package-local patch files are present as real action inputs for the rule/shim that is built
  - provider edges (when applicable) remain realized in the intended attribute (`deps` vs `inputs/srcs`) with stable ordering

### Docs (in this PR)

- Update `abstractions.md`:
  - clarify that package-local WASM wiring is non-mutating by default, matching other package-local wiring helpers
  - point to `nix_cpp_wasm_static_lib` and `nix_go_tiny_wasm_lib` as the canonical “package-local WASM wiring” examples (one per language)
- Update `docs/handbook/adding-language.md`:
  - add a short checklist item for “package-local WASM macros” stating which helper to use and that mutation is not acceptable at the call-site boundary

### Acceptance Criteria

- `prepare_package_local_wasm_wiring(...)` is non-mutating at the call-site boundary.
- The existing WASM macro call sites use the non-mutating helper and continue to satisfy the same action-input and stamping invariants.
- Tests prove the invariants and prevent regressions.

### Risks

Low. This is a refactor of helper composition and call-site plumbing. The main risk is changing ordering in a way that affects stamping or patch input inclusion.

Mitigation:

- Add a mutation probe for the helper.
- Add outcome-based tests that assert stamping and action-input invariants.

### Consequence of Not Implementing

WASM remains the main package-local surface area where new macro code can accidentally depend on mutation ordering.

### Downsides for Implementing

Minor churn in one shared helper and two macro call sites.

### Recommendation

Implement.

---

## PR‑2: Standardize Starlark macro call-site conventions across languages and add enforcement against legacy helper bypasses

### Description

After PR‑1, the remaining gaps are primarily “authoring drift” risks:

- New macros can bypass the shared helper surfaces and re-introduce ad-hoc wiring.
- Small differences in where labels and deps are assembled across macro files increase review/debug burden.

This PR standardizes call-site conventions across the macro entrypoints and adds narrow enforcement that prevents reintroducing the known bypass patterns.

### Scope & Changes

- Apply two consistent conventions to each macro entrypoint file:
  - **Single labels merge point**: assemble labels exactly once (user labels + macro stamps + any additional metadata labels), then pass them into shared helpers.
  - **Single deps merge point**: assemble base deps exactly once; provider edge realization occurs only through shared helper surfaces (`prepare_*` helpers and `wire_planner_visible_inputs` / `realize_provider_edges`).
- Mechanical cleanup and standardization across:
  - `build-tools/go/defs.bzl`
  - `build-tools/cpp/defs.bzl`
  - `build-tools/node/defs_core.bzl`
  - `build-tools/node/defs_nix.bzl` (if it still exists as a separate macro file)
  - `build-tools/python/defs.bzl`
- Add enforcement to prevent the highest-signal bypass patterns, scoped to a small allowlist of macro files so the test remains focused:
  - package-local macro files must not call `pop_package_local_patch_dirs_and_nixpkg_deps(...)`
  - importer-scoped macro files must not directly load or call low-level lockfile parsing helpers where the shared importer wiring should be used
  - macros should not call the legacy mutating helper exports (names ending with `_legacy_mutating`) except inside `//lang` compatibility surfaces

Non-goals in this PR:

- No new label vocabulary.
- No semantic change to patch models, provider mapping, or Nix invocation behavior.
- No broad renames of helper symbols.

### Tests (in this PR)

- Add one enforcement test that checks the curated macro file allowlist for the bypass patterns above.
- Add (or extend) a small matrix of outcome-based cquery/probe tests that confirm no macro lost:
  - patch_scope stamping (`package-local` vs `importer-local`)
  - provider edges are present where expected and absent where expected (planner-visible stubs default to provider stripping unless configured otherwise)
  - importer-local patch inputs are present as real action inputs for representative Node and Python macros
  - package-local patch inputs are present as real action inputs for representative Go and C++ macros
  - for importer-scoped Nix-calling macros, global Nix inputs remain attached as real action inputs

### Docs (in this PR)

- Update `docs/handbook/conventions.md` (or the nearest existing handbook page):
  - document the two conventions (single labels merge point, single deps merge point)
  - show one short before/after example taken from an actual macro file
- Update `docs/handbook/adding-language.md`:
  - add a short “macro author checklist” that references the shared helper surfaces and the enforcement tests

### Acceptance Criteria

- Macro call sites follow the same conventions across Go/C++, Node, and Python.
- Enforcement tests prevent reintroducing the known bypass patterns.
- Outcome-based tests prove that stamping and action-input invariants remain intact.

### Risks

Moderate. Mechanical refactors can accidentally change ordering or dedupe behavior.

Mitigation:

- Keep the refactors small and mechanical.
- Prefer outcome-based tests (cquery/probes) for the invariants that matter, and keep code-shape enforcement narrow and allowlisted.

### Consequence of Not Implementing

The system remains correct today, but drift risk reappears as new macro shapes are added and older patterns are copied.

### Downsides for Implementing

Some churn across macro files and a small amount of test scaffolding.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and to keep each PR revertible:

1. PR‑1 first. It removes the remaining mutating helper boundary in package-local WASM wiring and migrates the existing WASM call sites.
2. PR‑2 next. It standardizes macro call-site conventions across languages and adds enforcement to prevent new drift.

---

## Verification & Backout Strategy

Each PR includes:

- at least one focused outcome-based test (probe/cquery) that asserts action-input and stamping invariants
- a documentation update that uses the same contract vocabulary (`patch_scope:*`, `lockfile:*`, `nixpkg:*`, `lang:*`, `kind:*`, `kind:wasm`, `wasm:<variant>`)

Backout strategy:

- PR‑1 can be reverted independently by restoring the prior WASM helper implementation and undoing the two call-site migrations.
- PR‑2 can be reverted independently by reverting the macro call-site cleanups and relaxing enforcement if it proves too strict, then re-landing with a narrower allowlist.
