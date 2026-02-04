# Quad Alignment Plan — Close Remaining Valuable Abstraction Gaps (CPP / Go / PNPM / Python) — Part 40

This installment follows Part 39, but adjusts the plan based on current repo reality:

- Package-local WASM wiring is already on the **non-mutating helper boundary** pattern (`lang/wasm_package_local_wiring.bzl:prepare_package_local_wasm_wiring(...)` plus mutation probes), so we do **not** need a PR dedicated to “make WASM wiring non-mutating”.
- The Nix planner already routes some key transforms through the canonical helper surface (`build-tools/tools/nix/lib/lang-helpers.nix`), so the remaining planner work is about eliminating the _last_ locally re-implemented target/label parsing and making the “fallback” path obey the same canonical transforms.
- We already have several enforcement tests for “don’t bypass helper surfaces”; the remaining valuable work is to (a) finish standardizing macro entrypoint conventions across languages, and (b) remove remaining legacy surfaces once enforcement proves they are unused.

After re-reviewing the codebase with the contract inventory in `abstractions.md`, the remaining **valuable** (non-polish) gaps are:

- A concrete **contract duplication risk** in the Nix planner: some target/label parsing and “selected target” fallback logic re-implements normalization instead of routing through the canonical Nix helper surface.
- A concrete **debuggability/correctness gap** in invalidation diagnostics: `invalidation-report` is already strong, but it still has at least one misclassification risk (dict-shaped patch inputs) and a small amount of heuristic coupling around global Nix input stamping that can be made more contract-driven.
- A remaining **authoring drift** gap: macro entrypoints are mostly consistent, but we should standardize the call-site conventions across languages and remove legacy helper exports once we can prove (with enforcement) that no call sites use them.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Remove remaining planner-local target/label parsing duplication and route through the canonical Nix helper surface (including “selected target” fallback)

### Description

The Nix planner (`build-tools/tools/nix/graph-generator.nix`) already imports `build-tools/tools/nix/lib/lang-helpers.nix` and uses canonical helpers for several key transforms (sanitization, target→attr suffix).

However, there is still planner-local logic that effectively re-implements parts of the “canonical label normalization” and package-path derivation surface (especially in the `BUCK_TARGET` “selected target” path and helper functions like `pkgPathOf` / “cell stripping”).

This is a slow-burn abstraction leak: it is correct today, but small differences here can rename flake attrs, mis-resolve package paths, or make fallback behavior diverge from the exporter/macro worldview.

This PR eliminates remaining planner-local normalization logic and routes it through `build-tools/tools/nix/lib/lang-helpers.nix` (and/or `build-tools/tools/nix/planner/lib.nix` when the helper is planner-only), keeping behavior identical.

### Scope & Changes

- Refactor `build-tools/tools/nix/graph-generator.nix`:
  - Remove (or minimize) planner-local implementations of:
    - target label normalization (cell prefix + config suffix stripping)
    - package path derivation from a target label
  - Route those transforms through a single canonical helper surface:
    - Use `build-tools/tools/nix/lib/lang-helpers.nix:normalizeTargetLabel` and `sanitizeAttrNameFromTargetLabel` everywhere the planner builds keys or selects nodes.
    - Add a small **planner-only** helper (either in `build-tools/tools/nix/lib/lang-helpers.nix` or `build-tools/tools/nix/planner/lib.nix`) for “package path from normalized target label” so the planner does not hand-roll `split(":")` / `split("//")` repeatedly.
  - In the `BUCK_TARGET` “selected target” path:
    - Replace ad-hoc `dropCell` / `canon` logic with canonical normalization.
    - Keep behavior identical (including current error messages and the existing fallback branches), but ensure normalization and package-path derivation uses the canonical helpers.

Non-goals in this PR:

- No change to which targets are included/excluded in planner outputs.
- No change to language adapter semantics (Go/C++/Node/Python planner plugins) beyond swapping out duplicated normalization helpers.

### Tests (in this PR)

- Extend/add a Nix↔TS parity test specifically for the “target label normalization” matrix used by the planner:
  - Ensure canonical normalization remains aligned for:
    - cell prefixes (`root//...`)
    - config suffixes (` (config//...)`)
    - representative `//apps/*` / `//libs/*` labels
- Add/extend a small fixture-based planner test that asserts:
  - the planner’s “flat attrset keying” remains stable for a representative fixture graph (no attr renames)
  - `BUCK_TARGET` selection still resolves the same target for representative inputs (including cell-prefixed and config-suffixed forms)

### Docs (in this PR)

- Update `abstractions.md` (under the target-label normalization / nix-attr contract) to explicitly state:
  - `build-tools/tools/nix/graph-generator.nix` must not re-implement target normalization or package-path derivation from labels; it must route through the canonical Nix helper surface.
  - Link to the parity/fixture tests added/extended in this PR as regression guards.

### Acceptance Criteria

- `build-tools/tools/nix/graph-generator.nix` no longer hand-rolls target/label normalization and package-path parsing in multiple places.
- Planner outputs remain identical for existing targets (no attr renames, no output shape changes).
- Parity/fixture tests fail if the planner normalization drifts from the canonical contract.

### Risks

Moderate. The change is mechanical, but the planner is high-impact and small normalization differences can rename flake attrs or change selection behavior.

Mitigation:

- Keep changes limited to swapping implementations, not changing algorithms.
- Add a small fixture test that would detect accidental attr renames.

### Consequence of Not Implementing

Eventually, one layer fixes/changes a normalization edge case and the planner drifts silently. This tends to surface as confusing cache misses and “why did this attr move?” failures that are hard to diagnose.

### Downsides for Implementing

Minor churn in the planner and one shared helper module; adds a small parity/fixture test surface.

### Recommendation

Implement.

---

## PR‑2: Tighten invalidation diagnostics so patch inputs and global Nix inputs are classified correctly (especially for dict-shaped inputs), and lock behavior with outcome-based tests

### Description

We already have strong “what invalidates what?” tooling:

- `build-tools/tools/buck/invalidation-report*` emits a contract-vocabulary report.
- `build-tools/tools/buck/prebuild/*` prints concise patch invalidation notes and guardrails.

However, `invalidation-report` still has two concrete risks:

- **Dict-shaped patch inputs** are currently classified under importer-local observation unconditionally (via the `__patch_inputs__/` prefix), even when the target is package-local. This can mislead debugging.
- **Global Nix inputs stamping** is currently detected via a label heuristic (`//:flake.lock` in labels). The contract is that macros should avoid hardcoding global inputs at call sites and attach them as action inputs; the report should be primarily driven by **action-input observation** (and treat labels as observability-only).

This PR refines the report so it is harder to misread, without changing any underlying invalidation behavior.

### Scope & Changes

- Update `build-tools/tools/buck/invalidation-report-row.ts`:
  - When `srcs`/`nix_inputs` are dict-shaped:
    - classify `__patch_inputs__/...` observations based on the target’s `patch_scope` (package-local vs importer-local), not unconditionally as importer-local
    - classify `__global_nix_inputs__/...` as the primary signal of global inputs presence in dict-shaped wiring (mirrors the shared dict-prefix contract)
  - Prefer action-input presence as the primary signal for:
    - `global_nix_inputs_action_inputs_expected`
    - `global_nix_inputs_action_inputs_observed_in`
  - Treat label stamping (`global_nix_inputs_labels_stamped`) as **secondary/observability** and avoid coupling correctness to label stamps.

- Tighten report wording/format (if needed) to make the “diagnostic vs real inputs” distinction unavoidable while keeping output stable and concise.

Non-goals in this PR:

- No changes to macro wiring, provider generation policy, or patch inclusion policy.
- No changes to the patch models (package-local vs importer-local).

### Tests (in this PR)

- Extend existing invalidation report tests to assert the critical invariants (focused assertions, not full golden blobs):
  - importer-local targets report patch inputs as expected+observed in the correct attribute shape (`srcs(list)`, `srcs(dict)/__patch_inputs__`, or `deps/*__patch_inputs` where applicable)
  - package-local targets report patch inputs as expected+observed under the correct scope (including dict-shaped forms when a macro uses dict-safe attachment)
  - global Nix inputs classification is driven by action input observation (`srcs`/`nix_inputs` list or dict prefixes), not by labels alone
- Keep/extend one representative cquery/probe-based test per model (if not already present):
  - Node: importer-local patches are present as action inputs for a representative macro with dict-shaped `srcs`
  - Go or C++: package-local patches are present as action inputs for a representative macro

### Docs (in this PR)

- Update `abstractions.md` under “Diagnostics (how to answer ‘what invalidates what?’)” to:
  - explicitly state that label stamps are observability-only
  - state that the report’s “observed action inputs” classification is the source of truth
  - link to the updated outcome-based tests

### Acceptance Criteria

- `invalidation-report` makes it easy to answer “what invalidates this target?” without inspecting provider metadata or macro code.
- Dict-shaped patch input attachment is classified under the correct patch scope.
- Outcome-based tests fail if patch inputs or global inputs stop being real action inputs for representative targets.
- No behavior changes to builds/tests; diagnostics only.

### Risks

Low. Primarily reporting changes and test assertions.

Mitigation:

- Keep tests outcome-based and focused on key fields/sections (avoid brittle full-text matches).

### Consequence of Not Implementing

People will continue to misdiagnose invalidation issues (especially for Node/Python) and waste time chasing provider metadata or misreading dict-shaped attachments.

### Downsides for Implementing

Small increase in test surface area and slightly refined developer-facing diagnostics.

### Recommendation

Implement.

---

## PR‑3: Standardize Starlark macro entrypoint conventions across languages, tighten enforcement against helper bypass drift, and remove legacy helper exports once unused

### Description

The core abstraction boundary is the shared helper surface in `//lang:*` (re-exported via `//lang:defs_common.bzl`). The repo already has enforcement tests that prevent several bypass patterns.

The remaining valuable work is:

- Make macro entrypoints across languages follow the same authoring conventions (so future additions don’t reintroduce drift).
- Tighten the allowlisted enforcement to cover the full set of macro entrypoints and the highest-signal bypass patterns.
- Remove remaining “legacy” helper exports once enforcement proves they are unused, shrinking the surface area and preventing “two ways to do the same thing.”

### Scope & Changes

- Standardize conventions in macro entrypoint files (mechanical, no semantic change):
  - **Single labels merge point**: assemble/normalize labels once, then pass through shared helpers.
  - **Single deps merge point**: assemble base deps once; provider edge realization happens only via shared helpers.
  - Prefer non-mutating v2 helpers for importer-scoped macros and non-mutating package-local helpers for Go/C++.

- Apply this standardization across the language macro entrypoints (adjust list to current repo reality):
  - `build-tools/go/defs.bzl`
  - `build-tools/cpp/defs.bzl` (and any `cpp/defs_*.bzl` entrypoints)
  - `build-tools/node/defs_core.bzl`, `build-tools/node/defs_nix.bzl`
  - `build-tools/python/defs.bzl`

- Tighten enforcement (allowlisted to macro entrypoints and/or all non-`//lang/*` Starlark code, depending on what is already enforced):
  - Disallow `_legacy_mutating` helper usage outside `//lang/*`.
  - Disallow direct loads of low-level parsing helpers (e.g., `//lang:lockfile_labels.bzl`) from macro entrypoints when a dedicated wiring helper exists (must route via importer wiring surfaces).
  - Disallow bypassing package-local wiring surfaces (for example, calling low-level `pop_*` helpers directly at macro boundaries) when `prepare_package_local_wiring(...)` exists.

- Once enforcement proves no call sites use them:
  - remove re-exports of legacy mutating helpers from `lang/defs_common.bzl`
  - (optional, depending on current usage) remove or quarantine the legacy helper implementations themselves

Non-goals in this PR:

- No changes to label vocabulary or provider mapping policy.
- No changes to patch invalidation behavior.

### Tests (in this PR)

- Extend the existing enforcement suite (or add a narrow allowlisted one) so it fails if:
  - any macro entrypoint references `_legacy_mutating` helpers
  - macro entrypoints directly load low-level parsing helpers instead of routing through the shared wiring helpers
- Extend outcome-based probes/cquery tests (or re-run existing ones as part of the PR’s acceptance verification) to ensure the mechanical refactors did not regress:
  - `patch_scope` stamping remains correct (`package-local` vs `importer-local`)
  - importer-local patch inputs remain real action inputs (including dict-shaped cases)
  - package-local patch inputs remain real action inputs
  - importer-scoped Nix-calling macros keep global Nix inputs attached as real action inputs (list and dict shapes)

### Docs (in this PR)

- Update `docs/handbook/conventions.md` (or the nearest existing conventions page) to document the two conventions:
  - single labels merge point
  - single deps merge point
- Update `docs/handbook/adding-language.md` with a short “macro author checklist” that:
  - points to `//lang:defs_common.bzl` as the only intended helper surface
  - references the enforcement tests added/extended in this PR

### Acceptance Criteria

- Macro entrypoint call sites follow consistent conventions across languages (no semantic changes).
- Enforcement prevents reintroducing the known bypass patterns.
- Legacy helper exports are removed from `lang/defs_common.bzl` once unused.
- Outcome-based tests prove stamping and action-input invariants are unchanged.

### Risks

Moderate. Mechanical refactors can accidentally change ordering/dedupe behavior and cause subtle rule key drift.

Mitigation:

- Keep refactors small, one file at a time.
- Rely on outcome-based tests that assert the invariants that matter (action inputs + stamping).

### Consequence of Not Implementing

The system remains correct today, but future macro additions (or adding another language) will have a higher chance of reintroducing drift by copying an outdated pattern.

### Downsides for Implementing

Some churn across macro files and a small amount of enforcement/test scaffolding. The payoff is a smaller surface area and lower long-term drift risk.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and to keep each PR revertible:

1. **PR‑1 first**: planner normalization cleanup; lock it with parity/fixture tests.
2. **PR‑2 next**: invalidation-report correctness/clarity; lock it with outcome-based tests.
3. **PR‑3 last**: macro entrypoint standardization + enforcement tightening + legacy export removal once unused.

---

## Verification & Backout Strategy

Each PR includes:

- at least one focused outcome-based test (probe/cquery or structured JSON assertions) that asserts action-input and stamping invariants
- a documentation update that uses the shared contract vocabulary (`patch_scope:*`, `lockfile:*`, `nixpkg:*`, `lang:*`, `kind:*`, `kind:wasm`, `wasm:<variant>`)

Backout strategy:

- **PR‑1** can be reverted independently by restoring planner-local normalization helpers and removing any newly introduced canonical helper functions, keeping the tests as the detector for future drift.
- **PR‑2** can be reverted independently by reverting reporting changes and associated test assertions.
- **PR‑3** can be reverted independently by reverting macro entrypoint mechanical refactors and relaxing enforcement; legacy exports can be reintroduced temporarily if needed while migrating remaining call sites.
