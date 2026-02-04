## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 14

This installment closes the remaining gaps that show up after feature parity across C++, Go, PNPM (Node), and Python.

The focus is correctness and determinism for rebuild invalidation and planner visibility. I want shared helpers to represent rule-shape constraints explicitly, so language macros do not need silent special cases.

Each PR below includes its own tests and documentation updates. There are no PRs dedicated solely to testing or documentation.

---

## PR‑1: Node dict-shaped `srcs` invalidation fix (provider edges + importer patch inputs)

### Description

`nix_node_gen` supports a dict-shaped `srcs` (dest → source). In this mode, our current behavior skips importing importer-local patch inputs and does not realize provider edges into inputs. That is an abstraction leak. It makes some Node targets under-declare inputs and edges, so they can fail to rebuild when importer patches or providers change.

This PR makes the dict-shaped `srcs` case explicit and correct. It keeps the dict mapping semantics intact while still declaring patch inputs and provider edges deterministically.

### Scope & Changes

- Extend `//build-tools/lang:patch_inputs.bzl` with a dict-safe attach mechanism:
  - Add a helper that can attach patch files into dict-shaped inputs by adding stable synthetic keys (for example `__patch_inputs__/...`).
  - Keep `append_patch_inputs(...)` behavior unchanged for list-shaped inputs.
- Update `build-tools/node/defs_core.bzl`:
  - In `nix_node_gen`, when `srcs` is a dict, include importer-local patches into `srcs` via the new helper.
  - Ensure provider edges are realized even when `srcs` is a dict.
  - Keep existing behavior for list-shaped `srcs`.
- Ensure the new behavior is deterministic:
  - synthetic keys are stable and do not depend on absolute paths
  - no duplicate patch paths
  - provider edges do not introduce nondeterministic ordering

### Tests (in this PR)

- Add Starlark probe tests for the new dict-safe patch attach helper:
  - dict input remains a dict
  - patch files are added under predictable keys
  - dedupe and ordering are stable
- Add or extend a Node macro test that covers:
  - `nix_node_gen` with dict-shaped `srcs` includes importer patches as inputs
  - provider edges are still realized deterministically
  - the dict mapping still contains the original entries unchanged

### Docs (in this PR)

- Update the patch-input contract docs to clarify:
  - list-shaped vs dict-shaped input attachment semantics
  - Node macros may use dict-shaped `srcs`, and it is still required to carry patch inputs and provider edges

### Acceptance Criteria

- Node targets using dict-shaped `srcs` correctly rebuild when importer-local patch files change.
- Node targets using dict-shaped `srcs` correctly rebuild when their mapped providers change.
- The dict mapping semantics remain intact and deterministic.

### Risks

- If the synthetic dict keys collide with user-provided keys, we could clobber inputs.
- If the receiving rule treats dict keys specially, adding synthetic keys could have unintended effects.

### Consequence of Not Implementing

- Some Node targets silently stop invalidating on importer patch changes or provider mapping changes.

### Downsides for Implementing

- Adds one more shared helper surface for dict-shaped inputs.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `//build-tools/lang` and `//build-tools/node`. Should be safe in thin slices that include these packages and the relevant test fixtures.

---

## PR‑2: Strengthen planner-visible stubs for non-standard artifacts (C++ Emscripten, and similar)

### Description

We have at least one planner-visible stub in C++ (`nix_cpp_wasm_emscripten_lib`) that currently carries deps and labels, but not patch inputs or provider edge realization. That makes the stub weaker than other planner-facing nodes and creates drift in how “planner visibility” behaves across languages and artifact shapes.

This PR tightens the stub contract. A planner-visible stub should carry:

1. labels for routing, 2) graph edges, and 3) any patch inputs needed to drive invalidation.

### Scope & Changes

- Update `build-tools/cpp/defs.bzl:nix_cpp_wasm_emscripten_lib`:
  - include package-local patch files as inputs (via `include_package_local_patches` into a supported attribute)
  - realize provider edges deterministically (using `realize_provider_edges(...)`)
  - keep the stub artifact shape unchanged (still a stamp)
- Add a shared helper or documented pattern in `//build-tools/lang` for “planner stub with patch inputs” so we do not repeat this in each language:
  - either add an optional `srcs` parameter to `planner_stub` usage consistently
  - or add a wrapper in `//build-tools/lang` that produces a patch-carrying stub safely for rules that only accept limited attrs
- Audit other planner-visible stubs:
  - confirm Go `nix_go_carchive` and Python WASM stubs already carry patch inputs and provider edges as intended
  - migrate any remaining stub shapes that omit patch inputs

### Tests (in this PR)

- Extend an existing C++ macro test to assert:
  - `nix_cpp_wasm_emscripten_lib` includes patch files as explicit inputs
  - provider edges are realized deterministically
  - the generated node remains a planner-facing stamp target (no new build rule semantics)
- Add a Starlark probe test that instantiates a “stub with patches” pattern and asserts the patch glob expansion is present.

### Docs (in this PR)

- Update the planner-visible stub section in the build design docs:
  - planner stubs must carry patch inputs when patches drive invalidation for that target
  - stubs must realize provider edges consistently, unless explicitly filtered for planner-only deps

### Acceptance Criteria

- Editing a C++ package-local patch file invalidates `nix_cpp_wasm_emscripten_lib` reverse deps deterministically.
- Planner-visible stubs across languages follow a single, documented contract.

### Risks

- If a stub cannot accept `srcs` (or the chosen input attribute), we may need a helper target indirection.

### Consequence of Not Implementing

- Planner-visible behavior remains inconsistent for non-standard artifact shapes.

### Downsides for Implementing

- Small macro churn and test fixture updates.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `//build-tools/cpp` and `//build-tools/lang` with narrow changes plus tests.

---

## PR‑3: Unify Python exporter lockfile/importer discovery with shared importer utilities

### Description

Python provider sync uses shared importer conventions (`computeImporterLabel`) while the exporter adapter currently discovers `uv.lock` by walking up directories. These two mechanisms can drift. Drift here is subtle. It looks like “exporter attached lockfile label A, provider sync generated provider for importer B”.

This PR makes exporter and provider sync share one source of truth for:

- how to find the effective lockfile for a target
- how to derive importer label from the lockfile path

### Scope & Changes

- Add a shared helper in `build-tools/tools/lib/importers.ts` (or `build-tools/tools/lib/lockfiles.ts`):
  - `findNearestUvLockForPackage(pkgDir)` returning a repo-relative `uv.lock` path or null
  - keep it path-posix normalized and deterministic
- Update `build-tools/tools/buck/exporter/lang/python.ts`:
  - replace its local directory-walk logic with the shared helper
  - keep existing behavior for sparse checkouts and missing lockfiles (best-effort)
- Ensure that the exporter’s attached lockfile labels remain in the canonical form `lockfile:<path>#<importer>`.

### Tests (in this PR)

- Add a zx test that:
  - constructs a small temp repo layout with nested packages and a `uv.lock`
  - asserts both the shared helper and exporter adapter pick the same lockfile path and importer label
- Add a regression test that ensures:
  - for a package under `apps/*` or `libs/*`, the importer label matches the lockfile directory

### Docs (in this PR)

- Update Python integration docs to state:
  - exporter and provider sync use the shared importer utilities
  - the importer label definition for Python is lockfile directory, with `.` reserved for repo root

### Acceptance Criteria

- Python exporter and Python provider sync compute the same importer labels for the same repo layout.
- Exported `lockfile:` labels match the provider generator expectations.

### Risks

- If repo layouts rely on non-standard lockfile placement, the unified logic may surface existing inconsistencies.

### Consequence of Not Implementing

- Lockfile label drift remains a latent source of invalidation and wiring bugs.

### Downsides for Implementing

- Minor refactor that touches both exporter and shared utilities.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `build-tools/tools/lib` and `build-tools/tools/buck/exporter`. Should be safe in thin slices that include the exporter.

---

## PR‑4: Normalize `nixpkg:` semantics across Starlark, TypeScript, and Nix with a single test matrix

### Description

We normalize nixpkgs attrs in three places:

- Starlark labeling (`//build-tools/lang:nixpkg_labels.bzl`)
- TypeScript provider naming and label mapping (`build-tools/tools/lib/provider-names.ts` and `build-tools/tools/lib/labels.ts`)
- Nix planner/template resolution (`build-tools/tools/nix/lib/lang-helpers.nix` and C++ helpers)

This is mostly aligned, but it is easy to regress. Small differences (prefix handling, aliasing, lowercasing, historical `gtest` behavior) create “labels map to provider name that does not exist” failures.

This PR codifies a single shared contract and backs it with a parity test matrix.

### Scope & Changes

- Define a shared contract doc for `nixpkg:` normalization:
  - trimming
  - lowercasing
  - ensuring `pkgs.` prefix
  - alias mapping and the `gtest` compatibility rule
- Align implementations as needed so the contract matches:
  - `//build-tools/lang:nixpkg_labels.bzl:normalize_nix_attr`
  - `build-tools/tools/lib/provider-names.ts:normalizeNixAttr`
  - Nix-side resolution helpers used by templates and planners
- Add a parity test matrix:
  - same input strings produce the same normalized `pkgs.*` string across TS and Starlark
  - and a stable provider name across TS

### Tests (in this PR)

- Add a zx test that runs:
  - a Starlark probe target for normalization
  - the TS normalization function
  - compares outputs for a matrix of representative inputs:
    - `zlib`, `pkgs.zlib`, `pkgs.zlib`
    - `gtest`, `pkgs.gtest`, `pkgs.googletest`
    - nested attrs like `pkgs.gnome.glib`
- Add a wiring test that ensures `providersForLabels(["nixpkg:<x>"])` matches the provider target naming scheme used by generated provider files.

### Docs (in this PR)

- Update the nixpkg provider and labeling docs:
  - declare the normalization contract as part of the public interface
  - point contributors at the parity test for future edits

### Acceptance Criteria

- The same nixpkg input normalizes identically across Starlark and TS.
- Generated provider names are stable and match label mapping.
- The parity test catches regressions when any side changes.

### Risks

- Some historical inputs may change normalization. If so, I should either add alias entries or treat them as explicit breaking changes.

### Consequence of Not Implementing

- Cross-language drift in `nixpkg:` remains possible and will show up as sporadic provider wiring failures.

### Downsides for Implementing

- Adds a cross-language parity test that is more involved than a single-unit test.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `//build-tools/lang` and `build-tools/tools/lib` plus tests. Avoids changes to large language templates.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and by “correctness first”:

1. PR‑1 fixes a correctness gap for Node invalidation with dict-shaped `srcs`.
2. PR‑2 strengthens planner stubs to carry patch inputs and provider edges consistently for non-standard artifact shapes.
3. PR‑3 unifies Python importer/lockfile derivation so exporter and provider sync cannot drift.
4. PR‑4 codifies and tests `nixpkg:` normalization parity across Starlark and TS.

---

## Verification & Backout Strategy

Each PR should include:

- Probe tests for the shared helper surface added or changed.
- At least one real call-site regression test in a language macro or exporter adapter.
- Documentation updates limited to the exact contract being tightened.

Backout strategy:

- Each PR is independently revertible.
- If a regression appears, revert the PR and keep the new tests only if they still reproduce the issue and still compile. Otherwise revert tests together with the code change.
