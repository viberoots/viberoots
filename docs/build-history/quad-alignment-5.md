## Quad Alignment Plan — Cross-Language Parity Tightening (CPP / Go / PNPM / Python) — Part 5

This installment removes the last pockets of duplication, finishes helper unifications, tightens naming/sanitization consistency, and formalizes typed contracts and manifest‑driven registries. Each PR ships its own tests and minimal doc updates within the same change. No behavior changes are intended for unchanged inputs; all changes are refactors or guardrails that preserve existing artifacts and mappings.

---

## PR‑1: Consolidate importer‑patch helpers; remove Python wrapper

### Description

Finish the deprecation by switching Python macros to use the unified `append_importer_patches(...)` and remove `append_python_patches_for_importer(...)`. Node already uses the unified helper. This keeps one code path for importer‑local patches across languages.

### Scope & Changes

- `python/defs.bzl`:
  - Replace remaining calls to `append_python_patches_for_importer(...)` with `append_importer_patches(..., "python")`.
- `lang/defs_common.bzl`:
  - Remove the deprecated Python wrapper after in‑tree references are updated.
- Tests (in this PR):
  - Create a minimal Python importer fixture with `uv.lock` and a patch under `<importer>/patches/python/<name>@<ver>.patch`; build a tiny `nix_python_library` and assert the macro’s realized `srcs` include the importer‑local patch path (via `buck2 cquery --json --output-attributes=srcs` and a stable contains check).
  - Ensure the behavior is identical for Node (control case) to validate parity of the helper across languages.
- Docs (in this PR):
  - Update the Patching Handbook to reference the unified `append_importer_patches(...)` helper for importer‑local patches across Python/Node and remove references to the deprecated Python wrapper.

### Acceptance Criteria

- Python importer‑local patch changes invalidate precisely (no change in behavior).
- No references to the deprecated helper remain in the repo.

### Risks

- If any downstream/out‑of‑tree macros imported the deprecated helper, they would break. In this repo the usage is in‑tree; audit confirms safe removal.

### Consequence of Not Implementing

- Small duplication remains; two paths for importer‑patch inclusion.

### Downsides for Implementing

- Minimal refactor; easy to review/verify.

### Recommendation

Implement.

---

## PR‑2: Auto‑map hygiene — exclude provider‑package self‑entries

### Description

Filter out `//third_party/providers:*` nodes from `auto_map.bzl` so we don’t generate self‑mappings for provider packages. This reduces noise and prevents confusion during diagnostics without changing behavior for real targets.

### Scope & Changes

- `build-tools/tools/buck/gen-auto-map.ts`:
  - Add a small filter that skips nodes whose name starts with `//third_party/providers:` when building the mapping dictionary.
- Tests (in this PR):
  - Snapshot `third_party/providers/auto_map.bzl` before/after on a fixture with provider nodes present; assert no provider‑package keys remain while real target mappings are byte‑identical.
- Docs (in this PR):
  - Note in build‑system‑design that provider‑package entries are intentionally excluded from the auto map for diagnosability.

### Acceptance Criteria

- `third_party/providers/auto_map.bzl` no longer lists provider‑package nodes as keys.
- No change in the mappings of real targets; snapshot tests remain identical for non‑provider nodes.

### Risks

- Very low; purely cosmetic noise reduction.

### Consequence of Not Implementing

- Ongoing mapping noise and slightly higher cognitive load during debugging.

### Downsides for Implementing

- None material.

### Recommendation

Implement.

---

## PR‑3: Sanitization normalization across languages

### Description

Normalize artifact/attribute name sanitization by using `//lang:sanitize.bzl:sanitize_name` wherever applicable. Where a language needs extra semantics (e.g., C++ bin/addon output base names), keep a tiny wrapper that delegates to the shared sanitizer for the common portion to avoid drift.

### Scope & Changes

- Adopt `sanitize_name` as the common sanitizer in macro code paths that currently hand‑roll or import language‑local variants.
- In C++:
  - If `cpp/private/sanitize.bzl` adds C++‑specific behavior, preserve it but delegate shared portions to `sanitize_name` to keep cross‑language parity.
- Verify flake‑side sanitizer equivalence (already documented to mirror the same transform).
- Tests (in this PR):
  - Add a small Starlark probe `sanitize_name_probe(name, value)` in `lang/sanitize.bzl` mirroring the existing nix‑attr probe pattern; use zx test to materialize sanitized outputs for representative inputs and compare to expected golden values.
  - Snapshot relevant macro outputs that include sanitized names to confirm no drift for unchanged inputs.
- Docs (in this PR):
  - Amend Adding‑language guide to instruct new languages to use `sanitize_name` (or a thin wrapper that delegates to it) for artifact/attribute naming.

### Acceptance Criteria

- No name drift introduced for unchanged inputs; artifacts and labels remain byte‑stable.
- All new call sites route through `sanitize_name` (or a wrapper that calls it).

### Risks

- If a caller relies on legacy edge‑case behavior of a local sanitizer, subtle renames could occur. Mitigate by targeted snapshot tests of affected paths.

### Consequence of Not Implementing

- Gradual drift risk and inconsistent name rules across languages.

### Downsides for Implementing

- Small migration effort; careful test coverage required for name‑sensitive paths.

### Recommendation

Implement.

---

## PR‑4: Remove C++ overlay coupling; rely on local patch dirs + nixpkg labels

### Description

Eliminate special‑case coupling to the repo overlay in C++ macros and stamp global inputs consistently. C++ should match Go/Python in relying on per‑target local patch dirs and explicit `nixpkg:` labels, avoiding cross‑repo overlay dependencies for patch application/invalidation.

### Scope & Changes

- `cpp/defs.bzl`:
  - Remove the `//build-tools/tools/nix/overlays:cpp-patches.nix` item from `nix_inputs` in `nix_cpp_*` macros.
  - Keep per‑target local patch dirs via existing shared helpers (unchanged behavior).
  - Ensure `append_nixpkg_labels(...)` drives native deps for invalidation, aligning with other languages.
- `build-tools/tools/nix/templates/cpp*.nix` (if present):
  - Confirm patch application is driven solely by per‑target patch inputs; no overlay scans.
- Optional: centralize any remaining global input stamping (e.g., `flake.lock`) behind a small, shared macro helper so the policy is consistent repo‑wide (see PR‑5).
- Tests (in this PR):
  - Build a representative C++ lib/bin before/after; assert identical artifacts for unchanged inputs (size/hash or Buck cache hit).
  - Introduce a local patch under `<pkg>/patches/cpp` and validate precise invalidation of only affected targets.
- Docs (in this PR):
  - Remove references to the C++ overlay from internal docs where they imply patch application flows; clarify that per‑target patch dirs are authoritative.

### Acceptance Criteria

- Byte‑stable outputs for unchanged inputs compared to pre‑change baseline.
- Local patch edits under a C++ package still invalidate precisely.
- `nixpkg:` attr changes still trigger correct invalidation via labels.

### Risks

- Repos that rely on the overlay path for C++ patching could regress. Mitigate by auditing references; all current patching should be local and per‑target.

### Consequence of Not Implementing

- Persistent special‑case in C++ macro inputs; unnecessary cross‑repo coupling and higher conceptual load.

### Downsides for Implementing

- Small macro churn and snapshot baselining effort (expected to be no‑op for unchanged inputs).

### Recommendation

Implement.

---

## PR‑5: Unified global input stamping and provider mapping hardening

### Description

Standardize how global inputs (e.g., `flake.lock`) influence rebuilds and ensure provider mapping continues to rely on the canonical helpers only. The goal is consistent, minimal stamping policy and a single lookup path for generated providers.

### Scope & Changes

- Macro‑side:
  - Add a tiny shared helper or policy note to avoid per‑language ad‑hoc stamping of `flake.lock`. Prefer stamping at the builder/Nix level or via one macro‑level helper, applied consistently where justified.
- TS‑side:
  - Re‑audit call sites to confirm provider lookups go through `providers_for(...)` and naming helpers in `build-tools/tools/lib/providers.ts`.
- No behavior changes intended; this is a clarification and minor consolidation.
- Tests (in this PR):
  - Grep‑based guard to ensure no macro files directly stamp `//:flake.lock` (except where explicitly allowed by the unified policy); enforce in zx as a fast lint.
  - Provider lookup smoke test that exercises a couple of macro invocations and asserts provider edges are realized only via `providers_for(...)`.
- Docs (in this PR):
  - Add a short “Global input policy” note in build‑system‑design: default to builder/Nix‑level consideration of `flake.lock`; avoid macro‑level stamping unless a documented exception exists.

### Acceptance Criteria

- Rebuild triggers for real changes remain correct and consistent across languages.
- No stray direct provider lookups remain outside the shared helpers.

### Risks

- Over‑ or under‑stamping could cause unnecessary rebuilds or missed invalidations. Mitigate via targeted tests and conservative defaults.

### Consequence of Not Implementing

- Slight policy ambiguity on global inputs; risk of future divergence.

### Downsides for Implementing

- Minor refactor and test work.

### Recommendation

Implement.

---

## PR‑6: Typed language contracts and manifest‑driven registries

### Description

Introduce shared TS interfaces for language contracts (planner predicates/hooks, provider sync, scaffolding metadata) and generate registries from `build-tools/tools/nix/langs.json`. This removes shape drift, improves partial‑clone safety, and makes adding languages predictable.

### Scope & Changes

- `build-tools/tools/lib/lang-contracts.ts` (new): define `PlannerLanguage`, `LanguageProviderSync`, and `ScaffoldingLanguage` interfaces.
- Update orchestrators/loaders to import interfaces and to derive registries from `build-tools/tools/nix/langs.json`:
  - `build-tools/tools/buck/providers/index.ts`
  - `build-tools/tools/buck/glue-run.ts` (or equivalent façade)
  - Any planner‑adjacent TS modules that enumerate languages.
- Keep behavior identical; partial‑clone safe imports required.
- Tests (in this PR):
  - zx tests that dynamically load registries in a partial‑clone fixture (with some language dirs missing) and assert discovery returns empty sets without throwing.
  - Runtime smoke checks that call through the typed surfaces for an enabled language to ensure the planner/provider hooks still execute with identical behavior.
- Docs (in this PR):
  - Update Adding‑language guide with a short “contracts” subsection pointing to the interfaces and the manifest, with a minimal example of a new language entry.

### Acceptance Criteria

- All language registries compile against the shared interfaces; builds/tests green.
- Partial‑clone runs do not throw when a language is absent; discovery yields empty sets cleanly.

### Risks

- Interface tightening could expose hidden assumptions. Mitigate by keeping interfaces additive and migrating call sites in the same PR.

### Consequence of Not Implementing

- Ongoing registry drift; higher effort to add languages or reason about capabilities.

### Downsides for Implementing

- Some up‑front typing work and call‑site updates; pays off in clarity and safety.

### Recommendation

Implement.

---

## Rollout & Sequencing

1. PR‑1 (Importer‑patch helper consolidation): quick win; reduces duplication immediately.
2. PR‑2 (Auto‑map hygiene): independent; safe cosmetic reduction of mapping noise.
3. PR‑3 (Sanitization normalization): contained; easier to verify before larger refactors.
4. PR‑4 (C++ overlay coupling removal): aligned with the normalized helpers; verify byte‑stability.
5. PR‑5 (Global input stamping/provider hardening): policy consolidation after previous cleanups.
6. PR‑6 (Typed contracts + manifest registries): finalize consistency with typed, partial‑clone‑safe registries.

---

## Verification & Backout Strategy

- PR‑1
  - Verification: run importer‑local patch change on Python and confirm precise invalidation; ensure no deprecated helper remains.
  - Backout: reintroduce the wrapper temporarily if an unforeseen consumer exists (unlikely).
- PR‑2
  - Verification: snapshot `auto_map.bzl` before/after; provider‑package keys absent post‑change; mappings for real targets unchanged.
  - Backout: remove the filter; purely cosmetic.
- PR‑3
  - Verification: snapshot name‑sensitive artifacts/labels; confirm byte‑stability for unchanged inputs; add focused tests for sanitizer equivalence.
  - Backout: revert specific call sites to the prior sanitizer while keeping shared helper available.
- PR‑4
  - Verification: compare outputs for representative C++ targets pre/post; confirm local patch edits and `nixpkg:` label changes still invalidate precisely.
  - Backout: restore macro‑level overlay stamping while investigating specific consumers.
- PR‑5
  - Verification: targeted tests that toggle global inputs (e.g., `flake.lock` change) and assert rebuild behavior matches policy; audit provider lookups via grep/usage tests.
  - Backout: revert stamping helper usage to prior per‑language behavior; provider audit is additive and safe to keep.
- PR‑6
  - Verification: type‑check registries; run in a partial‑clone fixture; all stages pass; no behavior change in glue/providers generation.
  - Backout: keep interfaces defined but switch registries back to manual wiring; low‑risk revert path.

---

## Summary of Expected Impact

- Removes C++ overlay coupling in favor of per‑target patch dirs and `nixpkg:` labels.
- Consolidates importer‑local patch inclusion through one helper across Python/Node.
- Reduces noise in `auto_map.bzl`, improving diagnosability without changing behavior.
- Normalizes sanitization to a single, shared rule to prevent cross‑language drift.
- Formalizes typed language contracts and manifest‑driven registries for clarity and partial‑clone safety.
- Unifies policy for global input stamping and locks provider mapping to the canonical helper path.
