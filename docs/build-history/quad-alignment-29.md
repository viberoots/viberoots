## Quad Alignment Plan — Cross-Language Seam Tightening (CPP / Go / PNPM / Python) — Part 29

This installment follows Part 28. Part 28 tightened the core contracts and helper boundaries across languages. In Part 29 I focus on the remaining seams I still see after reviewing the repo with parity in place.

The themes in this installment are:

- Make the patch invalidation model visible in the Buck graph, so the two-model seam is less implicit during debugging and onboarding.
- Reduce remaining duplication in patch tooling by centralizing importer-local patch directory resolution and the common “workspace diff to patch file” workflow.
- Reduce drift risk in patch tooling by adding enforcement tests that keep new code on the shared helper surfaces.
- Remove the last small “local helper” drift surface in Node Nix-calling macros by moving importer normalization helpers behind a shared Starlark boundary.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Stamp patch invalidation model labels in macro wiring helpers (package-local and importer-local)

### Description

We already have an explicit contract mapping languages to patch invalidation models:

- Starlark: `//lang:lang_contracts.bzl`
- TypeScript: `build-tools/tools/lib/lang-contracts.ts`

However, the Buck graph does not currently expose this model as a label. That makes the seam harder to see when using `buck2 cquery`, exporter outputs, or provider debugging tools.

This PR stamps a stable label on targets, derived from the language’s patch invalidation model, so the model is queryable and visible where developers already look.

### Scope & Changes

- Add a single label vocabulary for patch model:
  - `patch_scope:package-local`
  - `patch_scope:importer-local`
- Implement stamping at the helper boundary, not in each language macro:
  - Package-local helper: `lang/package_local_wiring.bzl:prepare_package_local_wiring`
  - Importer-scoped helper: `lang/importer_wiring.bzl:prepare_importer_*` (the shared wiring surfaces)
- Ensure stamping is deterministic and tolerant:
  - Only add one `patch_scope:*` label.
  - Preserve existing user-provided labels and ordering semantics (stable dedupe).

Non-goals in this PR:

- No change to patch storage locations.
- No change to invalidation behavior.
- No change to provider sync outputs.

### Tests (in this PR)

- Add a focused Starlark probe test for each model:
  - One package-local macro call (Go or C++) proves `patch_scope:package-local` is present.
  - One importer-local macro call (Node or Python) proves `patch_scope:importer-local` is present.
- Add an enforcement-style test that fails if language macro files attempt to stamp `patch_scope:*` directly, rather than using the helper surfaces.

### Docs (in this PR)

- Update `abstractions.md`:
  - Document `patch_scope:*` as the graph-visible representation of the patch model contract.
  - Point authors to the helper boundaries where it is applied.
- Update `docs/handbook/patching.md`:
  - Add a short section showing how to query patch scope with `buck2 cquery`.

### Acceptance Criteria

- All macro paths for Go, C++, Node, and Python stamp exactly one `patch_scope:*` label.
- Tests fail if stamping drifts or is re-implemented ad hoc.
- No behavior changes beyond added labels.

### Risks

Low. This is label-only, but label changes can affect exporter diff noise. The tests should assert invariants and avoid brittle ordering.

### Consequence of Not Implementing

The system remains correct, but the patch model seam stays implicit. Debugging “why did this not require glue” remains a recurring source of friction.

### Downsides for Implementing

One more label vocabulary to maintain. This is acceptable if it reduces ambiguity and keeps future helpers consistent.

### Recommendation

Implement.

---

## PR‑2: Centralize importer-local patch directory resolution in patch tooling and refactor Python patching onto it

### Description

`build-tools/tools/patch/patch-python.ts` currently re-implements importer-local patch directory resolution in a local helper (`resolvePythonPatchDir`). Go patching already routes patch path selection through shared helpers (`build-tools/tools/patch/lib/apply.ts:resolvePatchDir`).

This duplication is a drift surface. It is also a subtle contract. The path chosen for importer-local patches affects invalidation and provider sync behavior.

This PR introduces one shared patch-dir resolver for importer-local languages and refactors Python patch tooling to use it.

### Scope & Changes

- Add a shared helper in patch tooling:
  - A small function to compute the default importer-local patch directory for an importer and language (`node` and `python`).
  - Resolve relative override `--patch-dir` values consistently against repo root.
  - Preserve the existing Python behavior for importer `"."` vs `apps/*` and `libs/*`.
- Refactor `build-tools/tools/patch/patch-python.ts`:
  - Remove `resolvePythonPatchDir(...)`.
  - Route path selection through the shared helper surface.

Non-goals in this PR:

- No change to Node patching behavior (`pnpm patch-commit` remains authoritative).
- No change to how glue pipeline is invoked.

### Tests (in this PR)

- Add unit tests for the new helper covering:
  - importer `"."` default path
  - importer `apps/<x>` default path
  - absolute override path
  - relative override path
- Add a focused integration-style test for Python patch apply that asserts:
  - The resulting patch file lands at the expected importer-local default path when `--patch-dir` is not provided.

### Docs (in this PR)

- Update `docs/handbook/patching.md`:
  - Document importer-local patch directory defaults using the same language as the helper surface.
  - Document `--patch-dir` semantics for importer-local patch commands.

### Acceptance Criteria

- Python patch tooling no longer has bespoke patch-dir resolution logic.
- Tests lock down path selection for importer-local patching.
- Patch output locations remain stable for existing workflows.

### Risks

Low to moderate. The main risk is subtle behavior change around relative overrides. Unit tests should cover those cases explicitly.

### Consequence of Not Implementing

Importer-local patch tooling continues to duplicate path logic across scripts. That increases the chance of divergence and inconsistent docs.

### Downsides for Implementing

Some churn in patch tooling internals. The external behavior should remain stable and now has tests.

### Recommendation

Implement.

---

## PR‑3: Extract a shared “workspace diff to patch file” patch-tool workflow and refactor Go and Python handlers to use it

### Description

Go and Python patch tooling are structurally similar:

- Resolve origin source (store path or extracted source)
- Create a writable workspace
- Track a session record
- Compute a unified diff
- Write a canonical patch file
- Verify the patch applies cleanly
- Clear the dev override and close the session

Today these flows are implemented separately in `build-tools/tools/patch/patch-go.ts` and `build-tools/tools/patch/patch-python.ts`. This is correct but duplicated. The duplication is a drift surface for session reuse rules, no-op clearing, and verification behavior.

This PR extracts one shared workflow helper for “workspace-based patching” and refactors Go and Python patch handlers to use it.

### Scope & Changes

- Add a shared helper in `build-tools/tools/patch/lib/` that encapsulates the common workflow:
  - session reuse policy (only reuse when workspace exists and origin matches)
  - no-op apply behavior (clear override and delete session)
  - patch verification (shared `verifyPatchDryRun` path)
  - consistent stdout/stderr messaging conventions for patch handlers
- Refactor:
  - `build-tools/tools/patch/patch-go.ts` uses the shared helper for start/apply/reset/session.
  - `build-tools/tools/patch/patch-python.ts` uses the shared helper for start/apply/reset/session.
- Preserve language-specific concerns at the edges:
  - Go module resolution remains in `build-tools/tools/patch/go-module-resolve.ts`.
  - Python distribution resolution remains in `build-tools/tools/patch/python-dist-resolve.ts`.

Non-goals in this PR:

- No change to Node patching (pnpm remains in control).
- No change to C++ patching (extraction and nixpkgs resolution remain separate).

### Tests (in this PR)

- Add focused tests that cover the shared helper behavior:
  - Session reuse requires origin match.
  - No-op apply clears overrides and closes the session.
  - Patch verification failures are surfaced with actionable context.
- Add a regression test that proves Go and Python keep existing patch filename conventions:
  - Go: `<importPath encoded>@<version>.patch` (encoding contract preserved)
  - Python: `<distribution>@<version>.patch`

### Docs (in this PR)

- Update `docs/handbook/patching.md`:
  - Document the shared workflow at a behavioral level (start, edit, apply, reset).
  - Document the no-op apply behavior and why it matters (avoid leaking dev overrides into later builds).

### Acceptance Criteria

- Go and Python patch handlers share one workflow helper and no longer duplicate the common control flow.
- Tests lock down the shared workflow behavior.
- Patch handler CLI behavior remains stable aside from clearer, more consistent output.

### Risks

Moderate. Patch tooling has subtle state interactions (sessions, overrides, temp dirs). Tests must cover the specific behavior we rely on today.

### Consequence of Not Implementing

Duplicated patch workflow logic remains a drift surface, especially for session reuse and no-op cleanup.

### Downsides for Implementing

Some internal refactoring churn. The benefit is lower drift risk and a smaller patch-tool surface to reason about.

### Recommendation

Implement.

---

## PR‑4: Add enforcement tests for patch tooling helper boundaries (prevent reintroducing bespoke patch-dir and session logic)

### Description

We rely on shared helper boundaries in Starlark to prevent macro drift. Patch tooling needs the same protection. Without enforcement, the next patch-related change is likely to reintroduce local path resolution, local flag parsing quirks, or ad hoc session logic.

This PR adds an enforcement-style guard that keeps patch tooling on the shared helper surfaces introduced in PR‑2 and PR‑3.

### Scope & Changes

- Add a TypeScript enforcement test that scans patch tooling entrypoints under `build-tools/tools/patch/` and fails on:
  - importer-local patch directory construction in leaf scripts (outside the shared helper module)
  - new session-state logic duplicated in leaf scripts (outside the shared workflow helper)
- Keep the enforcement test narrow and explicit:
  - It should target known drift patterns and provide an actionable failure message pointing at the canonical helper surfaces.

Non-goals in this PR:

- No behavior changes.
- No new helper surfaces beyond what the earlier PRs already introduced.

### Tests (in this PR)

- The enforcement test itself, plus a small “positive control” fixture that proves:
  - It does not flag the canonical helper implementation files.
  - It does flag an intentionally-constructed, minimal example of a banned pattern (kept as a test fixture, not production code).

### Docs (in this PR)

- Update `docs/handbook/tooling.md` (or the best-fit existing handbook page if it already exists):
  - State that patch tooling must use the shared helper surfaces for patch-dir resolution and workspace-based patch workflows.
  - Explain the enforcement test and what to do when it fails.

### Acceptance Criteria

- Patch tooling entrypoints no longer reintroduce bespoke patch-dir or session logic.
- The enforcement test is precise enough to avoid false positives, but strict enough to prevent drift.

### Risks

Low to moderate. The main risk is false positives, which can be mitigated by limiting the scan scope and explicitly excluding canonical helper files.

### Consequence of Not Implementing

Patch tooling can drift the same way macro wiring would drift without enforcement. Review becomes the only line of defense.

### Downsides for Implementing

One more enforcement test to maintain. This is acceptable because it blocks reintroduction of a known drift source.

### Recommendation

Implement.

---

## PR‑5: Move Node Nix-calling importer helpers behind a shared Starlark boundary

### Description

Part 28 tightened Node Nix-calling macros using shared wiring helpers (`prepare_importer_nix_calling_genrule_wiring`). The remaining drift surface is small but real: `build-tools/node/defs_nix.bzl` still carries local helper functions for:

- Sanitizing an importer string into a Nix attribute segment.
- Deriving a display name (basename) for bundling output naming.

These helpers are likely to be copied into the next Nix-calling macro shape (or the next language) and drift over time.

This PR moves those helpers into `//lang` as a shared, narrow surface and refactors Node Nix-calling macros to call that surface.

### Scope & Changes

- Add a small shared Starlark helper module under `//lang` (name and location intentionally narrow), for example:
  - `lang/importer_strings.bzl` (or similar)
  - Expose:
    - `sanitize_importer_for_nix_attr(importer: str) -> str`
    - `importer_display_name(importer: str) -> str` (basename-like, deterministic)
- Refactor `build-tools/node/defs_nix.bzl`:
  - Remove `_sanitize_importer_attr(...)` and `_basename_importer(...)`.
  - Call the shared helper functions instead.
- Keep behavior stable:
  - The sanitizer should remain equivalent to `sanitize_name(...)` on the importer string.
  - The display-name helper should match the existing “last path segment” behavior.

Non-goals in this PR:

- No changes to Node bundling behavior beyond the refactor.
- No changes to importer label contract (`lockfile:<path>#<importer>` remains authoritative).

### Tests (in this PR)

- Add a focused Starlark probe test that exercises both helpers with representative importers:
  - `"."`
  - `"apps/web"`
  - `"libs/some_tool"`
  - A path with repeated separators or trailing slashes (normalized behavior should be deterministic).
- Add an enforcement-style test that fails if `build-tools/node/defs_nix.bzl` reintroduces local helper definitions matching the removed patterns.

### Docs (in this PR)

- Update `docs/handbook/adding-language.md` or `docs/handbook/macro-stamping-cookbook.md` (best fit):
  - Document that importer string shaping for Nix attributes must go through the shared helper module, not local macro helpers.

### Acceptance Criteria

- Node Nix-calling macros no longer contain local importer normalization helpers.
- The shared helper surface exists in `//lang` and is covered by tests.
- Behavior is stable (same Nix attr naming, same display-name behavior).

### Risks

Low. This is a refactor of small helpers, but it can still affect bundle attribute selection if behavior changes. Tests should cover representative cases.

### Consequence of Not Implementing

The repo keeps a small local-helper drift surface in one of the more complex macro families (Nix-calling wrappers). That is where drift is most costly.

### Downsides for Implementing

One more small helper module in `//lang`. This is acceptable if it prevents copy/paste helper drift.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and by keeping each PR revertible:

1. PR‑1 first. It is label-only and makes the patch model seam visible.
2. PR‑2 next. It introduces the shared importer-local patch-dir resolver and refactors Python onto it.
3. PR‑3 next. It introduces the shared workspace-based workflow helper and refactors Go and Python patch handlers onto it.
4. PR‑4 next. It adds enforcement to keep patch tooling on the shared helper surfaces.
5. PR‑5 last. It removes the last small local-helper drift surface in Node Nix-calling macros.

---

## Verification & Backout Strategy

Each PR includes:

- At least one focused test that asserts the relevant contract behavior.
- A documentation update that points authors at the canonical helper surface and uses the same terms used by the tests.

Backout strategy:

- PR‑1 is safe to revert independently if label churn causes unexpected noise.
- PR‑2 and PR‑3 are refactors. If unexpected behavior is found, revert the refactor while keeping the helpers behind tests until the behavior is stable.
- PR‑4 should be the last PR so it never blocks incremental refactors. If it is too noisy, revert it independently and tighten patterns before reintroducing it.
