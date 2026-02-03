## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 25

This installment follows Part 24. Part 24 focused on Node Nix-calling macros and Nix command assembly. In Part 25 I close the remaining cross-language abstraction gaps I still see after parity:

- Python importer-scoped macros still hand-assemble wiring that is already centralized in `//lang:importer_wiring.bzl`.
- “Macro calls Nix” global-input wiring is not consistently expressed through the single helper surface (`//lang:nix_calling_macros.bzl:wire_global_nix_inputs(...)`) across call sites.
- The importer-scoped vs package-local patch models are intentional, but it is still easy to partially apply the contract (especially in new macros). I want enforcement tests that fail when call sites bypass the canonical helper surfaces.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Refactor Python importer-scoped macros to use shared importer-scoped non-genrule wiring

### Description

Python is an importer-scoped ecosystem (uv). The macro contract for importer-scoped targets is already centralized in `//lang:importer_wiring.bzl:prepare_importer_non_genrule_wiring(...)`:

- exactly one `lockfile:<path>#<importer>` label
- deterministic importer derivation
- importer-local patch inputs attached to action inputs (list and dict shapes)
- provider edges merged deterministically
- stable error text (through `ensure_single_lockfile_label(...)`)

Today, `python/defs.bzl` repeats these steps directly (stamping, lockfile enforcement, patch input attachment, provider merge). This is correct but it increases drift risk when the contract changes.

This PR removes that duplication and makes Python macros depend on the same shared helper surface used by other importer-scoped macros.

### Scope & Changes

This PR changes Python macro wiring only. The goal is behavior stability and contract consolidation.

- Refactor `python/defs.bzl:nix_python_library` to:
  - delegate lockfile enforcement and importer derivation to `prepare_importer_non_genrule_wiring(...)`
  - attach importer-local patches through the helper surface
  - keep provider edges merged deterministically via the helper surface (default into deps)
  - keep existing nixpkg label behavior unchanged
- Refactor `python/defs.bzl:nix_python_test` and `python/defs.bzl:nix_python_wasm_*` similarly.
- Keep `python/defs.bzl:nix_python_binary` behavior intact:
  - `python_binary` does not accept `srcs`, so patch inputs must remain carried via a synthetic dep.
  - This PR may still use `prepare_importer_non_genrule_wiring(...)` for the parts that apply (lockfile enforcement, label stamping, provider deps), but it must not change the existing “patch dep” modeling unless tests prove equivalence.

### Tests (in this PR)

I will add or extend tests that assert the macro-visible behavior and lock down the common failure modes:

- Extend importer wiring probe tests to cover Python macros:
  - `nix_python_library` includes importer-local patches as action inputs when the rule shape allows it.
  - `nix_python_binary` includes importer-local patches via the synthetic dep path (and still invalidates deterministically on patch edits).
- Add a focused macro expansion test that asserts:
  - `nix_python_*` macros fail with the same deterministic error text when the lockfile label is missing or malformed.
  - importer derivation remains stable for `lockfile:././apps/foo/uv.lock#apps/foo`.
- Keep existing provider sync golden tests unchanged (this PR does not change provider generation), but add one check that Python macros still realize provider edges from `MODULE_PROVIDERS` in the expected attribute (`deps` unless the rule shape forces otherwise).

### Docs (in this PR)

I will update docs where Python macros are described so they point at the canonical helper surface rather than re-describing wiring rules:

- `docs/handbook/patching.md` and/or `docs/handbook/adding-language.md`:
  - note that Python importer-scoped macros use `prepare_importer_non_genrule_wiring(...)` as the canonical wiring path
  - clarify the exception case for `python_binary` (patch inputs carried via a synthetic dep because the underlying rule does not accept `srcs`)
- `abstractions.md`:
  - update the Python macro callouts to reference the shared helper surface as the canonical implementation

### Acceptance Criteria

- `python/defs.bzl` no longer hand-assembles importer-scoped wiring for library/test/WASM macros.
- Python importer-scoped macros enforce the lockfile label contract via `prepare_importer_non_genrule_wiring(...)`.
- Tests prove:
  - importer-local patches remain real action inputs for Python targets (including the synthetic-dep path for binaries)
  - lockfile contract failures remain deterministic
  - provider edges are still realized deterministically

### Risks

Moderate. The main risk is accidentally changing which attribute receives patch inputs or provider edges, especially for rule shapes that do not accept `srcs`.

### Consequence of Not Implementing

Python remains a drift point. Contract changes in `//lang:importer_wiring.bzl` will require manual “keep in sync” edits in `python/defs.bzl`.

### Downsides for Implementing

Macro churn and test updates. The payoff is one canonical wiring path for importer-scoped ecosystems across languages.

### Recommendation

Implement.

---

## PR‑2: Standardize “macro calls Nix” global-input wiring on `wire_global_nix_inputs(...)`

### Description

Some macros shell out to Nix. Those actions must be invalidated by the centralized global input set (`global_nix_inputs()`), and call sites should not have to remember the policy details (list vs dict shapes, key prefixing, optional label stamping).

The canonical helper already exists: `//lang:nix_calling_macros.bzl:wire_global_nix_inputs(kwargs, into=..., stamp=...)`.

Today, some call sites use `attach_global_nix_inputs(...)` directly. That is correct, but it makes future policy changes harder and increases the chance of inconsistent stamping vs action inputs.

This PR moves Nix-calling macros onto the single helper surface.

### Scope & Changes

- Refactor Nix-calling macros to use `wire_global_nix_inputs(...)` instead of calling `attach_global_nix_inputs(...)` directly.
  - Keep current behavior on whether stamping happens by default (stamp stays enabled unless the macro already intentionally avoids label stamping).
- Keep the underlying `global_inputs` contract unchanged. This PR is about call-site consistency, not policy change.

### Tests (in this PR)

I will keep tests focused on invariants rather than exact string equality:

- Extend existing “global inputs are real action inputs” tests to cover any refactored macros:
  - list-shaped action inputs (typical `srcs`)
  - dict-shaped action inputs (when a macro uses dict `srcs`)
- Add one test that fails if a Nix-calling macro:
  - stamps global inputs but does not attach them as real action inputs
  - attaches global inputs but forgets to stamp when the macro’s contract says `stamp=True`

### Docs (in this PR)

- `docs/handbook/macro-stamping-cookbook.md`:
  - document `wire_global_nix_inputs(...)` as the canonical way to wire global inputs for Nix-calling macros
  - include one concrete example for a list-shaped macro and one for a dict-shaped macro
- `build-tools/docs/build-system-design.md`:
  - point at `wire_global_nix_inputs(...)` as the implementation surface for the global-input policy

### Acceptance Criteria

- Nix-calling macros use `wire_global_nix_inputs(...)` rather than calling `attach_global_nix_inputs(...)` directly.
- Tests prove that global Nix inputs are still real action inputs, and that stamping behavior is consistent with the macro’s contract.

### Risks

Low. The main risk is changing default stamping behavior unintentionally.

### Consequence of Not Implementing

We keep multiple call-site patterns for the same policy. This increases the chance of future drift (labels vs action inputs) and makes reviews harder.

### Downsides for Implementing

Small churn across macro files. Some test expectation updates.

### Recommendation

Implement.

---

## PR‑3: Add enforcement tests to prevent importer-scoped and patch-model contract drift

### Description

There are two intentional patch invalidation models:

- package-local patching (Go, C++)
- importer-local patching (Node, Python)

Both models are correct, but it is still easy to partially apply the contract in new macros, especially:

- forgetting lockfile label enforcement for importer-scoped macros
- forgetting to attach patch inputs as real action inputs (list vs dict shapes)
- hand-rolling provider edge wiring rather than using shared helpers

This PR adds enforcement tests that fail when these mistakes happen.

### Scope & Changes

- Add or extend tests that assert macros route through the canonical helper surfaces:
  - importer-scoped macros should use `prepare_importer_genrule_kwargs(...)` or `prepare_importer_non_genrule_wiring(...)` (directly or via `//lang:defs_common.bzl` re-exports)
  - package-local patching macros should use `include_package_local_patches(...)` (or planner-visible wrappers that include package-local patch inputs)
- Add one or two “probe-style” targets and tests that assert the final cquery-visible inputs contain:
  - importer-local patches for importer-scoped macros
  - package-local patches for package-local macros
  - provider edges realized deterministically in the intended attribute (`deps` vs `srcs`)

This PR should not change macro behavior. It is guardrail-only, but it ships with docs describing the guardrail contract and what to do when it fails.

### Tests (in this PR)

- Add a test that scans macro sources and fails when a macro that claims importer-scoped behavior:
  - calls `ensure_single_lockfile_label(...)` and `importer_from_labels(...)` directly instead of delegating to the shared wiring helpers, unless explicitly justified by rule-shape constraints.
- Add cquery-based probe tests that validate:
  - importer-local patches appear as real action inputs for a representative Node macro, and a representative Python macro
  - package-local patches appear as real action inputs for a representative Go macro, and a representative C++ macro

### Docs (in this PR)

- `abstractions.md`:
  - add a short “enforcement” subsection under the importer-scoped wiring and patch invalidation contracts that links to the new tests and explains the failure mode.
- `docs/handbook/adding-language.md`:
  - add a checklist item: new importer-scoped macros should use the shared helper surface and should be covered by the enforcement tests.

### Acceptance Criteria

- We have at least one enforcement test that fails when importer-scoped wiring bypasses the canonical helper surfaces.
- We have at least one probe test per patch model (importer-local, package-local) that asserts patch inputs are present as action inputs.
- Docs point at the tests as the authoritative contract enforcement mechanism.

### Risks

Low to moderate. The main risk is writing tests that are too brittle (string matching on implementation details) rather than asserting invariants.

### Consequence of Not Implementing

The abstractions remain correct today, but regressions become easy: new macros can “almost follow” the contract and still appear to work until a patch or lockfile edge case shows up.

### Downsides for Implementing

More guardrail tests. Some upfront maintenance cost when refactors legitimately change call sites.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and by how isolated the changes are:

1. PR‑1 first. Python wiring refactor reduces duplication and establishes the canonical call path.
2. PR‑2 next. Standardizes Nix-calling global-input wiring across call sites without changing policy.
3. PR‑3 last. Adds enforcement tests after the refactors, so the tests lock down the intended helper surfaces.

---

## Verification & Backout Strategy

Each PR includes:

- at least one focused test that asserts the relevant macro contract behavior
- a doc update that points at the canonical helper surface and describes the contract in the same language used by tests

Backout strategy:

- Each PR is independently revertible.
- If PR‑3 tests are too brittle, I will keep PR‑1 and PR‑2 and iterate on PR‑3 until the tests assert invariants rather than implementation details.
