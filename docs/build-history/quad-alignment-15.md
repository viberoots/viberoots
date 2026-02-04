## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 15

This installment follows Part 14. It focuses on the remaining abstraction leaks that show up once all four ecosystems have feature parity.

The common theme is contract hardening. When two sides are meant to agree (Starlark ↔ TypeScript, macro ↔ rule, “labels” ↔ “inputs”), I want that agreement expressed as a shared helper and protected by a parity test.

Each PR below includes its own tests and documentation updates. There are no PRs dedicated solely to testing or documentation.

---

## PR‑1: Make “global Nix inputs” real action inputs for Nix-executing macros and rules

### Description

We have a policy surface called “global Nix inputs” (today `//:flake.lock`). In some places it is treated as a real action input (C++ passes `nix_inputs`), and in other places it is treated as a label stamp (Node macros that shell out to Nix stamp `//:flake.lock` into `labels`).

This is an abstraction leak. A label is not inherently an action input. If the goal is deterministic invalidation when global Nix inputs change, then every action that shells out to Nix should depend on those files as inputs in a uniform way.

### Scope & Changes

In this PR I will unify “global Nix inputs” as an explicit input attachment mechanism for rules/macros that execute Nix:

- Extend `//lang:global_inputs.bzl` (or add a sibling helper module) with a helper that attaches `global_nix_inputs()` to a caller-specified attribute.
  - It must support both list-shaped and dict-shaped input attributes in the same way `//lang:patch_inputs.bzl` does.
  - It must not hardcode `//:flake.lock` at call-sites.
- Update Node macros that execute Nix:
  - `build-tools/node/defs_nix.bzl:node_webapp`
  - `build-tools/node/defs_nix.bzl:nix_node_cli_bin(bundle=True)`
    so that the resulting `genrule` inputs include `global_nix_inputs()` as actual inputs (not only labels).
- Update “Nix runner” style rules that execute Nix during a Buck action to accept and carry `global_nix_inputs()` consistently:
  - `build-tools/go/private/nix_build_wasm.bzl:go_nix_build_wasm`
  - `build-tools/cpp/private/nix_test.bzl:cpp_nix_test`
  - Any `node/private/*` rules that shell out to Nix during test execution, if they exist and currently lack an equivalent input mechanism.

### Tests (in this PR)

This PR will prove that global Nix inputs are action-relevant, not only labels:

- Add or extend a zx macro test for `node_webapp` and bundled `nix_node_cli_bin` that `buck2 cquery` shows `//:flake.lock` appearing as an input attribute (`srcs` for `genrule`, or the dict-map equivalent) for the target.
- Add a rule-level test fixture for `go_nix_build_wasm` that asserts `nix_inputs` includes `//:flake.lock` (and that the rule continues to accept additional inputs unchanged).
- Add a rule-level test fixture for `cpp_nix_test` that asserts its action “hidden” inputs include `//:flake.lock` (materialized via an output probe file or a stable attribute that can be cqueried).

### Docs (in this PR)

- Update the “global inputs” section in `docs/handbook/macro-stamping-cookbook.md` to clarify:
  - global inputs are attached as action inputs for Nix-executing macros and rules
  - label stamping alone is not the invalidation mechanism
  - call-sites must use the shared helper surface, not hardcoded `//:flake.lock`

### Acceptance Criteria

- Changing `flake.lock` deterministically invalidates every target whose Buck action shells out to Nix, across C++, Go, Node, and Python (where applicable).
- Call-sites do not hardcode `//:flake.lock`. They use the centralized helper.
- Existing Node “global-inputs stamp” behavior remains intact for observability, but invalidation correctness no longer depends on labels.

### Risks

- Adding `flake.lock` to `srcs` for `genrule` actions could increase the apparent input set for some Node actions. The risk is low, but this could surface latent assumptions in tests that assert exact `srcs` lists.
- Some rules use dict-shaped inputs. Key-collision handling must be deterministic and must not clobber user-provided keys.

### Consequence of Not Implementing

- “Global Nix inputs” remains a mixed semantics concept. Some Nix-executing actions will not invalidate when global Nix inputs change.

### Downsides for Implementing

- Small churn across several macros and runner rules to thread a new, explicit input attachment.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `//lang`, `//build-tools/node`, `//build-tools/go/private`, and `//build-tools/cpp/private`, plus narrow tests. It should remain safe in thin slices that include these packages.

---

## PR‑2: Consolidate dict-shaped input attachment (patches, provider edges, and global inputs) into shared `//lang` helpers

### Description

We support dict-shaped inputs (dest → source) for some macros (notably Node `nix_node_gen`). This shape is useful, but it forces call-sites to deal with “attach more inputs without breaking the dict contract.”

Right now Node has bespoke logic to inject provider edges into a dict-shaped `srcs`. We also have shared dict-safe machinery for patches (`//lang:patch_inputs.bzl`). This is duplication and drift risk.

### Scope & Changes

In this PR I will make dict-safe “attach arbitrary items into a dict-shaped input” a shared primitive:

- Extend `//lang:patch_inputs.bzl` (or add a small new helper module under `//lang`) with a dict-safe attach helper that can add a list of items into an existing dict-shaped attribute:
  - stable keying strategy (prefix + sanitized + collision suffix)
  - deterministic order
  - no overwrites of user-provided keys
- Update `build-tools/node/defs_core.bzl:nix_node_gen` so that in dict-shaped `srcs` mode it uses the shared helper for:
  - importer patch inputs (already handled via `include_importer_patches_from_labels_dict_safe`)
  - provider edges realized into `srcs` (replace bespoke `_attach_items_into_srcs_dict`)
  - global Nix inputs (from PR‑1) when the caller is a Nix-executing macro and uses dict-shaped `srcs`
- Ensure list-shaped `srcs` behavior remains unchanged.

### Tests (in this PR)

- Add Starlark probe tests for the new dict-safe “attach items” helper:
  - dict remains dict
  - stable synthetic keys are produced
  - collisions are handled deterministically
  - ordering is deterministic
- Add or extend a Node macro test that exercises `nix_node_gen` with dict-shaped `srcs` and asserts:
  - the original mapping entries remain intact
  - importer patches are included under a stable synthetic namespace
  - provider edge realization is present under a stable synthetic namespace

### Docs (in this PR)

- Update the patch-input contract docs (`docs/handbook/patching.md` or the most relevant Node macro doc) to describe:
  - list vs dict input attachment behavior
  - the reserved namespaces used for synthetic dict keys (patch inputs, provider edges, global inputs)
  - the collision-avoidance contract

### Acceptance Criteria

- Dict-shaped `srcs` targets rebuild deterministically when:
  - importer-local patches change
  - provider mappings change
  - global Nix inputs change (when the action shells out to Nix)
- Node no longer carries bespoke “dict attach” logic in `build-tools/node/defs_core.bzl`.

### Risks

- If user code already uses the synthetic key prefixes, collisions could happen. The helper must avoid clobbering by selecting unique keys deterministically.
- Some Buck rules may treat dict keys specially. We must constrain the synthetic namespace to reduce the chance of accidental interaction.

### Consequence of Not Implementing

- Dict-shaped input support remains fragile and partially duplicated. Future changes will likely reintroduce invalidation drift.

### Downsides for Implementing

- Adds a small new shared helper surface and updates call-sites to use it.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `//lang` and `//build-tools/node` plus narrow tests. Safe for thin slices that include Node macros.

---

## PR‑3: Unify “Buck label → Nix attribute” sanitization across Starlark and TypeScript with a parity test

### Description

We compute “sanitized Nix attribute names” from Buck target labels in more than one place:

- TypeScript uses `build-tools/tools/lib/labels.ts:sanitizeAttrNameFromLabel`.
- Starlark C++ test runner has a local `_sanitize(...)` implementation in `build-tools/cpp/private/nix_test.bzl`.

Even small drift here creates “build-selected computed attr does not exist” failures. This is a cross-language abstraction boundary. It should be represented as a shared contract and protected by a parity matrix test.

### Scope & Changes

- Introduce a canonical Starlark helper under `//lang` for Nix attribute sanitization, matching `build-tools/tools/lib/labels.ts:sanitizeAttrNameFromLabel`:
  - Example location: `lang/nix_attr.bzl` with `sanitize_nix_attr_from_target_label(label)`.
- Update `build-tools/cpp/private/nix_test.bzl` to use the shared helper instead of a local `_sanitize(...)`.
- If any other Starlark rules/macros re-implement this transform, migrate them as well.

### Tests (in this PR)

- Add a cross-language parity zx test that compares:
  - Starlark probe output for `sanitize_nix_attr_from_target_label`
  - TypeScript `sanitizeAttrNameFromLabel`
    across a representative matrix including:
  - labels with cell prefixes
  - labels with config suffixes
  - labels containing `/`, `:`, spaces, and `@`
- Add a small regression test that builds a known target through the “selected” path and confirms the attr lookup still succeeds (smoke test level, not a full integration suite).

### Docs (in this PR)

- Update the build-system docs (the most relevant section in `build-tools/docs/build-system-design.md` or a handbook doc) to state:
  - the canonical mapping lives in `build-tools/tools/lib/labels.ts` and `//lang:nix_attr.bzl`
  - contributors must update both sides and the parity test when changing the contract

### Acceptance Criteria

- The parity test passes and prevents future drift.
- C++ test execution via the selected attr path uses the shared sanitizer.

### Risks

- If there are historical call-sites that relied on the previous C++-local sanitizer quirks, aligning to TS could be a behavior change. The parity matrix should surface this early.

### Consequence of Not Implementing

- Sanitization drift remains a latent failure mode for “selected” builds and tests.

### Downsides for Implementing

- Adds another small shared helper module in `//lang`.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `//lang`, `//build-tools/cpp/private`, and one zx test. Safe in thin slices that include these packages.

---

## PR‑4: Consolidate Nix-executing action boilerplate into a shared `//lang` runner helper (bootstrap, timeouts, and build-selected flow)

### Description

We have several Buck rules that execute Nix during a Buck action:

- `build-tools/cpp/private/nix_build.bzl:cpp_nix_build`
- `build-tools/cpp/private/nix_test.bzl:cpp_nix_test`
- `build-tools/go/private/nix_build_wasm.bzl:go_nix_build_wasm`
- Node bundling and webapp shims build via Nix inside `genrule` commands

They all embed similar shell boilerplate:

- determine workspace root / flake root
- apply timeout wrappers
- export or locate the Buck graph
- run “build selected” logic and copy outputs

This is an abstraction leak. The behavior must remain consistent across languages, but right now it is maintained by copy/paste.

### Scope & Changes

- Add a shared Starlark helper under `//lang` that composes the standard “Nix-executing action” shell:
  - consumes `nix_bootstrap_env_core()` and `nix_timeout_wrapper_var()` from `//lang:nix_shell.bzl`
  - supports the “build-selected” flow via `build-tools/tools/dev/build-selected.ts` where required
  - supports passing explicit inputs (from PR‑1) through `hidden` inputs for rule implementations
- Migrate:
  - `build-tools/cpp/private/nix_build.bzl`
  - `build-tools/cpp/private/nix_test.bzl`
  - `build-tools/go/private/nix_build_wasm.bzl`
    to use the shared helper for their shell assembly, keeping their external behavior the same.

### Tests (in this PR)

- Add a zx test that uses probe rules (or a small “emit assembled command” helper rule) to assert:
  - the shared helper produces the expected bootstrap prefix
  - timeouts are applied consistently
  - workspace-root injection continues to work in temp repos
- Extend an existing integration-ish test (where present) to ensure the migrated rules still build/run in a temp workspace.

### Docs (in this PR)

- Update the handbook doc(s) for “Nix runner rules” to point contributors to the shared helper as the only acceptable place for this boilerplate.

### Acceptance Criteria

- Behavior is unchanged for existing users:
  - C++ `cpp_nix_build` continues to copy the same artifact paths
  - C++ `cpp_nix_test` continues to find and execute the test binary
  - Go wasm build rule continues to copy the expected wasm output
- The shared helper is used for all Buck rule implementations that shell out to Nix (or we document any intentional exceptions).

### Risks

- Shell assembly changes can accidentally alter quoting or variable expansion. The probe tests must verify the critical parts of the command string.
- Some codepaths are intentionally different (for example, C++ build exporting graph in certain contexts). The shared helper must support those differences without hiding them.

### Consequence of Not Implementing

- The “Nix-executing action” behavior will continue to drift across languages over time.

### Downsides for Implementing

- Refactor touches multiple rules at once. This is best done with careful parity tests.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `//lang`, `//build-tools/cpp/private`, and `//build-tools/go/private` plus tests. Not suitable for ultra-thin slices that omit those packages.

---

## PR‑5: Reduce policy logic in `build-tools/go/defs.bzl` by moving CGO wiring and tuple labeling into `go/private` (keep public macros thin)

### Description

The Go macros currently contain a significant amount of policy:

- CGO inference from `srcs`
- toolchain defaulting
- label tuple stamping
- deps merging and special-case handling

This is not a correctness bug, but it is a maintainability and boundary clarity issue. The public macro file is the cross-language entry point. It should be a thin orchestrator that delegates ecosystem details into `build-tools/go/private/*`.

### Scope & Changes

- Introduce `build-tools/go/private/cgo_wiring.bzl` (or similar) that provides:
  - CGO inference (`srcs` imply CGO)
  - consistent toolchain defaulting
  - deps merging (repo CGO deps + nixpkg providers + extra module providers)
  - label stamping for `cgo:enabled` and `nixpkg:` labels
- Update `build-tools/go/defs.bzl` to:
  - keep its public macro surface stable
  - delegate to the new private helper
  - keep using shared `//lang:*` helpers for provider edges and patch inputs

### Tests (in this PR)

- Add or extend an existing Go macro regression test (or create a small temp-repo fixture) that asserts:
  - given representative inputs, the resulting target attributes (labels, deps) are unchanged after refactor
  - CGO inference still triggers on C/C++/asm sources
  - `nixpkg:` label normalization remains unchanged

### Docs (in this PR)

- Update the Go macro handbook doc to state:
  - where CGO wiring policy lives (`build-tools/go/private/*`)
  - what the public macros guarantee (stable surface, shared helper usage)

### Acceptance Criteria

- No behavior change in produced Go targets (labels and deps remain equivalent).
- `build-tools/go/defs.bzl` is materially simpler and delegates policy to private helpers.

### Risks

- A refactor can accidentally change the order or deduping behavior of deps/labels. The tests must assert stability.

### Consequence of Not Implementing

- The public macro surface continues to grow and becomes harder to keep aligned with the cross-language design.

### Downsides for Implementing

- Some churn for a refactor that is primarily about long-term maintainability rather than immediate functionality.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `//build-tools/go` and `//build-tools/go/private` plus tests. Safe in slices that already include Go.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and by “correctness first”:

1. PR‑1 makes global Nix inputs a real invalidation mechanism for Nix-executing actions.
2. PR‑2 consolidates dict-shaped input attachment so Node (and any future users) do not re-implement it.
3. PR‑3 locks down the Nix-attr sanitizer contract with a parity test.
4. PR‑4 reduces drift risk by consolidating Nix-executing action boilerplate.
5. PR‑5 refactors Go macro policy into private helpers to keep cross-language boundaries clear.

---

## Verification & Backout Strategy

Each PR should include:

- Probe tests for the shared helper surface added or changed.
- At least one real call-site regression test (macro or rule) that demonstrates the new contract.
- Documentation updates limited to the contract being tightened.

Backout strategy:

- Each PR is independently revertible.
- If a regression appears, revert the PR and revert its tests and docs together, unless the tests still reproduce the issue on the previous code and are still meaningful.
