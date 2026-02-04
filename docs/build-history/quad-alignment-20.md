## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 20

This installment follows Part 19. It closes the remaining seams we observed now that C++, Go, PNPM (Node), and Python have feature parity.

The intent is to keep the shared seams stable:

- Label contracts and normalizers remain identical across TypeScript, Starlark, and Nix.
- Importer-scoped ecosystems remain label-driven (Node + Python), with one supported importer set and consistent parsing and error surfaces.
- Exporter behavior only adds labels we can satisfy downstream, and it does so deterministically.
- Patching UX remains consistent across languages, including what regenerates glue and when.
- We remove duplicated implementations that re-encode shared contracts.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Align exporter lockfile-label attachment policy for importer-scoped ecosystems (Node + Python)

### Description

Today, the exporter’s Node adapter only attaches `lockfile:<path>#<importer>` labels to “macro-shaped” targets (gated by `kind:*`), while the Python adapter attaches lockfile labels for any Python-looking target. This is inconsistent and creates a drift vector:

- The same repository state can produce different labeling behavior depending on language.
- It becomes easier for Python targets to accidentally participate in importer-scoped wiring without going through the macro contracts.

This PR makes the exporter policy identical for Node and Python:

- Only attach importer-scoped lockfile labels when the target is “macro-stamped” (has `kind:*`), and has no `lockfile:` label yet.
- Keep validation strict and deterministic for targets that already carry `lockfile:` labels.

### Scope & Changes

- Add a small shared helper in `build-tools/tools/buck/exporter/lang/` for importer-scoped lockfile label attachment:
  - Inputs: nodes, `isTarget(node)`, and a `findNearestLockfile(pkgDir)` function.
  - Behavior:
    - If a node has `kind:*` and lacks `lockfile:` labels, find the nearest lockfile and attach exactly one `lockfile:<path>#<importer>` label.
    - `importer` is computed as `dirname(lockfilePath)` (or `"."` for repo-root lockfiles), mirroring `build-tools/tools/lib/importers.ts`.
    - The attached label is sorted/deduped with the node’s existing labels.
- Refactor:
  - `build-tools/tools/buck/exporter/lang/node.ts` to use the shared helper for attachment.
  - `build-tools/tools/buck/exporter/lang/python.ts` to use the same shared helper and remove the broader attachment behavior.
- Keep Node/Python adapter classification unchanged (how we decide “is node/python target”), but ensure lockfile label attachment is consistently gated by `kind:*`.
- Update exporter validation:
  - Continue to validate existing `lockfile:` labels (exactly one, parseable, and importer-dir consistent).
  - Ensure Node validation uses the canonical TypeScript parser (`parseLockfileLabel(...)`) rather than partially parsing and re-implementing checks.

### Tests (in this PR)

- Add a focused test that exercises the exporter labeling behavior for both Node and Python:
  - A node with `lang:<id>` but no `kind:*` does not get a lockfile label attached.
  - A node with `lang:<id>` and `kind:*` does get a lockfile label attached when a nearest lockfile exists.
  - A node that already has a lockfile label is left unchanged.
- Add a regression test ensuring Node validation rejects malformed labels with the same criteria as `build-tools/tools/lib/labels.ts:parseLockfileLabel(...)`.
- Keep existing TS↔Starlark parity tests intact and extend them only when necessary to cover the exporter gating behavior.

### Docs (in this PR)

- Update the exporter section in the handbook (or the existing exporter documentation) to state the attachment policy:
  - Exporter auto-attaches `lockfile:` labels only for macro-stamped targets (`kind:*`) when missing.
  - For importer-scoped ecosystems, the lockfile label remains a required contract for macros, not a best-effort heuristic for raw rules.

### Acceptance Criteria

- Node and Python exporter adapters attach importer-scoped lockfile labels under the same conditions.
- No lockfile labels are attached to non-macro targets.
- Existing targets that already use `nix_node_*` and `nix_python_*` macros remain unchanged in behavior.

### Risks

- If there are Python targets defined directly with `python_*` rules (not macros) and relying on exporter auto-labeling, this PR will surface them as missing importer wiring. In this repo, Python usage appears macro-driven, so risk is expected to be low.

### Consequence of Not Implementing

- Exporter behavior remains inconsistent across languages, increasing the chance that Python drifts into a separate “it works differently” path.

### Downsides for Implementing

- Small refactor plus a couple of targeted tests.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches only exporter adapters and targeted tests. Safe in tooling slices.

---

## PR‑2: Remove duplicated lockfile-label parsing in the exporter (use the canonical TS parser everywhere)

### Description

The TypeScript side already has a canonical lockfile label parser and normalizer in `build-tools/tools/lib/labels.ts`. Some exporter code paths partially parse lockfile labels and then duplicate the remaining checks. This is a drift vector because it can accept labels the canonical parser would reject (or reject labels it would accept).

This PR removes duplicated parsing and makes the exporter use one canonical implementation.

### Scope & Changes

- Refactor exporter adapter logic to call `build-tools/tools/lib/labels.ts:parseLockfileLabel(...)` (or a single shared wrapper) wherever lockfile labels are interpreted.
- Remove local re-implementations of:
  - repeated `./` stripping
  - “exactly one #” validation
  - importer-dir consistency checks
- Ensure all error messages remain deterministic and actionable. Do not introduce “guessing” behavior.

### Tests (in this PR)

- Add or extend an exporter-focused regression test matrix:
  - malformed lockfile labels are rejected consistently
  - repeated `./` normalization behaves consistently
  - `#.` is only accepted for repo-root lockfiles
- Ensure existing TS lockfile parser unit tests remain the primary correctness gate, and exporter tests verify correct integration.

### Docs (in this PR)

- Update the exporter adapter authoring notes to say:
  - exporter code must not hand-roll lockfile label parsing
  - use the canonical `parseLockfileLabel(...)` helper

### Acceptance Criteria

- Exporter never accepts a lockfile label that `parseLockfileLabel(...)` rejects.
- Exporter never re-implements parts of the lockfile label contract locally.

### Risks

- Low. This should be a mechanical refactor, but it can surface places that accidentally relied on permissive behavior.

### Consequence of Not Implementing

- The “same label is valid in one layer but invalid in another” class of failures reappears over time.

### Downsides for Implementing

- Minor churn in exporter adapter code.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `build-tools/tools/buck/exporter/lang/*` and narrow tests only. Safe in tooling slices.

---

## PR‑3: Patch CLI parity fix (implement Python remove and align patch-pkg messaging with actual glue behavior)

### Description

`patch-pkg` presents a cross-language patching UX, but we have a small behavior gap:

- `patch-pkg remove python ...` is currently advertised at the top-level CLI, but Python does not implement `remove`.
- The CLI usage text implies glue regeneration is Node-only, but importer-scoped Python patch apply already runs glue (providers and auto_map updates).

This PR closes those gaps and makes the top-level CLI messaging match reality.

### Scope & Changes

- Implement `remove` in `build-tools/tools/patch/patch-python.ts`:
  - Remove the canonical patch file for `<dist>@<version>` from the importer-local patch directory.
  - Regenerate glue after removal (same behavior as apply).
  - Keep behavior deterministic and idempotent (removing a non-existent patch is a no-op).
- Update `build-tools/tools/patch/patch-pkg.ts` usage text:
  - State that importer-scoped ecosystems (Node and Python) regenerate glue on apply and remove.
  - State that Go and C++ do not regenerate glue for patch invalidation (package-local patch files are part of target inputs).
- Update any patching handbook sections that claim glue is Node-only so the documentation matches the actual behavior.

### Tests (in this PR)

- Add a focused patch CLI test that:
  - creates a synthetic Python patch file under an importer
  - runs `patch-pkg remove python ...`
  - asserts the patch file is removed and the glue pipeline is invoked (or its outputs are refreshed deterministically)
- Add a small integration test validating `patch-pkg help` (or usage output) mentions Node and Python glue behavior consistently.

### Docs (in this PR)

- Update `docs/handbook/patching.md`:
  - In “Glue regeneration”, state Node and Python regenerate glue, not Node-only.
  - Add a short note clarifying why (providers and auto_map are generated artifacts for importer-scoped ecosystems).

### Acceptance Criteria

- `patch-pkg remove python <dist>` works and is idempotent.
- `patch-pkg` usage output matches actual behavior for glue regeneration.
- No behavior change for Go/C++ patching flows.

### Risks

- Minimal. This should primarily add missing symmetry and fix messaging drift.

### Consequence of Not Implementing

- The top-level CLI continues to advertise subcommands that do not exist for Python, and the glue regeneration story remains confusing.

### Downsides for Implementing

- One new code path in `patch-python.ts` plus a small test.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches patch CLI code and patch CLI tests only. Safe in tooling slices.

---

## PR‑4: Make patch invalidation strategy an explicit cross-language contract (reduce “implicit knowledge”)

### Description

The repository now supports two patch invalidation strategies:

- Package-local patches included in target inputs (Go, C++).
- Importer-local patches plus importer-scoped providers and auto_map wiring (Node, Python).

This is currently correct, but the strategy is implicit. That makes it easier for future work to accidentally mix the strategies and create confusing rebuild behavior.

This PR makes the strategy explicit as a contract and uses it for diagnostics and documentation.

### Scope & Changes

- Extend `build-tools/tools/lib/lang-contracts.ts` with an explicit “patch invalidation strategy” surface per language, for example:
  - `patchScope: "package-local" | "importer-local"`
  - `glueOnApplyRemove: boolean`
  - `providerModel: "none" | "importer-scoped" | "curated"`
- Update `build-tools/tools/dev/langs-diagnose.ts` output to print the strategy for each enabled language.
- Ensure the handbook references the same contract language rather than restating it inconsistently.

### Tests (in this PR)

- Add a unit test for `build-tools/tools/lib/lang-contracts.ts` (or the diagnose output) that asserts:
  - Node and Python are importer-scoped and require glue on apply/remove.
  - Go and C++ are package-local and do not require glue for patch invalidation.
- Ensure the diagnose CLI remains stable and deterministic when run in partial clones.

### Docs (in this PR)

- Update the relevant handbook section to define the strategy terms:
  - what “package-local” means for invalidation
  - what “importer-local” means for invalidation
  - when glue must be regenerated and why

### Acceptance Criteria

- The patch invalidation model is expressed once as a contract and is visible via diagnostics.
- Documentation uses the same terminology as the contract.
- No behavior change. This PR is contract and clarity work with tests guarding it.

### Risks

- Low. This should not affect builds or patching behavior.

### Consequence of Not Implementing

- The system remains correct but requires tribal knowledge, increasing the risk of future drift.

### Downsides for Implementing

- Small amount of contract plumbing.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches TS contracts and docs only. Safe in tooling slices.

---

## PR‑5: Reduce bespoke importer-scoped macro wiring (Node test macro uses shared importer wiring helpers)

### Description

The Node macros already use `prepare_importer_genrule_kwargs(...)` for genrule-style wrappers, and Python macros route through `build-tools/lang/importer_wiring.bzl`. The Node `nix_node_test` macro still performs a portion of the importer wiring manually (lockfile label enforcement, importer derivation, patch input attachment).

This is not incorrect, but it is a drift vector because:

- it is another place that can diverge from importer-scoped wiring rules
- it makes it harder to reason about one canonical macro wiring sequence for importer-scoped ecosystems

This PR routes Node `nix_node_test` through the shared importer wiring helpers without changing behavior.

### Scope & Changes

- Refactor `build-tools/node/defs_core.bzl:nix_node_test` to:
  - enforce a single importer-scoped lockfile label via `require_single_importer_lockfile_label(...)`
  - attach importer-local patches via `attach_importer_patch_inputs(...)`
  - merge provider edges via `merge_provider_edges(...)`
  - keep global nix input stamping behavior unchanged for Node tests
- Avoid introducing new Starlark abstractions unless the refactor needs one. Prefer using the existing helpers already used by Python.

### Tests (in this PR)

- Add a macro wiring regression test asserting `nix_node_test`:
  - requires exactly one lockfile label
  - includes importer-local patch files in its inputs
  - realizes provider edges deterministically
- Ensure existing Node tests remain unchanged.

### Docs (in this PR)

- Update the macro authoring guidance to say:
  - importer-scoped ecosystems should use `build-tools/lang/importer_wiring.bzl` helpers rather than re-implementing wiring steps

### Acceptance Criteria

- Node `nix_node_test` behavior is unchanged, but its wiring path is standardized.
- The repository has fewer bespoke macro wiring implementations for importer-scoped ecosystems.

### Risks

- Moderate. Starlark macro behavior can have subtle differences if list vs dict shaped inputs change. The tests in this PR must lock down the behavior.

### Consequence of Not Implementing

- A second macro wiring implementation remains, and drift becomes more likely over time.

### Downsides for Implementing

- Small refactor plus a couple of targeted tests.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches Node macros and targeted tests only. Safe in Node-focused slices.

---

## PR‑6: Validate importer-scoped lockfile labels even on non-macro targets (no heuristic attachment)

### Description

We currently gate importer-scoped lockfile label validation on `kind:*` (macro-stamped targets). This keeps auto-attachment safely macro-only, but it also means a target can carry a malformed `lockfile:<path>#<importer>` label and escape the “malformed label” diagnostics if it is missing `kind:*`.

This PR makes validation behavior consistent with our build system philosophy:

- If a `lockfile:` label exists, treat it as an explicit contract and validate it deterministically.
- Only auto-attach missing `lockfile:` labels for macro-stamped targets (`kind:*`), preserving the “no heuristic labeling for raw rules” policy.

### Scope & Changes

- Tighten exporter validation in `build-tools/tools/buck/exporter/lang/importer-lockfile-labels.ts`:
  - Validate existing `lockfile:` labels regardless of `kind:*` presence.
  - Keep all existing contract rules unchanged:
    - Exactly one `#`
    - `./` normalization behavior
    - Importer-dir consistency (including `#.` only for repo-root lockfiles)
- Keep label attachment policy unchanged:
  - `attachImporterLockfileLabelsIfMacroStamped(...)` remains gated by `kind:*`.
  - Adapter “missing lockfile label” findings remain gated by `kind:*` (macro-stamped targets).

### Tests (in this PR)

- Extend or add an exporter regression test that asserts:
  - A target without `kind:*` but with a malformed `lockfile:` label produces a deterministic “malformed lockfile label” finding.
  - A target without `kind:*` but with an importer mismatch (e.g., `lockfile:apps/web/pnpm-lock.yaml#libs/foo`) produces an importer mismatch finding.
  - Auto-attachment behavior remains unchanged (still only attaches for `kind:*`).

### Docs (in this PR)

- Update exporter documentation / handbook language to explicitly distinguish:
  - **Attachment policy**: exporter auto-attaches `lockfile:` labels only for macro-stamped targets (`kind:*`) when missing.
  - **Validation policy**: exporter validates `lockfile:` label correctness whenever the label is present (even on non-macro targets).

### Acceptance Criteria

- Malformed or inconsistent `lockfile:<path>#<importer>` labels are reported by the exporter even when `kind:*` is missing.
- Exporter still does not attach `lockfile:` labels to non-macro targets.
- Error surfaces remain deterministic and reuse canonical parsers/inspectors (no bespoke parsing introduced).

### Risks

- Slightly noisier diagnostics: targets with a `lockfile:` label but missing `kind:*` may now produce both a “missing kind:\*” finding and a “malformed/mismatch lockfile label” finding.

### Consequence of Not Implementing

- A malformed `lockfile:` label can evade the exporter’s contract diagnostics when `kind:*` is missing, weakening the “labels are contracts” story and making it easier for drift to accumulate unnoticed.

### Downsides for Implementing

- Small behavior tightening that may surface previously latent malformed labels in repos that have hand-applied `lockfile:` labels outside macros.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches exporter validation helpers and a narrow exporter test only. Safe in tooling slices.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and blast radius:

1. PR‑1 first. It establishes consistent exporter attachment behavior for importer-scoped ecosystems.
2. PR‑2 next. It removes duplicated parsing and tightens the exporter’s use of canonical contracts.
3. PR‑6 next. It tightens exporter validation so `lockfile:` labels are treated as contracts whenever present, without changing attachment policy.
4. PR‑3 next. It fixes the patch CLI parity gap and aligns messaging and behavior.
5. PR‑4 after. It makes the patch invalidation strategy explicit without changing behavior.
6. PR‑5 last. It refactors Node macro wiring and benefits from the earlier contract tightening and clarity.

---

## Verification & Backout Strategy

Each PR includes:

- A focused regression test that fails if the tightened contract or standardized behavior regresses.
- A doc update that describes the user-visible behavior in “what happens” terms.

Backout strategy:

- Each PR is independently revertible.
- If a regression is discovered:
  - revert the PR and its tests/docs together
  - keep any new tests only if they still reproduce the issue on the prior baseline and remain meaningful
