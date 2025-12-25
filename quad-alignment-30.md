# Quad Alignment Plan — Cross-Language Seam Tightening (CPP / Go / PNPM / Python) — Part 30

This installment follows Part 29. Part 29 focused on making the patch model seam visible and reducing patch-tool drift. In Part 30 I focus on the remaining seams I still see in the repo after parity is in place.

The themes in this installment are:

- Make planner-visible targets a first-class, shared wiring surface for package-local languages, so C++ and Go do not carry bespoke planner-stub logic.
- Fix the remaining label vocabulary seam by making `kind:*` enforcement match how we actually use `kind:*` across languages (including wasm, app, and bundle).
- Reduce TypeScript tooling drift by removing the current provider naming module cycle and making the canonical API unambiguous.
- Reduce remaining duplication in patch tooling linting by extracting shared “flat patch dir” validation and duplicate detection.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Unify package-local planner-visible wiring for C++ and Go (reduce bespoke planner stub logic)

### Description

We already have shared wiring helpers for package-local patching (`prepare_package_local_wiring`) and for planner-visible stubs (`wire_planner_visible_stub`). However, some planner-visible flows still carry bespoke wiring decisions in language macros.

The most visible example is `nix_cpp_test`, which constructs a planner-visible stub and an executed runner test, and needs to avoid provider edges on the planner stub to prevent visibility and graph-shape problems. Go has a smaller but similar seam for planner-visible stubs (for example, carchive and some wasm flows).

This PR introduces a single shared Starlark helper for “package-local, planner-visible” targets and refactors C++ and Go to use it.

### Scope & Changes

- Add a shared helper under `//lang` for package-local planner-visible wiring.
  - The helper composes:
    - package-local patch dir parsing and inclusion
    - nixpkg label append (when applicable)
    - `patch_scope:*` stamping
    - `lang:*` and `kind:*` stamping (or explicit override when a macro wants a non-standard kind label)
    - planner stub creation via the existing stub rule(s)
    - optional provider-edge realization and optional provider stripping
- Refactor `cpp/defs.bzl:nix_cpp_test` to route the planner-visible stub setup through the new shared helper.
  - Keep the “executed runner” structure unchanged.
  - Keep the current behavior of stripping provider edges from the planner-visible stub deps.
- Refactor Go planner-visible macro paths that currently use bespoke wiring to use the new helper (starting with the smallest, highest-signal case).
  - Keep behavior stable. The goal is to remove bespoke wiring logic, not to change artifact shapes.

Non-goals in this PR:

- No change to provider naming, provider sync, or auto-map generation.
- No change to patch storage locations or invalidation behavior.

### Tests (in this PR)

- Add a focused Starlark probe test for the new helper that asserts:
  - `patch_scope:package-local` is stamped.
  - package-local patch files are attached as action inputs for the stub.
  - provider edges are included or excluded based on the helper options (cover both).
- Add a focused C++ macro test (cquery-based) that asserts the planner-visible stub for `nix_cpp_test` does not depend on `//third_party/providers:*` targets when stripping is enabled.
- Add a focused Go macro test that asserts the refactored planner-visible macro path still includes package-local patches in inputs and still routes to the same planner kind labels.

### Docs (in this PR)

- Update `abstractions.md`:
  - Document “planner-visible wiring” as a distinct shared surface for package-local languages.
  - Document the provider-strip option and when it is required.
- Update `docs/handbook/adding-language.md`:
  - Add a short section: “When your macro must emit a planner-visible stub, use the shared helper.”

### Acceptance Criteria

- C++ `nix_cpp_test` no longer carries bespoke planner-stub wiring logic.
- At least one Go planner-visible macro path uses the shared helper, proving the helper is not C++-specific.
- Tests fail if provider edges reappear on the C++ planner-visible stub deps when stripping is enabled.
- No behavior changes beyond the internal refactor and any label-only deltas required by the helper contract.

### Risks

Moderate. Planner-visible targets are part of the exporter and planner discovery contracts. Small differences in labels or inputs can change downstream routing. Tests must assert the specific invariants we depend on today.

### Consequence of Not Implementing

Planner-visible wiring remains partially bespoke. That increases drift risk when we add new planner-visible macro shapes, especially in C++ where provider edges can create visibility problems.

### Downsides for Implementing

One more shared helper surface to maintain. This is acceptable if it removes repeated bespoke logic from language macro entrypoints.

### Recommendation

Implement.

---

## PR‑2: Make `kind:*` label enforcement match real usage (fix remaining labeling seam)

### Description

`kind:*` labels are part of the cross-language contract surface. We use them beyond `bin|lib|test` (examples include wasm flows and Node webapp/bundle flows). However, `tools/dev/stamping-lint.ts` currently enforces `kind:(bin|lib|test)` only.

That mismatch is a contract leak. It makes the lint unreliable and discourages use of `kind:*` labels for routing and debugging.

This PR replaces the hardcoded `kind:*` regex with a shared, explicit vocabulary and updates linting and docs accordingly.

### Scope & Changes

- Define a single `kind:*` vocabulary surface:
  - Starlark: add a helper in `//lang` that exports the allowed kind strings (or a predicate).
  - TypeScript: add a helper that exports the same allowed kind strings (or a predicate).
  - Keep the vocabulary small and tied to actual routing/debugging needs.
- Update `tools/dev/stamping-lint.ts`:
  - Validate `kind:*` using the shared vocabulary surface, not a hardcoded regex.
  - Continue to check `lang:go` and `lang:cpp` stamping for their respective rule types.
- Keep exporter behavior unchanged. This PR is lint and contract surface only.

Non-goals in this PR:

- No change to which targets stamp which kinds.
- No change to exporter routing logic.

### Tests (in this PR)

- Add a unit test for the TS kind vocabulary helper covering:
  - allowed kinds currently used in the repo (include wasm-related and Node app/bundle cases)
  - a clearly-invalid kind value
- Add a small integration-style test that runs the lint on a minimal fixture graph or fixture TARGETS content that includes non-`bin|lib|test` kinds we rely on.

### Docs (in this PR)

- Update `abstractions.md`:
  - Document the `kind:*` vocabulary as a contract surface.
  - State how to extend it and what tests must be updated.
- Update `docs/handbook/macro-stamping-cookbook.md`:
  - Add examples for wasm and Node webapp/bundle kind stamping, using the standardized vocabulary.

### Acceptance Criteria

- `tools/dev/stamping-lint.ts` no longer rejects valid `kind:*` labels used by existing macros.
- Extending `kind:*` vocabulary requires updating a single shared place and is protected by tests.

### Risks

Low. This is an enforcement change, but it affects developer feedback loops. The risk is that we accidentally over-accept kinds and allow drift. The vocabulary should remain explicit.

### Consequence of Not Implementing

The lint remains out of sync with actual contract usage and is less useful for preventing drift.

### Downsides for Implementing

We must maintain the kind vocabulary. This is acceptable because `kind:*` is already a public interface between tools.

### Recommendation

Implement.

---

## PR‑3: Remove the TypeScript provider naming module cycle and define one canonical API

### Description

Provider naming and normalization are cross-language contracts. In TypeScript, the current module structure has a cycle:

- `tools/lib/providers.ts` re-exports naming functions from `tools/lib/provider-names.ts`.
- `tools/lib/provider-names.ts` imports `shortHash` from `tools/lib/providers.ts`.

This works today, but it is a drift and bundling risk. It also makes it unclear where the canonical API lives.

This PR removes the cycle and exposes a single, stable module boundary for “provider naming + normalization”.

### Scope & Changes

- Break the cycle by moving hashing and shared primitives into a leaf module (or by inlining them into the canonical module).
- Choose and document a single canonical import path for:
  - `normalizeNixAttr`
  - `providerNameForImporter`
  - `providerNameForNixAttr`
  - patch filename encoding and decoding helpers used across tooling
- Refactor call sites to import from the canonical module only.

Non-goals in this PR:

- No change to the resulting provider names or normalization behavior.
- No change to provider sync outputs.

### Tests (in this PR)

- Ensure existing provider-name tests continue to pass without modification.
- Add one focused test that asserts:
  - all canonical exports come from the chosen canonical module
  - there is no re-export cycle (use a narrow test that imports both modules and asserts no runtime side effects or missing symbols)

### Docs (in this PR)

- Update `abstractions.md`:
  - Point to the canonical TypeScript module for provider naming and normalization.
- Update `docs/handbook/provider-sync-cookbook.md`:
  - State “use this module” for provider naming and patch filename key decoding.

### Acceptance Criteria

- There is no `providers.ts` ↔ `provider-names.ts` cycle.
- All existing provider naming behavior is stable and protected by tests.
- Call sites no longer import provider naming helpers from multiple modules.

### Risks

Low to moderate. This is a refactor, but provider naming is a key contract. Tests must prove behavior is stable.

### Consequence of Not Implementing

The cycle remains a subtle drift surface and makes it easier for future code to pick the wrong import path.

### Downsides for Implementing

Some import churn. The benefit is a clearer contract boundary and fewer bundling surprises.

### Recommendation

Implement.

---

## PR‑4: Extract shared “flat patch dir lint” logic and refactor Go/Node/Python patch lints onto it

### Description

We have patch linting for Go, Node, and Python under `tools/dev/patches-lint/`. These lints share a large amount of structure:

- validate flat directory constraint
- validate filename shape (`<encoded-name>@<version>.patch`)
- detect duplicates by decoded module key (loose decode to tolerate case-insensitive file systems)

Today that logic is duplicated in per-language lint files. This is a drift surface. It also makes it harder to keep error messages and strictness consistent.

This PR extracts the shared logic and refactors the language lints to use it.

### Scope & Changes

- Add a shared helper in `tools/dev/patches-lint/` that:
  - walks a flat patch dir and validates file shape
  - detects duplicates by decoded key
  - produces a standard set of violations
  - accepts small configuration hooks for language-specific behavior (for example, which dirs to scan and how to list patch files)
- Refactor:
  - `lint-go.ts` to use the helper
  - `lint-node.ts` to use the helper
  - `lint-python.ts` to use the helper, while preserving Python’s importer-local scanning behavior

Non-goals in this PR:

- No change to patch naming conventions or decoding policy.
- No change to provider sync behavior.

### Tests (in this PR)

- Add unit tests for the shared helper covering:
  - non-patch files in a patch dir
  - malformed filenames
  - duplicate detection across differing filename spellings that decode to the same key
- Add a regression test that asserts the refactor preserves existing error codes and messages for one representative violation per language.

### Docs (in this PR)

- Update `docs/handbook/patching.md`:
  - Document the flat-dir constraint as enforced by tooling.
  - Document duplicate detection behavior and why it is strict (one patch per key).

### Acceptance Criteria

- Go/Node/Python patch lints share the same core implementation.
- Lint behavior is stable, including strict vs warn mode behavior.
- Tests cover duplicates and filename-shape validation.

### Risks

Low. This is tooling-only, but it can block workflows if behavior changes unexpectedly. Tests must lock down the current behavior.

### Consequence of Not Implementing

Patch lint behavior continues to duplicate across languages and can drift over time.

### Downsides for Implementing

Some refactor churn and test updates. The benefit is less duplication and a single place to adjust patch lint policy.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and by keeping each PR revertible:

1. PR‑1 first. It introduces a shared helper and removes bespoke planner-visible wiring from C++ and at least one Go macro path.
2. PR‑2 next. It fixes `kind:*` enforcement so lint matches the contract we already rely on.
3. PR‑3 next. It removes the TypeScript provider naming module cycle and clarifies the canonical API.
4. PR‑4 last. It refactors patch lints onto shared logic once the other contract surfaces are stabilized.

---

## Verification & Backout Strategy

Each PR includes:

- At least one focused test that asserts the relevant contract behavior.
- A documentation update that points authors at the canonical helper surface and uses the same terms used by the tests.

Backout strategy:

- PR‑1 can be reverted independently if planner-visible wiring differences cause unexpected routing changes.
- PR‑2 can be reverted independently if the kind vocabulary change is too permissive or too strict.
- PR‑3 is a refactor and can be reverted independently if any call-site import churn causes issues.
- PR‑4 is tooling refactor only and can be reverted independently if it causes unexpected lint noise.
