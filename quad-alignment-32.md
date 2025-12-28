# Quad Alignment Plan — Cross-Language Seam Tightening (CPP / Go / PNPM / Python) — Part 32

This installment follows Part 31. Part 31 focused on closing several contract gaps by making policy explicit in shared contract registries and extracting shared tooling. In Part 32 I focus on the remaining seams that still require call sites to “know too much” about rule shapes, planner-visible boundaries, and Nix-calling command assembly.

The themes in this installment are:

- Make planner-visible stubs safer by default, so call sites do not need to remember provider-edge and visibility caveats.
- Standardize dict-safe synthetic key prefixes as a shared contract, removing duplicated string literals across Starlark wiring helpers.
- Reduce Node-specific Nix-calling macro command duplication by centralizing command assembly and required environment exports.
- Enforce patch-scope stamping consistently so debugging and diagnostics are uniform across languages and target shapes.
- Remove a small amount of Go macro duplication introduced by auto-wired test helper targets.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Make planner-visible stubs “safe by default” (provider stripping + provider realization mode)

### Description

Planner-visible targets are a cross-language abstraction. They exist primarily for planner discovery and invalidation, not for execution. Today, some call sites still need to explicitly manage:

- whether provider edges should be stripped from stub deps (to avoid visibility and graph-shape issues)
- whether provider edges must be realized into `srcs` rather than `deps` (for stub/genrule shapes)

This PR tightens the abstraction by shifting those defaults into shared helper surfaces so call sites only declare intent, not implementation details.

### Scope & Changes

- Update the shared helper surface for planner-visible stubs:
  - Extend `//lang:planner_visible_wiring.bzl` and/or `//lang:planner_stub.bzl` wrappers so the default behavior for planner-visible stubs is:
    - strip provider targets from `deps` unless explicitly requested
    - keep provider realization mode explicit as a small vocabulary (for example `"deps"` vs `"inputs"`) rather than leaking `"deps"` vs `"srcs"` string choices into call sites
- Refactor existing call sites to rely on the new defaults:
  - `cpp/defs.bzl`: remove explicit `strip_providers_from_deps = True` where it becomes default behavior for planner-visible stubs
  - `go/defs.bzl`: replace explicit `realize_providers_into = "srcs"` usage in planner-visible helper targets with the new vocabulary and defaults
  - Any other macros that create planner-visible nodes should be updated similarly (including WASM shims).

Non-goals in this PR:

- No change to which targets are planner-visible.
- No change to patch directory layout or provider generation.

### Tests (in this PR)

- Add or extend Starlark probe tests under `tools/tests/lang/` that:
  - assert planner-visible stubs do not contain provider targets in `deps` by default
  - assert provider edges still influence invalidation when realized into inputs for stub-like shapes
- Add a focused cquery-based test that verifies representative planner-visible targets keep the intended dependency shape (no provider targets in deps) while still rebuilding when patch inputs change (package-local case).

### Docs (in this PR)

- Update `abstractions.md`:
  - document the updated “planner-visible stub defaults” and the new provider realization vocabulary
  - include a short checklist item for reviewers: “planner-visible call sites should not manually strip providers”
- Update the relevant handbook page(s) under `docs/handbook/` that describe planner-visible patterns to use the new helper surface.

### Acceptance Criteria

- Planner-visible stubs strip provider edges from `deps` by default, with an explicit opt-in to include them.
- Call sites no longer pass ad-hoc “strip providers” flags or raw `"srcs"` realization strings.
- Existing behavior is preserved: planner-visible boundaries remain discoverable and invalidation remains correct.

### Risks

Moderate. Planner-visible nodes are sensitive to Buck graph shape and visibility. The risk is unintentionally removing a required dep edge. The tests must cover at least one representative target from C++ and Go that uses planner-visible wiring.

### Consequence of Not Implementing

Planner-visible wiring remains error-prone. New stubs are likely to repeat the same “strip providers” and “realize into srcs” logic inconsistently, creating drift and confusing graph behavior.

### Downsides for Implementing

Some refactor churn across existing macros, plus additional probe/enforcement coverage to lock behavior down.

### Recommendation

Implement.

---

## PR‑2: Standardize dict-safe synthetic key prefixes as a shared Starlark contract

### Description

Importer-scoped wiring and dict-shaped inputs require attaching synthetic entries under well-known key prefixes (for example `__patch_inputs__` and `__provider_edges__`). Today those prefixes appear in multiple helper functions and in some call sites as string literals.

This is a drift surface. If we ever need to adjust prefix naming (or add a third synthetic category), we would need to touch many files and risk inconsistent behavior.

### Scope & Changes

- Introduce a single canonical definition of dict-safe key prefixes in Starlark, exposed via `//lang:defs_common.bzl` so call sites and helpers import it rather than restating strings.
  - Example approach (exact location can vary):
    - `//lang:dict_inputs.bzl` exports `PATCH_INPUTS_KEY_PREFIX` and `PROVIDER_EDGES_KEY_PREFIX`
    - `//lang:defs_common.bzl` re-exports them
- Refactor helper implementations to use the constants:
  - `//lang:importer_wiring.bzl`
  - `//lang:patch_inputs.bzl`
  - `//lang:nix_calling_importer_genrule_wiring.bzl` (if it forwards prefixes)
- Cleanup/standardization across call sites:
  - Remove any remaining literal uses of these prefixes in language macro files.

Non-goals in this PR:

- No behavior change to how dict-safe attachments work.
- No change to ordering or dedupe semantics.

### Tests (in this PR)

- Extend existing probe tests (or add a small one) that materializes dict-shaped `srcs` / `resources` with synthetic attachments and asserts:
  - keys are created under the canonical prefixes
  - no collisions occur when both patch inputs and provider edges are attached
- Add one enforcement-style test that fails if a macro directly uses the literal strings instead of importing the constants.

### Docs (in this PR)

- Update `abstractions.md`:
  - document the canonical prefix constants and the rule: “do not hardcode synthetic key prefixes”
- Update any macro wiring cookbook pages to show usage through `//lang:defs_common.bzl` exports.

### Acceptance Criteria

- There is exactly one authoritative location for dict-safe prefix strings.
- No call sites or shared helpers hardcode the prefix strings.
- Probe tests demonstrate behavior remains stable.

### Risks

Low. This is mostly a refactor with narrow, well-testable surface area.

### Consequence of Not Implementing

Prefix strings remain scattered. Minor changes become higher-risk refactors, and new code is likely to introduce subtly different prefixes.

### Downsides for Implementing

Some small churn across helpers and enforcement tests.

### Recommendation

Implement.

---

## PR‑3: Centralize Node Nix-calling macro command assembly (reduce Node-only duplication)

### Description

Node has multiple Nix-calling macro shapes (`node_webapp`, `nix_node_cli_bin(bundle=True)`, and the external runner path in `nix_node_test`). These macros currently embed significant command assembly and environment export conventions inline.

This is correct but fragile. It increases the chance of subtle divergence (different required env vars, different root selection behavior, different debug logging or timeouts) across Node entry points.

This PR extracts the shared Node Nix-calling command assembly into a reusable helper surface, and updates Node macros to use it.

### Scope & Changes

- Add a shared command assembly helper:
  - Prefer placing it under `//lang:nix_shell.bzl` or `//lang:nix_action_runner.bzl` so it is available cross-language where applicable.
  - The helper should:
    - standardize root derivation (`WORKSPACE_ROOT` / `FLK_ROOT`) and workspace-root env sourcing
    - standardize how `nix build --no-link --print-out-paths` is invoked and captured
    - standardize required env exports for Node Nix-calling actions (`BUCK_GRAPH_JSON`, PNPM store setup when enabled, fetch timeout defaults)
    - standardize failure diagnostics (for example, consistent debug log behavior)
- Refactor Node macros to consume the helper:
  - `node/defs_nix.bzl`: use the helper for `node_webapp` and bundled `nix_node_cli_bin`
  - Keep behavior stable; reduce inline shell logic to the minimal “copy outPath output to $OUT” steps.
- Cleanup/standardization:
  - remove any duplicated “bootstrap + nix build out path” command snippets from Node macro call sites

Non-goals in this PR:

- No change to the derivation names or flake attribute naming scheme.
- No change to the lockfile-label contract, importer derivation, or provider wiring behavior.

### Tests (in this PR)

- Extend existing Node macro tests (under `tools/tests/node/`) to assert:
  - the Nix-calling macros include `global_nix_inputs()` as real action inputs (this should remain true after refactor)
  - importer patch inputs remain real action inputs for representative Node targets
- Add one targeted “command assembly smoke test” that inspects the generated command string for required invariant substrings (for example, `--no-link --print-out-paths`, `BUCK_GRAPH_JSON=`, workspace-root env sourcing).

### Docs (in this PR)

- Update `abstractions.md`:
  - identify the new canonical helper for Node Nix-calling command assembly
  - add guidance: “do not hand-roll Nix build out-path capture in Node macros”
- Update the Node handbook pages (or macro cookbook pages) that show how to author new Node macros to reference the helper.

### Acceptance Criteria

- Node Nix-calling macros no longer duplicate command assembly logic.
- Command invariants (out-path capture, workspace-root env handling, required env exports) are consistent across Node Nix-calling entry points.
- Behavior remains stable, validated by existing Node macro tests.

### Risks

Moderate. Small differences in shell command behavior can affect CI and sandboxed actions. The smoke test should lock down key invariants, and existing macro tests should cover inputs and wiring.

### Consequence of Not Implementing

Node remains the largest source of bespoke macro-shell logic. Future changes to root selection or required exports will require multiple careful edits and will likely drift.

### Downsides for Implementing

Refactor churn in `node/defs_nix.bzl` and the helper surface, plus one additional test that inspects assembled commands.

### Recommendation

Implement.

---

## PR‑4: Enforce patch_scope stamping consistently across all macro shapes (including planner-visible shims)

### Description

Patch scope (`patch_scope:package-local` vs `patch_scope:importer-local`) is part of the debugging and reasoning surface. It is stamped by shared wiring helpers (`prepare_package_local_wiring`, importer wiring), but some targets that bypass those helpers (notably certain planner-visible shims) can end up missing the stamp.

This PR ensures that every macro shape that participates in patch invalidation also stamps patch scope, and adds enforcement so future macros cannot accidentally omit it.

### Scope & Changes

- Update shared helper(s) to make patch_scope stamping hard to bypass:
  - Ensure `wire_planner_visible_inputs` and `wire_package_local_planner_visible_stub` (and importer equivalents) stamp patch scope whenever they stamp language/kind labels.
- Standardize Starlark call sites:
  - `go/defs.bzl`: ensure `nix_go_tiny_wasm_lib` and other planner-visible shims include patch_scope stamp via shared helpers (not by ad-hoc label appends)
  - `cpp/defs.bzl`: ensure planner stubs that skip stamping still get patch_scope via the appropriate helper surface
  - `node/defs_core.bzl` / `node/defs_nix.bzl`: confirm importer wiring paths always stamp patch_scope and do not regress when dict-shaped srcs are used
  - `python/defs.bzl`: confirm srcs-less wiring path stamps patch_scope (including synthetic dep targets)

Non-goals in this PR:

- No change to patch directory layout or patch inclusion semantics.
- No change to which languages are package-local vs importer-local.

### Tests (in this PR)

- Extend `tools/dev/stamping-lint.ts` (or the existing stamping lint) to require patch_scope labels where applicable.
- Add a cquery-based test that selects representative targets across languages and asserts patch_scope is present in exported labels (including at least one planner-visible shim and one srcs-less Python binary).

### Docs (in this PR)

- Update `abstractions.md`:
  - document patch_scope stamping expectations and where it must be applied (including planner-visible targets)
- Update the macro stamping cookbook under `docs/handbook/` to include patch_scope as part of the standard stamping bundle.

### Acceptance Criteria

- All representative targets across Go/C++/Node/Python include patch_scope labels consistently, including planner-visible and srcs-less shapes.
- Stamping lint (and tests) prevent future omissions.

### Risks

Low to moderate. The main risk is stamping patch_scope in unintended helper targets and increasing exporter noise. The tests should validate exporter behavior remains acceptable (no new validation failures).

### Consequence of Not Implementing

Patch debugging remains inconsistent. Some targets will remain “mysteriously missing” patch_scope labels, and future macro work can regress stamping silently.

### Downsides for Implementing

Some call-site cleanup in macros, plus stronger linting.

### Recommendation

Implement.

---

## PR‑5: Reduce Go macro duplication in auto-wired test helper targets (standardize wiring reuse)

### Description

Go macros auto-wire tests for libraries and binaries. That feature is useful, but it introduces a small amount of duplication in `go/defs.bzl` where the synthesized helper targets must replay wiring inputs (tuple labels, providers, patch dirs, CGO config).

This PR extracts the duplicated wiring into a small Go-private helper so future changes (tuple label rules, provider-edge wiring, patch dir defaults) are made in one place.

### Scope & Changes

- Introduce a small helper module under `go/private/` (for example `go/private:auto_tests.bzl`) that:
  - takes the minimal set of macro inputs needed to synthesize the `*_pkg` and `*_test` targets
  - delegates to the existing public macros (`nix_go_library`, `nix_go_test`) rather than re-implementing wiring
- Refactor `go/defs.bzl`:
  - replace inline synthesis logic in `nix_go_binary` and `nix_go_library` with calls to the helper
- Cleanup/standardization:
  - ensure synthesized targets continue to carry consistent labels, patch inputs, and tuple labels

Non-goals in this PR:

- No behavior change to what gets auto-wired or which paths are globbed.
- No change to Go tuple label semantics.

### Tests (in this PR)

- Add a focused cquery-based regression test that:
  - asserts the synthesized `*_test` targets exist when test files are present
  - asserts the synthesized `*_pkg` helper does not accidentally introduce duplicate provider edges or missing patch inputs
- Ensure any existing Go-related macro tests still pass without modification beyond fixture updates if necessary.

### Docs (in this PR)

- Update `docs/handbook/` Go workflow documentation to point to the helper as the canonical location for auto-wired test behavior.
- Update `abstractions.md` to note that auto-wired helper targets are implemented through a Go-private helper and should not be duplicated elsewhere.

### Acceptance Criteria

- `go/defs.bzl` no longer duplicates the wiring logic for synthesized helper targets.
- Auto-wired behavior remains unchanged and is covered by a regression test.

### Risks

Low. This is primarily code movement and cleanup. The risk is unintentionally changing which sources are included in synthesized libraries. The test should cover a representative fixture.

### Consequence of Not Implementing

Go auto-wiring remains a small but persistent drift surface. Changes to wiring inputs will need to be applied in multiple places and may diverge.

### Downsides for Implementing

Some refactor churn in Go macro files.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and by keeping each PR revertible:

1. PR‑1 first. It reduces planner-visible footguns and simplifies later call-site cleanup.
2. PR‑2 next. It removes hardcoded prefix strings and reduces churn in later refactors.
3. PR‑3 next. It centralizes Node Nix-calling command assembly before further Node macro additions.
4. PR‑4 next. It enforces patch_scope stamping consistently, after planner-visible defaults are stabilized.
5. PR‑5 last. It is Go-only cleanup and should be safe after shared helper behavior is stable.

---

## Verification & Backout Strategy

Each PR includes:

- At least one focused test that asserts the relevant contract behavior.
- A documentation update that points authors at the canonical helper surface and uses the same terms used by the tests.

Backout strategy:

- PR‑1 can be reverted independently if planner-visible graph behavior changes unexpectedly.
- PR‑2 can be reverted independently if any dict-safe attachment behavior changes (tests should prevent this).
- PR‑3 can be reverted independently if any Node Nix-calling command behavior changes (smoke test should prevent silent drift).
- PR‑4 can be reverted independently if stamping enforcement is too strict (but keep the strongest tests and relax lint rules if needed).
- PR‑5 can be reverted independently if auto-wired Go target synthesis changes in unexpected ways.
