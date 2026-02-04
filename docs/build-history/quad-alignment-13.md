## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 13

This installment closes the remaining abstraction “leaks” that show up once we have feature parity across C++, Go, PNPM (Node), and Python.

The focus is on the places where our shared interfaces are correct in principle (labels, providers, patches, planner visibility) but leak ecosystem-specific rule-shape constraints into each language. The goal is to make those constraints explicit in shared helpers, so language macros do not re-implement special cases.

Each PR below includes its own tests and documentation updates. There are no PRs dedicated solely to testing or documentation.

---

## PR‑1: Provider-edge filtering helper (shared) + remove per-language ad-hoc provider filtering

### Description

Some call sites need “planner-visible deps” but must exclude provider targets (for visibility or graph-shape reasons). Today, at least one macro implements this filtering locally.

This PR makes “provider filtering” a shared, explicit helper, and migrates existing ad-hoc filtering to the shared helper.

### Scope & Changes

- Add a shared helper in `//lang:provider_edges.bzl`:
  - `strip_provider_targets(deps, provider_prefix = "//third_party/providers:")` (or equivalent name).
  - Deterministic behavior: preserve order, drop only provider targets, ignore non-strings.
- Update C++ macros:
  - Replace the inline provider filtering in `nix_cpp_test` planner stub wiring with the shared helper.
- Audit and migrate any other instances of `//third_party/providers:` prefix filtering in Starlark to the shared helper.

### Tests (in this PR)

- Add a Starlark probe test for `strip_provider_targets(...)` covering:
  - mixed lists (strings and non-strings)
  - provider targets and normal targets
  - stability (ordering preserved)
- Add or extend an existing C++ macro test to assert:
  - `nix_cpp_test` still declares correct planner deps
  - provider targets are not present in the planner stub deps

### Docs (in this PR)

- Update the cross-language provider wiring docs to clarify:
  - when provider edges are realized into `deps` vs `srcs`
  - when provider targets must be excluded from planner-visible deps (and that we use the shared helper)

### Acceptance Criteria

- No Starlark file contains bespoke `startswith("//third_party/providers:")` filtering logic.
- Planner-visible targets exclude provider deps where required, via the shared helper.
- Tests cover helper correctness and at least one real macro call site.

### Risks

- Missing a bespoke filtering site could leave inconsistent planner dep behavior.

### Consequence of Not Implementing

- Provider filtering logic remains duplicated and will drift across languages and call sites.

### Downsides for Implementing

- Minor refactor churn in macro files.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Affects `//lang` and a small number of macro files; should be safe in thin slices.

---

## PR‑2: Shared planner-visible stub rule (`//lang:planner_stub.bzl`) + migrate C++ and Go planner stubs

### Description

We currently have multiple “planner-visible stub” shapes across languages:

- C++ uses a dedicated `cpp_planner_stub` rule.
- Go uses `genrule`-based stubs for planner-only targets (e.g. carchive).

This is functional, but it leaks per-language conventions and increases the chance that one stub carries slightly different edges/labels semantics.

This PR introduces one shared planner stub rule under `//lang` and migrates existing uses to it.

### Scope & Changes

- Add `//lang:planner_stub.bzl` defining a rule that:
  - produces a single stamp output
  - accepts `deps` (for graph edges)
  - accepts `labels` (for exporter/planner routing)
  - optionally accepts `srcs` (to carry package-local file inputs when needed for planner discovery)
- Migrate C++:
  - Replace `//cpp/private:planner_stub.bzl` usage with `//lang:planner_stub.bzl`.
- Migrate Go:
  - Replace the `genrule` stub used by `nix_go_carchive` with `planner_stub` so the planner-visible node is uniform.
  - Keep existing behavior for provider-edge realization (merge provider edges into `srcs` where required) but route it through a shared stub.
- Keep language semantics minimal: this stub is “graph and labels only”, not a build rule.

### Tests (in this PR)

- Add a Starlark probe test that instantiates `planner_stub` with:
  - deps-only
  - srcs+deps
  - labels
    and asserts the stamp file exists and carries deterministic content.
- Add/extend a Go macro test that verifies:
  - `nix_go_carchive` still creates a planner-visible node with expected labels
  - provider edges remain realized deterministically
- Add/extend a C++ macro test that verifies:
  - `nix_cpp_wasm_emscripten_lib` / `nix_cpp_test` planner-facing behavior remains unchanged after migration

### Docs (in this PR)

- Update the build design / contributor docs section describing “planner-visible stubs” to:
  - name the shared `planner_stub` as the only supported stub mechanism
  - describe when stubs should include `srcs` (package discovery / patch invalidation inputs)

### Acceptance Criteria

- C++ and Go planner-only nodes use the shared stub rule.
- No language-specific stub rule remains required for planner visibility.
- Tests cover the shared stub directly and through at least one macro call site in two languages.

### Risks

- If the new stub does not replicate the exact attribute types expected by existing macros, analysis-time failures could occur.

### Consequence of Not Implementing

- Planner visibility remains a per-language special case, increasing drift risk.

### Downsides for Implementing

- Small amount of migration work and test updates.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Confined to Starlark rule additions plus macro call sites; should work in partial clones that include `//lang`.

---

## PR‑3: Patch-input helpers gain an explicit “attach into” surface + eliminate Python binary patch-input ambiguity

### Description

Patch invalidation is implemented by including patch files as explicit Buck inputs. This works well for rules with a clear `srcs` list, but becomes ambiguous for rules where:

- `srcs` may not be supported, or
- `srcs` has a special shape (e.g. dict-mapped sources), or
- the rule’s “correct” input attribute is not `srcs`.

Today, these differences leak into language macros as special cases.

This PR makes “where patch inputs attach” explicit and resolves the Python binary patch-input ambiguity by choosing a single, tested approach.

### Scope & Changes

- Extend `//lang:patch_inputs.bzl`:
  - Add `append_patch_inputs(kwargs, dirs, into = "srcs")` (or equivalent).
  - Add `include_importer_patches_from_labels(kwargs, lang, into = "srcs")`.
  - Preserve existing helpers as wrappers (`append_patch_srcs(...)` remains, implemented via the new function).
- Update Node macro special cases:
  - Keep the behavior that when Node `srcs` is a dict mapping, patches are not appended into it.
  - Make the special-case explicit and documented (rather than “silent skip”).
- Fix Python binary patch inputs:
  - Decide and enforce one policy:
    - If prelude `python_binary` supports `srcs`: keep attaching patch files into `srcs`.
    - If it does not: attach patch files into the supported input attribute (e.g. `resources`/`data`) or ensure patch inputs are carried by a required dependent target.
  - Implement the chosen policy in `python/defs.bzl` and lock it in with tests that fail at analysis-time if the attribute is unsupported.

### Tests (in this PR)

- Starlark probe tests for `append_patch_inputs(..., into=...)`:
  - verify it appends patch globs into the right field
  - verify dedupe + determinism
- Node macro test:
  - confirm dict-shaped `srcs` mode does not attempt to mutate `srcs` with patch files
  - confirm non-dict `srcs` mode includes importer patches
- Python macro test(s):
  - a minimal fixture target built/analyzed by Buck that confirms the selected attribute strategy for patch inputs is valid
  - a regression test that importer patch edits invalidate at least one Python target in the importer (rule key change), using an existing test harness pattern

### Docs (in this PR)

- Update the patching/invalidation docs to explicitly state:
  - patch inputs are attached via `//lang:patch_inputs.bzl`
  - the supported `into` values and how to choose them
  - the Python binary strategy (so contributors do not cargo-cult `srcs` assumptions)

### Acceptance Criteria

- Patch input attachment is explicit at call sites (no implicit “always srcs” assumption).
- Python binary patch-input strategy is unambiguous, tested, and documented.
- Node dict-shaped `srcs` special case is explicit and covered by tests.

### Risks

- If Python prelude rule signatures differ from our assumptions, this will surface as analysis-time failures until the chosen strategy is corrected. The tests are intended to make this immediate.

### Consequence of Not Implementing

- Patch invalidation remains a rule-shape leak, and Python binary behavior remains ambiguous.

### Downsides for Implementing

- Slight expansion of the shared helper surface; mitigated by keeping wrappers and strong tests.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `//lang`, `python/defs.bzl`, `node/defs_core.bzl`, and tests. Should remain compatible with thin slices if the fixtures live under `build-tools/tools/tests`.

---

## PR‑4: Consolidate Node “Nix invocation” command assembly into shared helpers and remove duplicate stringly logic

### Description

Node macros that call Nix (`node_webapp`, bundled `nix_node_cli_bin`) currently assemble complex command strings with repeated patterns:

- core bootstrap + optional PNPM store bootstrap
- timeout wrapper
- “no out-links” policy (`--no-link --print-out-paths | tail -n1`)
- Buck-safe command substitution escaping (`$(` → `$$(`)

This is correct but brittle. The abstraction leak is that each Node macro re-implements Nix invocation details.

This PR centralizes those patterns so Node macros remain small and consistent.

### Scope & Changes

- Extend `//lang:nix_shell.bzl` (or add a small `//lang:nix_cmd.bzl`) with helpers:
  - `escape_buck_cmd_subst(s)` (or similar) that performs the minimum `$(` → `$$(` transform.
  - `nix_build_out_path_cmd(flake_attr, timeout_var = "TIMEOUT")` that returns the standard `outPath=$$(...)` snippet using `--no-link --print-out-paths`.
- Update `node/defs_nix.bzl`:
  - Replace inlined command assembly with calls to these shared helpers.
  - Keep Node-specific logic (importer sanitizer, bundler invocation, debug logs) local.

### Tests (in this PR)

- Update/extend existing Node zx tests that already assert:
  - no `--out-link` usage
  - correct global inputs stamping when bundling
  - timeout/bootstrap prefix correctness
    to additionally assert the shared helper output is used (via expected substrings and structure).
- Add a small Starlark probe test for `escape_buck_cmd_subst` to prevent accidental reintroduction of unsafe `$(` sequences.

### Docs (in this PR)

- Update Node macro docs:
  - specify that Node macros must call the shared Nix invocation helper(s)
  - document the “no out-links” policy and where it is implemented

### Acceptance Criteria

- `node/defs_nix.bzl` no longer hand-rolls the `nix build --no-link --print-out-paths` pattern.
- Escaping and timeout policy are centralized and tested.
- Node behavior remains unchanged for existing targets.

### Risks

- If command-string assembly changes subtly, Node actions could regress. The existing tests plus new substring assertions should catch this.

### Consequence of Not Implementing

- Node Nix invocations remain duplicated and are prone to small drift and escape bugs.

### Downsides for Implementing

- Slightly more shared helper surface in `//lang`; mitigated by keeping helpers narrow and Node-focused.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `//lang` and `node/defs_nix.bzl` plus existing Node tests.

---

## Rollout & Sequencing

The PRs are ordered by dependency chain and “surface tightening first”:

1. PR‑1 (provider filtering helper) removes ad-hoc logic and provides a shared primitive used by later work.
2. PR‑2 (shared planner stub) reduces language-specific stubs and benefits from PR‑1’s shared filtering.
3. PR‑3 (patch-input attach surface) uses the shared stub patterns and closes the Python ambiguity with tests.
4. PR‑4 (Node Nix invocation consolidation) is isolated but benefits from the stabilized `//lang` helper approach.

---

## Verification & Backout Strategy

Each PR should include:

- A narrow set of Starlark probe tests covering the shared helper surface added/changed.
- At least one real call-site regression test (macro-level) that proves behavior is unchanged for existing targets.
- Documentation updates limited to the exact contract being tightened (helper usage, invariants, and rationale).

Backout strategy:

- Each PR is designed to be independently revertible.
- If a regression appears, revert the PR and keep the new tests as a reproduction harness (only if they still compile) or revert tests together with the change.
