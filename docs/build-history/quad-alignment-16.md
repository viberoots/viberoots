## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 16

This installment follows Part 15. It focuses on the remaining small leaks and duplication that are still present after we reached feature parity across C++, Go, PNPM (Node), and Python.

The theme here is “keep the public macro surfaces boring.” When a language macro is forced to special-case behavior due to a Buck rule API shape, I want that workaround centralized as a shared `//lang` helper and protected by a focused probe or macro regression test.

Each PR below includes its own tests and documentation updates. There are no PRs dedicated solely to testing or documentation.

---

## PR‑1: Fix Go auto-wired binary test library to use the standard `nix_go_library` wiring

### Description

In `build-tools/go/defs.bzl`, `nix_go_binary` auto-wires a `*_pkg` library when `cmd/<name>/**` contains `*_test.go`. Today that auto-generated library is created with the raw prelude `go_library(...)` rule rather than the repo-standard `nix_go_library(...)` wrapper.

This is an abstraction leak. It creates a second Go library pathway that can drift on patch inputs, provider edges, label stamping, and CGO wiring.

### Scope & Changes

- Update `build-tools/go/defs.bzl:nix_go_binary` so the auto-wired `name + "_pkg"` library is created via the same macro wiring as hand-written libraries:
  - Prefer calling `nix_go_library(name = name + "_pkg", ...)` with the correct `srcs`, `labels`, `visibility`, and any required toolchain defaults.
  - Ensure package-local patch inputs (Go patches) are included as action inputs on the auto-wired library, the same as ordinary Go libraries.
  - Ensure provider edges (from `MODULE_PROVIDERS`) are realized consistently.
- If there are constraints that require keeping a raw `go_library(...)` (for example, toolchain attribute restrictions), introduce a tiny private helper in `build-tools/go/private/*` that implements “create the pkg library for tests” once and use it from `nix_go_binary`.

### Tests (in this PR)

- Add or extend a Go macro regression test that exercises the auto-wired binary test path and asserts:
  - the generated `*_pkg` target has the standard stamped labels (`lang:go`, `kind:lib`)
  - the `*_pkg` target includes package-local patch inputs in its `srcs` (or whichever attribute is used by the macro)
  - provider edges are realized (either in `deps` or in the macro’s chosen edge attribute) in the same way as a hand-written `nix_go_library`

### Docs (in this PR)

- Update the Go macro documentation (the existing Go handbook doc) to state that:
  - `nix_go_binary` may auto-create `*_pkg` and `*_test` targets
  - the auto-created `*_pkg` uses the same wiring contracts as `nix_go_library`

### Acceptance Criteria

- The auto-wired `*_pkg` library produced by `nix_go_binary` uses the same patch input and provider wiring contracts as ordinary Go libraries.
- No behavior change for Go targets that do not use the auto-wired `*_pkg` path.

### Risks

- The auto-wired library currently hardcodes toolchain attrs. Switching to `nix_go_library` could change toolchain selection if we do not preserve defaults precisely. The regression test must assert the important attributes or labels are unchanged.

### Consequence of Not Implementing

- Go will retain two parallel macro pathways for libraries. Over time, one will drift and invalidate the “cross-language parity” claim.

### Downsides for Implementing

- Small churn in `build-tools/go/defs.bzl` and a new regression test.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `//build-tools/go` (and possibly `//build-tools/go/private`) plus a narrow test. Safe in slices that already include Go.

---

## PR‑2: Add a shared `//lang` helper for “attach patch inputs via synthetic dep” when a rule cannot carry inputs directly

### Description

Some Buck rules do not accept a natural “inputs” attribute that we can use for patch invalidation (for example, `python_binary` does not accept `srcs`). Today, Python implements a one-off workaround by creating a synthetic `python_library` that carries patch inputs and adding it to `deps`.

This pattern is correct but it is not centralized. If a second language hits the same constraint (or Python needs to evolve the pattern), we will duplicate this logic again.

### Scope & Changes

- Introduce a small shared helper under `//lang` for the “synthetic dep carries patch inputs” pattern. I will keep it narrowly scoped:
  - It must create a deterministic helper target name derived from the parent target name (via `//lang:sanitize.bzl:sanitize_name`).
  - It must attach patch inputs from labels (importer-scoped) into a caller-provided attribute name (for Python, this is `resources` on the synthetic `python_library`).
  - It must return the dep label (e.g., `":<synthetic_name>"`) so call-sites can append it deterministically.
- Refactor `build-tools/python/defs.bzl:nix_python_binary` to use the shared helper rather than an inline copy of the pattern.
- Keep the existing behavior (including label stamping and lockfile label enforcement) unchanged.

### Tests (in this PR)

- Add a small Starlark probe test for the helper that asserts:
  - the synthetic target name is stable and sanitized
  - the patch inputs are attached deterministically based on importer labels
- Add or extend an existing Python macro test to assert `nix_python_binary` still invalidates on importer-local patch changes by confirming the synthetic dep exists and carries patch inputs.

### Docs (in this PR)

- Update the Python macro documentation to describe:
  - why the synthetic dep exists
  - that the pattern is standardized via a shared `//lang` helper

### Acceptance Criteria

- `nix_python_binary` retains its current behavior, but the “synthetic dep carries patch inputs” pattern is centralized and tested.

### Risks

- Some repos rely on the exact synthetic target naming. If that exists here, the helper must preserve the current naming behavior. The regression test should lock this down.

### Consequence of Not Implementing

- The workaround stays “Python-only code.” Future similar constraints will create repeated implementations and drift.

### Downsides for Implementing

- Adds a new shared helper file and touches Python macro wiring.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `//lang` and `//build-tools/python` plus a narrow test. Safe in thin slices that include those packages.

---

## PR‑3: Hide `//third_party/providers:auto_map.bzl` behind a stable `//lang` re-export

### Description

Several language macro entrypoints load provider mappings by directly importing `//third_party/providers:auto_map.bzl`. That hardcodes the provider file layout into each language surface.

This is a small leak. It makes “providers file layout changes” cross-cutting and increases the likelihood of inconsistent migrations.

### Scope & Changes

- Add a small `//lang` module (example: `lang/auto_map.bzl`) that re-exports `MODULE_PROVIDERS` from `//third_party/providers:auto_map.bzl`.
- Update language macro entrypoints to load `MODULE_PROVIDERS` via the `//lang` re-export:
  - `build-tools/go/defs.bzl`
  - `build-tools/node/defs_core.bzl`
  - `build-tools/cpp/defs.bzl`
  - `build-tools/python/defs.bzl`
- Do not change the underlying provider data or generation pipeline.

### Tests (in this PR)

- Add a minimal Starlark probe that loads `//lang:auto_map.bzl` and asserts `realize_provider_edges(...)` behavior is unchanged when the mapping is supplied via the re-export.
- Extend one macro regression test (pick one language) that indirectly depends on provider wiring so the PR proves “call-sites still work” end-to-end.

### Docs (in this PR)

- Update the macro handbook documentation to state:
  - macros must not load `//third_party/providers:auto_map.bzl` directly
  - the stable entrypoint for provider mappings is `//lang:auto_map.bzl`

### Acceptance Criteria

- All language macro entrypoints load provider mappings via `//lang:auto_map.bzl`.
- No behavior change in provider edge realization or invalidation.

### Risks

- If any tooling expects direct loads (for example, via grep-based checks), those checks may need to be updated as part of the PR.

### Consequence of Not Implementing

- Provider file layout remains a cross-language concern. Small refactors become larger migrations.

### Downsides for Implementing

- Low. This is mostly mechanical.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `//lang` and each language’s macro entrypoint. Safe for typical slices that include those entrypoints.

---

## PR‑4: Introduce a shared “macro wiring” helper for importer-scoped ecosystems (Node + Python) to reduce duplication

### Description

Node and Python macros apply the same wiring sequence:

- enforce exactly one importer-scoped lockfile label
- include importer-local patch files as action inputs
- realize provider edges from `MODULE_PROVIDERS`

Both languages implement that sequence locally with minor variations due to rule API constraints (list-shaped vs dict-shaped inputs; rule accepts `srcs` or not).

This is duplication. It is also the most likely source of future drift once we keep tightening contracts (global inputs, dict-safe attachment, etc.).

### Scope & Changes

- Add a shared `//lang` helper module for importer-scoped macro wiring (example: `lang/importer_wiring.bzl`):
  - Provide small functions that do one thing and preserve shape:
    - `require_single_importer_lockfile_label(kwargs, lockfile_label)`
    - `attach_importer_patch_inputs(kwargs, lang, into, dict_safe, key_prefix)`
    - `merge_provider_edges(name, deps, into, base, dict_safe)`
  - Keep the helper focused on wiring. It should not introduce new policy.
- Refactor:
  - `build-tools/node/defs_core.bzl` to use the shared helper for the common sequence
  - `build-tools/python/defs.bzl` to use the shared helper for the common sequence
- If Part 15 PR‑2 (“dict-shaped input attachment consolidation”) lands first, this PR should rely on that shared dict-safe primitive rather than adding any new dict attachment logic.

### Tests (in this PR)

- Add Starlark probe tests for the new helper functions that prove:
  - lockfile label enforcement behavior is unchanged
  - patch input attachment behavior is unchanged (list and dict shapes)
  - provider edge realization behavior is unchanged (list and dict shapes)
- Add a macro regression test for one Node and one Python target that asserts:
  - importer-local patches appear as inputs
  - provider edges are realized deterministically

### Docs (in this PR)

- Update the Node and Python macro docs to point to the shared helper module for importer wiring and to state that copy/paste wiring is not allowed in new macros.

### Acceptance Criteria

- Node and Python macro entrypoints do not re-implement importer wiring steps. They call the shared helper functions.
- Existing behavior and user-facing error messages remain unchanged (or are improved only when the tests and docs demonstrate the new contract explicitly).

### Risks

- Centralization can accidentally change error message text. If any tests assert exact error text, this will cause churn. If error messages change, this PR must document the new canonical wording and update only the tests that depend on it.

### Consequence of Not Implementing

- Importer-scoped macro wiring stays duplicated. Future contract tightening will likely reintroduce cross-language drift.

### Downsides for Implementing

- Small refactor across Node and Python macro entrypoints plus new probes.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `//lang`, `//build-tools/node`, and `//build-tools/python`, plus narrow tests. Safe in slices that include Node and Python.

---

## PR‑5: Close the remaining provider re-export gap by routing Rust macro entrypoints through `//lang:auto_map.bzl`

### Description

PR‑3 established a stable `//lang:auto_map.bzl` re-export for `MODULE_PROVIDERS` so language macro entrypoints do not encode provider file layout (`//third_party/providers:auto_map.bzl`) directly.

Today, `build-tools/rust/defs.bzl` still directly loads `//third_party/providers:auto_map.bzl`. Even though Rust macros are currently a skeleton, this is an abstraction leak and a drift trap: it teaches the wrong pattern and increases the blast radius of future provider-layout changes.

### Scope & Changes

- Update `build-tools/rust/defs.bzl` so provider mappings are loaded only via the stable entrypoint:
  - Replace `load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")` with `load("//lang:auto_map.bzl", "MODULE_PROVIDERS")`.
  - Prefer the shared provider-edge wiring helper (`realize_provider_edges(...)` from `//lang:defs_common.bzl`) rather than bespoke `_providers_for(...)` logic.
- Extend the existing macro hygiene test to include Rust:
  - Update `build-tools/tools/tests/lib/macros.providers-for.usage.test.ts` to include `build-tools/rust/defs.bzl` in the list of checked macro entrypoints so the invariant is enforced repo-wide.

### Tests (in this PR)

- Extend `build-tools/tools/tests/lib/macros.providers-for.usage.test.ts` so it fails if any language entrypoint (including Rust) loads `//third_party/providers:auto_map.bzl` directly or embeds `//third_party/providers:` labels outside the approved `//lang:auto_map.bzl` load.

### Docs (in this PR)

- If any macro handbook text lists “the set of language entrypoints that must not load `//third_party/providers:auto_map.bzl` directly”, update it to include Rust as well. Otherwise no docs change is required beyond the enforced invariant.

### Acceptance Criteria

- `build-tools/rust/defs.bzl` loads provider mappings via `//lang:auto_map.bzl` and uses shared provider-edge realization helpers.
- The repo-wide macro hygiene test enforces the invariant for Rust alongside Go/Node/C++/Python.
- No behavior change for existing (non-Rust) targets.

### Risks

- Low. Rust macros are currently skeletal. The main risk is accidental coupling if downstream tooling expects Rust to load the third-party file directly; the test should reveal this immediately.

### Consequence of Not Implementing

- The provider re-export rule is “mostly true” but not universal. Future provider layout refactors become cross-cutting, and the Rust surface will likely drift further from the standard wiring contracts.

### Downsides for Implementing

- Small churn in a skeleton file and one test update.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `//build-tools/rust` and one narrow zx test. Safe in thin slices.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and correctness first:

1. PR‑1 (Go auto-wired `*_pkg` uses standard wiring) is independent and should land early. It reduces drift risk immediately.
2. PR‑2 (shared helper for “patch inputs via synthetic dep”) should land before additional rule API workarounds appear elsewhere.
3. PR‑3 (provider re-export) is mechanical and can land at any time, but it reduces churn in later refactors.
4. PR‑4 (shared importer wiring helper) should land after Part 15 PR‑2 (dict attachment consolidation), so this PR depends on the existence of stable dict-safe primitives.
5. PR‑5 (Rust entrypoints load provider mappings via `//lang:auto_map.bzl`) is independent and can land at any time; it closes a remaining abstraction leak and makes the provider re-export rule repo-wide.

---

## Verification & Backout Strategy

Each PR should include:

- Probe tests for the shared helper surface added or changed.
- At least one call-site regression test (macro or rule) that demonstrates the contract in a real target shape.
- Documentation updates limited to the contract being tightened.

Backout strategy:

- Each PR is independently revertible.
- If a regression appears, revert the PR and revert its tests and docs together, unless the tests still reproduce the issue on the previous code and are still meaningful.
