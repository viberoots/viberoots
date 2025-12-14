## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 12

This installment focuses on making the “shared surfaces” real and enforceable. The changes are intentionally small and behavior-preserving. The main goal is to reduce cross-language drift by tightening contracts where we currently accept ambiguous inputs or expose misleading APIs.

Each PR below includes its own tests and documentation updates. There are no PRs dedicated solely to testing or documentation.

---

## PR‑1: Provider-edge API correctness (`realize_provider_edges`) + lockfile label strictness alignment

### Description

Fix two cross-language contract leaks in the shared Starlark helpers:

- `realize_provider_edges(...)` currently accepts an `into` parameter but ignores it, which implies functionality that does not exist.
- Lockfile label validation is stricter on the TypeScript side than in Starlark; malformed labels can slip through macros and fail later.

The intent is to make the shared interface accurate and fail fast with deterministic errors.

### Scope & Changes

The scope is limited to `//lang` helpers.

- Adjust `//lang:provider_edges.bzl`:
  - Either remove the unused `into` parameter, or implement the “merge into deps vs srcs” behavior in a way that is actually usable by macros.
  - Keep output deterministic (stable order, deduped).
- Tighten `//lang:lockfile_labels.bzl`:
  - Enforce the documented shape `lockfile:<path>#<importer>` (require `#` and a non-empty importer).
  - Keep error text actionable and deterministic.
- If any macros rely on the old permissive behavior, update them in the same PR to pass correct labels (behavior-preserving).

### Tests (in this PR)

This PR should add/extend Starlark probe tests so failures show up as concrete outputs:

- A probe asserting `ensure_single_lockfile_label(...)` rejects labels missing the `#<importer>` suffix with stable error text.
- A probe for `realize_provider_edges(...)`:
  - If `into` is removed: test that the function signature is not misleading and the returned list is deduped and stable.
  - If `into` is implemented: test `deps` vs `srcs` merge behavior on representative inputs.

### Docs (in this PR)

Update the shared “contract docs” in whichever contributor docs currently explain lockfile labels and provider wiring:

- Document the exact required lockfile label format and that macros fail fast when it is malformed.
- Document the actual supported surface of `realize_provider_edges(...)` (no implied behavior).

### Acceptance Criteria

- Lockfile label validation fails fast in Starlark for malformed labels with deterministic error text.
- Provider edge merging is either:
  - explicitly list-only (no `into` parameter), or
  - truly supports `deps` vs `srcs` merging and is covered by tests.
- No behavioral changes for existing valid call sites.

### Risks

- Some targets may have been relying on permissive lockfile labels. This would surface as a build error until labels are corrected.

### Consequence of Not Implementing

- Cross-language drift remains: TS assumes a stricter contract than Starlark enforces, and the provider-edge helper continues to advertise a behavior it does not provide.

### Downsides for Implementing

- Minor churn in macro call sites that currently pass malformed lockfile labels.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Changes are confined to `//lang` and any directly impacted macro files. Typical slices already include these paths.

---

## PR‑2: Reduce shared bootstrap coupling by splitting `nix_bootstrap_env()` into core + optional add-ons

### Description

`nix_bootstrap_env()` is a shared cross-language helper, but it currently performs Node-specific unified PNPM store setup. Even with gating, this couples a shared abstraction to one language ecosystem and makes the bootstrap harder to reason about.

This PR splits bootstrap into:

- A minimal, cross-language “core” that only establishes workspace/flake roots deterministically.
- A separate, explicitly-invoked add-on for PNPM store setup, used only by Node macros that need it.

### Scope & Changes

- Refactor `//lang:nix_shell.bzl`:
  - Extract “root detection + cd” into `nix_bootstrap_env_core()` (or equivalent name).
  - Move PNPM unified store logic into `nix_bootstrap_env_pnpm_store()` (or equivalent name), keeping existing gating semantics.
  - Keep existing `nix_timeout_wrapper_var(...)` unchanged.
- Migrate call sites:
  - Node macros that require PNPM store setup should invoke core + pnpm add-on.
  - Non-Node macros should invoke only the core bootstrap, unless they explicitly need the add-on.

### Tests (in this PR)

- A small zx/Starlark test that evaluates the returned shell snippet(s) and asserts they contain:
  - core: workspace/flake root logic
  - pnpm add-on: unified store setup logic
- A regression test that Node macros that previously relied on the unified store still include the add-on in their command assembly.

### Docs (in this PR)

- Update the “Node macros that call Nix” documentation to describe when the PNPM add-on must be included.
- Add a brief note in cross-language macro docs: core bootstrap is language-agnostic; add-ons are opt-in and ecosystem-specific.

### Acceptance Criteria

- Non-Node macros no longer pull in PNPM store behavior implicitly via the shared bootstrap.
- Node behavior remains unchanged for macros that require PNPM store setup.
- Tests cover the split and prevent re-coupling.

### Risks

- Missing the add-on in a Node macro could regress behavior in environments where the unified store is required.

### Consequence of Not Implementing

- The shared bootstrap surface keeps accumulating ecosystem-specific responsibilities and becomes harder to keep stable across languages.

### Downsides for Implementing

- Slightly more explicit assembly in Node macro command strings (core + add-on).

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Mostly `//lang` plus the Node macro file(s) that assemble Nix commands.

---

## PR‑3: Consolidate TypeScript path normalization + “uniq+sort” helpers used by importer/provider code

### Description

There are multiple similar utilities for POSIX normalization and deterministic unique sorting across `tools/lib/importers.ts` and `tools/lib/provider-sync-driver.ts`. The behavior is close but not identical, which increases drift risk for importer-scoped provider generation.

This PR centralizes these helpers so Node and Python provider generation cannot subtly diverge.

### Scope & Changes

- Add or reuse a single canonical helper for:
  - `toPosixPath(...)` (strip `./`, normalize `\` to `/`, ensure `.` behavior is consistent)
  - `uniqSorted(...)` (dedupe with canonical normalization, stable sort)
- Update `tools/lib/provider-sync-driver.ts` to reuse the canonical helper(s) instead of re-implementing them.
- Keep behavior identical for existing inputs (especially around `.` importer handling and leading `./` trimming).

### Tests (in this PR)

- Unit tests asserting canonicalization behavior on:
  - Windows-style separators
  - leading `./`
  - empty and `.` edge cases
- Golden test for importer provider output on a representative fixture:
  - Node: unchanged provider entries for a known lockfile + patches fixture
  - Python: unchanged provider entries for a known uv.lock + patches fixture

### Docs (in this PR)

- Update internal developer docs or module headers to point contributors to the canonical helper location (so future code does not reintroduce duplicates).

### Acceptance Criteria

- No diffs in generated `third_party/providers/TARGETS.{node,python}.auto` for unchanged inputs.
- The duplicate helper implementations are removed, and call sites compile and pass tests.

### Risks

- Minor behavior drift if the centralized helper differs in a subtle edge case. The golden tests should catch this.

### Consequence of Not Implementing

- Continued risk of small path normalization divergences across Node vs Python tooling paths.

### Downsides for Implementing

- Minimal refactor churn across a couple files.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Confined to `tools/lib` and does not require touching language-specific tool implementations beyond imports.

---

## PR‑4: Cross-language patch filename decoding parity (TS ↔ Nix) + explicit tests

### Description

Patch filename decoding currently differs between TS and Nix:

- Nix decoding treats `__` as `/` exactly.
- TS decoding is more permissive (treats 2+ underscores as `/`) to tolerate case-insensitive filesystem and test scenarios.

If this permissiveness is intentional, we should lock it in with explicit tests and document it as a compatibility policy. If it is accidental, we should align semantics.

This PR makes the policy explicit and prevents accidental drift.

### Scope & Changes

- Decide and codify a single intended policy:
  - **Option A (strict parity)**: TS decoding matches Nix (`__` only), and tests reflect that.
  - **Option B (documented liberal TS)**: keep TS liberal decoding, but add tests proving the Nix side is strict and that TS’s liberal decode is only used in the provider tooling layer (not in Nix evaluation).
- Add a small, focused parity test suite that covers:
  - encoding (`/` → `__`)
  - decoding of representative patch filenames
  - last-`@` version split behavior (for scoped names)

### Tests (in this PR)

- Unit tests around `decodeNameVersionFromPatch(...)` for:
  - scoped-like names
  - multiple `@` occurrences
  - underscore sequences
- A Nix eval test (or existing Nix test harness) that confirms `patchesMapFromDir` decodes filenames as intended.
- If we keep TS liberal decoding, a test that asserts we never generate ambiguous filenames from our encoders (so “liberal accept” does not become “liberal emit”).

### Docs (in this PR)

- Document the chosen policy in the patching section:
  - what the canonical encoding is
  - what is accepted vs what is produced
  - why (filesystem compatibility vs strict reproducibility)

### Acceptance Criteria

- The encoding/decoding policy is unambiguous and covered by tests on both TS and Nix sides.
- No changes to existing patch application behavior for valid patch filenames.

### Risks

- If strict parity is chosen, there is a risk that some “previously tolerated” filenames stop being accepted. This should only be allowed if we can prove such filenames are not produced by our tooling.

### Consequence of Not Implementing

- Silent divergence risk remains; future changes could accidentally drift TS and Nix patch interpretation.

### Downsides for Implementing

- Requires choosing and documenting a policy that was previously implicit.

### Recommendation

Implement, with Option B unless there is a concrete reason to enforce strict parity in TS acceptance.

### Sparse / Partial Clone Guidance

- Affects `tools/lib/providers.ts` and `tools/nix/lib/lang-helpers.nix` plus tests; should remain compatible with thin slices.

---

## Rollout & Sequencing

The PRs are intentionally ordered so earlier changes tighten shared contracts before later refactors rely on them:

1. PR‑1 (Provider-edge API correctness + lockfile label strictness)
2. PR‑2 (Split shared bootstrap core vs PNPM add-on)
3. PR‑3 (Consolidate TS path normalization utilities)
4. PR‑4 (Patch filename decoding parity policy + tests)

---

## Verification & Backout Strategy

Each PR should include:

- deterministic unit/probe tests covering the modified shared surface
- at least one “behavior-preserving” golden (generated provider files or macro label outputs)
- doc updates limited to the affected surface (contract and usage notes)

Backout is straightforward: each PR is self-contained and should revert cleanly to restore prior behavior.
