# Quad Alignment Plan — Close Remaining Valuable Abstraction Gaps (CPP / Go / PNPM / Python) — Part 39

This installment follows Part 38, but with one important update from the current repo state:

- Package-local WASM wiring is already on the **non-mutating helper boundary** pattern (`build-tools/lang/wasm_package_local_wiring.bzl:prepare_package_local_wasm_wiring(...)` uses `extract_*`, returns a prepared `kwargs`, and has a mutation probe). So we do **not** need a PR dedicated to “make WASM wiring non-mutating” anymore.

After re-reviewing the codebase with the contract inventory in `abstractions.md`, the remaining **valuable** (non-polish) gaps are:

- A concrete **contract duplication** risk in the Nix planner (`build-tools/tools/nix/graph-generator.nix`) where “canonical transforms” are re-implemented locally instead of importing the shared helper surface.
- A concrete **debuggability gap** around the intentionally different patch invalidation models (package-local vs importer-local). The code is correct, but the system is still easy to misread when you inspect only provider metadata.
- A remaining **authoring drift** gap: macro entrypoints across languages are mostly consistent, but we should standardize the call-site conventions and add narrow enforcement to prevent bypassing the shared helper surfaces.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Remove duplicated “contract logic” in the Nix planner and route through the canonical Nix helper surface

### Description

We already treat some cross-language transforms as contracts with canonical implementations and parity tests (sanitization, patch filename decoding, nixpkgs attr normalization, lockfile label parsing rules, target-label normalization).

However, `build-tools/tools/nix/graph-generator.nix` still locally re-implements at least one of these transforms (notably a `sanitize = replaceStrings [...]` helper). That’s a classic slow-burn leak: it’s correct today, but drift here causes confusing cache/key divergence and makes it harder to reason about cross-layer parity.

This PR removes the duplicated logic from the planner and uses `build-tools/tools/nix/lib/lang-helpers.nix` as the canonical implementation on the Nix side.

### Scope & Changes

- Refactor `build-tools/tools/nix/graph-generator.nix`:
  - Replace any local “sanitizeName-style” logic with `build-tools/tools/nix/lib/lang-helpers.nix:sanitizeName`.
  - Where the planner needs “target label → safe attr suffix”, use a single canonical helper rather than re-implementing it inline:
    - Add `sanitizeAttrNameFromTargetLabel(...)` to `build-tools/tools/nix/lib/lang-helpers.nix` (mirroring the existing contract in TypeScript and Starlark), then update the planner to call it.
  - Keep behavior identical:
    - No change to flake outputs.
    - No change to attr names produced for existing targets.
    - No change to which targets are included/excluded in graph outputs.

Non-goals in this PR:

- No behavior changes to the language adapters (Go/C++/Node/Python) beyond replacing duplicated helpers with imports.
- No rework of the planner’s “selected target” fallback logic (that is handled in a separate PR if we decide it’s necessary).

### Tests (in this PR)

- Add a parity test that proves the planner’s Nix “target → attr suffix” helper matches the canonical contract:
  - TS (`build-tools/tools/lib/labels.ts:sanitizeAttrNameFromLabel`) vs Nix (`build-tools/tools/nix/lib/lang-helpers.nix:sanitizeAttrNameFromTargetLabel`).
  - Include a small matrix: cell prefixes, config suffixes, mixed punctuation, and representative `//apps/*` / `//libs/*` labels.
- Add (or extend) an integration-ish planner test that asserts the exported “flat attrset keying” remains stable for a small fixture graph.

### Docs (in this PR)

- Update `abstractions.md`:
  - Add a short note under the relevant contract section that the Nix planner must not re-implement sanitizer / attr-suffix derivation, and must import from `build-tools/tools/nix/lib/lang-helpers.nix`.
  - Link to the new parity test as the regression guard.

### Acceptance Criteria

- `build-tools/tools/nix/graph-generator.nix` no longer re-implements the canonical sanitizer logic; it imports and uses `build-tools/tools/nix/lib/lang-helpers.nix`.
- A parity test fails if TS/Starlark and Nix disagree on the attr-suffix derivation contract.
- Planner outputs remain identical for existing targets (no attr renames, no output shape changes).

### Risks

Low to moderate. The code change is mechanical, but the planner is high-impact and small differences in normalization can silently rename flake attrs.

Mitigation:

- Add parity tests and a small fixture-based planner test.
- Keep changes limited to swapping implementations, not changing algorithms.

### Consequence of Not Implementing

Eventually, one layer will change the “canonical” transform (or fix a bug) and the planner will quietly drift. That kind of drift tends to surface as confusing cache misses and “why did this attr move?” breakages.

### Downsides for Implementing

Minor churn in the planner and one shared helper module; adds one new parity test.

### Recommendation

Implement.

---

## PR‑2: Make patch invalidation diagnostics harder to misread (package-local vs importer-local), and lock the behavior with outcome-based tests

### Description

The system intentionally supports two patch invalidation models:

- Package-local (Go/C++): patch files are direct action inputs under `<pkg>/patches/<lang>`.
- Importer-local (Node/Python): patch files are direct action inputs under `<importer>/patches/<lang>`, while provider metadata is **diagnostic** and cannot represent cross-package patch inputs directly.

The build behavior is correct, but people still get tripped up when debugging invalidation by looking only at generated providers. We should tighten the “what invalidates what?” reporting so it uses contract vocabulary and makes the “diagnostic vs real inputs” distinction unavoidable.

### Scope & Changes

- Tighten `build-tools/tools/buck/invalidation-report*.ts` reporting:
  - For each target, clearly report:
    - `patch_scope` (from labels, or from the language contract fallback)
    - whether patch inputs are expected to be present as real action inputs (based on `patch_scope`)
    - where they are observed (list `srcs`, dict `srcs` `__patch_inputs__/...`, synthetic deps, etc.)
  - Ensure global Nix inputs reporting uses the canonical dict-prefix attachment model (not label-based heuristics).
  - Keep the report stable and deterministic (sorted output, stable sections).
- Tighten `build-tools/tools/buck/prebuild/*` messaging:
  - When lockfiles are present, print a single high-signal reminder that importer-local invalidation is driven by macro action inputs under `<importer>/patches/<lang>`.
  - Avoid verbosity; the goal is to prevent misreads, not spam logs.

Non-goals in this PR:

- No changes to the underlying invalidation behavior (no macro wiring changes, no provider model changes).
- No changes to provider generation policy (Node “all patches” vs Python “effective-set-only” remains as-is).

### Tests (in this PR)

- Extend the existing invalidation report tests to assert the critical invariants:
  - Importer-local targets report patch inputs as “expected” and “observed” in the correct attribute shape.
  - Package-local targets report patch inputs as “expected” and “observed” under `<pkg>/patches/<lang>`.
  - Provider `patch_paths` (when present) are treated as diagnostic and do not affect “observed action inputs” classification.
- Add/extend one representative cquery/probe-based test per model:
  - Node: importer-local patches are present as action inputs for a representative macro with dict-shaped `srcs`.
  - Go or C++: package-local patches are present as action inputs for a representative macro.

### Docs (in this PR)

- Update `abstractions.md`:
  - Strengthen the “Diagnostics” subsection under the patch model contract:
    - explicitly state that provider `patch_paths` are **observability** only for importer-scoped ecosystems
    - point to `invalidation-report` as the canonical “what invalidates what?” tool
  - Link to the outcome-based tests added/extended in this PR.

### Acceptance Criteria

- `invalidation-report` makes it easy to answer “what invalidates this target?” without reading provider files or macro code.
- Outcome-based tests fail if patch inputs stop being real action inputs for representative targets across both patch models.
- No behavior changes to builds/tests; this is observability + correctness assertions only.

### Risks

Low. This is primarily reporting and tests. The main risk is creating fragile tests that depend on incidental output formatting.

Mitigation:

- Keep tests outcome-based and focused on key fields/sections, not full-text golden blobs where possible.

### Consequence of Not Implementing

People will continue to misdiagnose invalidation issues (especially for Node/Python) and spend time chasing provider metadata instead of action inputs.

### Downsides for Implementing

Adds some test surface area and slightly refines developer-facing diagnostics.

### Recommendation

Implement.

---

## PR‑3: Standardize Starlark macro call-site conventions across languages and add narrow enforcement against helper bypass drift

### Description

The shared helper surfaces in `//build-tools/lang:*` are the core abstraction boundary that keeps cross-language behavior consistent. The system is correct today, but drift risk reappears whenever we add new macro shapes and people copy patterns.

We should standardize the macro entrypoint conventions and add a small, allowlisted enforcement suite that blocks the highest-signal bypass patterns.

### Scope & Changes

- Apply consistent conventions to each macro entrypoint file (mechanical, no semantic change):
  - **Single labels merge point**: assemble labels once, then pass them into shared helpers.
  - **Single deps merge point**: assemble base deps once; provider edge realization happens only via shared helpers.
- Standardize across these entrypoint files (adjust list to current repo reality):
  - `build-tools/go/defs.bzl`
  - `build-tools/cpp/defs.bzl`
  - `build-tools/node/defs_core.bzl`
  - `build-tools/node/defs_nix.bzl`
  - `build-tools/python/defs.bzl`
  - `build-tools/rust/defs.bzl` (if it participates in the same provider/label wiring contracts)
- Tighten “preferred helper surface” usage:
  - importer-scoped macros should go through `prepare_importer_*_wiring` v2-style helpers (non-mutating boundary) via `//build-tools/lang:defs_common.bzl`
  - package-local macros should go through `prepare_package_local_wiring(...)` via `//build-tools/lang:defs_common.bzl`
  - macros should not directly load low-level parsing helpers when a dedicated wiring helper exists
- Add narrow enforcement (allowlisted to these macro entrypoint files only):
  - Disallow calling any helper ending in `_legacy_mutating` outside `//build-tools/lang/*`.
  - Disallow direct loads of `//build-tools/lang:lockfile_labels.bzl` from macro entrypoints (must route via importer wiring surfaces).
  - Disallow direct calls to `pop_package_local_patch_dirs_and_nixpkg_deps(...)` from macro entrypoints.

Non-goals in this PR:

- No changes to label vocabulary.
- No changes to provider mapping, provider sync, or Nix invocation behavior.
- No broad renames of helper symbols.

### Tests (in this PR)

- Add one enforcement test that scans the allowlisted macro entrypoint files and fails on the bypass patterns above.
- Extend outcome-based tests to ensure we did not regress invariants during mechanical refactors:
  - patch_scope stamping remains correct (`package-local` vs `importer-local`)
  - importer-local patch inputs remain real action inputs for representative Node/Python targets
  - package-local patch inputs remain real action inputs for representative Go/C++ targets
  - importer-scoped Nix-calling macros keep global Nix inputs attached as real action inputs

### Docs (in this PR)

- Update `docs/handbook/conventions.md` (or the nearest existing conventions page):
  - document the two conventions (single labels merge point, single deps merge point)
  - include one short, real before/after snippet from an entrypoint macro file
- Update `docs/handbook/adding-language.md`:
  - add a concise “macro author checklist” that points to `//build-tools/lang:defs_common.bzl` surfaces and the enforcement test

### Acceptance Criteria

- Macro entrypoint call sites follow the same conventions across languages.
- Enforcement prevents reintroducing the known bypass patterns.
- Outcome-based tests prove stamping and action-input invariants are unchanged.

### Risks

Moderate. Mechanical refactors can accidentally change ordering/dedupe behavior and cause subtle differences in rule keys.

Mitigation:

- Keep refactors small, one file at a time.
- Use outcome-based tests (cquery/probes) that assert the invariants that matter.

### Consequence of Not Implementing

The system stays correct today, but the next wave of macros (or the next new language) will have a higher chance of “working by accident” and reintroducing drift.

### Downsides for Implementing

Some churn across macro files and a small amount of enforcement/test scaffolding.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and to keep each PR revertible:

1. PR‑1 first: eliminate the planner contract duplication and lock parity.
2. PR‑2 next: improve diagnostics and lock “what invalidates what?” understanding with outcome-based tests.
3. PR‑3 last: standardize macro authoring conventions and add enforcement once the contracts and diagnostics are in their best state.

---

## Verification & Backout Strategy

Each PR includes:

- at least one focused outcome-based test (probe/cquery) that asserts action-input and stamping invariants
- a documentation update that uses the shared contract vocabulary (`patch_scope:*`, `lockfile:*`, `nixpkg:*`, `lang:*`, `kind:*`, `kind:wasm`, `wasm:<variant>`)

Backout strategy:

- PR‑1 can be reverted independently by restoring the planner-local implementation and removing the new Nix helper (and its parity test).
- PR‑2 can be reverted independently by reverting the reporting/messaging changes and associated test assertions.
- PR‑3 can be reverted independently by reverting the macro call-site mechanical refactors and relaxing enforcement, then re-landing with a narrower allowlist if needed.
